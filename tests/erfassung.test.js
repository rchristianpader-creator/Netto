const test = require('node:test');
const assert = require('node:assert/strict');
const EAN = require('../js/ean.js');
const Erfassung = require('../js/erfassung.js');
const CameraScanner = require('../js/camera-scanner.js');
const ZXing = require('../js/vendor/zxing.min.js');

test('capture: neue EAN wird ohne Rückfrage aufgenommen, doppelte nicht nochmal', () => {
  const sortiment = new Map([['4316268604710', { code: '4316268604710', name: 'Blütenhonig' }]]);
  let list = [];
  const known = (code) => sortiment.get(code) || (list.some((e) => e.code === code) ? { code } : null);

  let r = Erfassung.capture(list, '4006381333931', known, 1000);
  assert.equal(r.status, 'added');
  assert.deepEqual(r.list, [{ code: '4006381333931', at: 1000 }]);
  list = r.list;

  r = Erfassung.capture(list, '4006381333931', known, 2000); // selbst schon erfasst
  assert.equal(r.status, 'known');
  assert.equal(r.list, list);

  r = Erfassung.capture(list, '4316268604710', known, 3000); // im Sortiment aus der CSV
  assert.equal(r.status, 'known');
  assert.equal(r.item.name, 'Blütenhonig');
  assert.equal(r.list.length, 1);

  r = Erfassung.capture(list, '4006381333932', known, 4000); // falsche Prüfziffer
  assert.equal(r.status, 'invalid');
  assert.equal(r.list.length, 1);

  r = Erfassung.capture(list, '96385074', known, 5000); // EAN-8
  assert.equal(r.status, 'added');
  assert.deepEqual(r.list.map((e) => e.code), ['4006381333931', '96385074']);
});

test('normalizeList: ungültige, doppelte und schon im Sortiment enthaltene EANs fliegen raus', () => {
  const list = Erfassung.normalizeList(
    [{ code: '4006381333931', at: 1 }, { code: '4006381333931', at: 2 }, { code: 'x' }, null, { code: '4006381333932' },
      { code: '4316268604710', at: 3 }, { code: '96385074' }],
    new Set(['4316268604710'])
  );
  assert.deepEqual(list, [{ code: '4006381333931', at: 1 }, { code: '96385074', at: 0 }]);
  assert.deepEqual(Erfassung.normalizeList('kaputt'), []);
});

test('toItems und toCSV: gleiche Felder bzw. gleiches Format wie das Sortiment', () => {
  const list = [{ code: '4006381333931', at: Date.UTC(2026, 8, 25, 10) }];
  const [item] = Erfassung.toItems(list);
  assert.equal(item.code, '4006381333931');
  assert.equal(item.type, 'EAN-13');
  assert.equal(item.valid, true);
  assert.equal(item.name, Erfassung.NAME);
  assert.equal(item.eigen, true);
  const csv = Erfassung.toCSV(list);
  assert.equal(
    csv,
    '﻿ean;produktname;marke;inhalt;kategorie;warengruppe;status;quelle;datenstand\n' +
      '4006381333931;' + Erfassung.NAME + ';;;;;selbst gescannt;Kamera-Scan;2026-09-25\n'
  );
  const Sortiment = require('../js/sortiment.js');
  assert.deepEqual(Sortiment.parse(csv).items.map((i) => i.code), ['4006381333931']);
});

test('ReadFilter: erst nach zwei gleichen Lesungen, danach nicht erneut solange der Code im Bild bleibt', () => {
  const f = new Erfassung.ReadFilter();
  assert.equal(f.push('4006381333931', 0), null);
  assert.equal(f.push('4006381333931', 100), '4006381333931');
  for (let t = 200; t < 5000; t += 100) assert.equal(f.push('4006381333931', t), null); // bleibt im Bild
  assert.equal(f.push(null, 5100), null);
  // weg aus dem Bild (länger als holdMs), dann wieder davor: zählt wieder
  assert.equal(f.push('4006381333931', 7000), null);
  assert.equal(f.push('4006381333931', 7100), '4006381333931');
  // ein anderer Code zählt sofort (nach Bestätigung), auch wenn der vorige noch "gehalten" wird
  assert.equal(f.push('96385074', 7200), null);
  assert.equal(f.push('96385074', 7300), '96385074');
  // eine einzelne Fehllesung dazwischen zählt nicht
  assert.equal(f.push('4316268604710', 9000), null);
  assert.equal(f.push('4316268604711', 9100), null);
});

// Barcode als RGBA-Bild zeichnen, wie es die Kamera liefern würde (mit Rauschen und etwas Unschärfe im Kontrast).
function renderBarcode(code, moduleWidth, height, seed) {
  const g = EAN.geometry(code);
  const bits = '0'.repeat(g.quietLeft) + EAN.encode(code) + '0'.repeat(g.quietRight);
  const pad = 40;
  const w = bits.length * moduleWidth + 2 * pad;
  const h = height + 2 * pad;
  const rgba = new Uint8ClampedArray(w * h * 4);
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const bx = Math.floor((x - pad) / moduleWidth);
      const bar = y >= pad && y < pad + height && bx >= 0 && bx < bits.length && bits[bx] === '1';
      const v = (bar ? 40 : 215) + (rnd() - 0.5) * 60;
      const p = (y * w + x) * 4;
      rgba[p] = v;
      rgba[p + 1] = v;
      rgba[p + 2] = v * 0.95;
      rgba[p + 3] = 255;
    }
  }
  return { rgba, w, h };
}

test('ZXing liest EAN-13 und EAN-8 aus einem Kamerabild', () => {
  const reader = CameraScanner.createZXingReader(ZXing);
  for (const [code, mw] of [['4316268604710', 3], ['4006381333931', 2], ['42470700', 3], ['03770474', 4]]) {
    const { rgba, w, h } = renderBarcode(code, mw, 80, 7);
    assert.equal(CameraScanner.decodeRGBA(ZXing, reader, rgba, w, h), code);
  }
  // leeres Bild: kein Code, kein Fehler
  const empty = new Uint8ClampedArray(200 * 100 * 4).fill(200);
  assert.equal(CameraScanner.decodeRGBA(ZXing, reader, empty, 200, 100), null);
});

test('appendToCSV: hängt nur fehlende EANs an, Spalten nach der Kopfzeile der Datei, Rest bleibt unverändert', () => {
  const text = '﻿ean;produktname;warengruppe;quelle\n4316268604710;Blütenhonig;;\n';
  const list = [{ code: '4316268604710', at: 0 }, { code: '4006381333931', at: Date.UTC(2026, 8, 25), name: 'Gouda', gruppe: 'Käse' }];
  const r = Erfassung.appendToCSV(text, list, new Set(['4316268604710']));
  assert.deepEqual(r.added, ['4006381333931']);
  assert.equal(r.text, text + '4006381333931;Gouda;Käse;Kamera-Scan\n');
  // leere Datei: bekommt die Standard-Kopfzeile
  const leer = Erfassung.appendToCSV('', list.slice(1), new Set()).text;
  assert.equal(leer.split('\n')[0], '﻿ean;produktname;marke;inhalt;kategorie;warengruppe;status;quelle;datenstand');
  assert.equal(leer.split('\n')[1].split(';')[5], 'Käse');
  assert.deepEqual(Erfassung.appendToCSV(text, list.slice(0, 1), new Set(['4316268604710'])), { text, added: [] });
  // Datei ohne Zeilenumbruch am Ende
  assert.equal(Erfassung.appendToCSV('ean', list.slice(1), new Set()).text.split('\n')[1].split(';')[0], '4006381333931');
});

test('normalizeList behält die Markierung "synced"', () => {
  assert.deepEqual(Erfassung.normalizeList([{ code: '4006381333931', at: 1, synced: true }, { code: '96385074', at: 2, synced: 'x' }]), [
    { code: '4006381333931', at: 1, synced: true },
    { code: '96385074', at: 2 },
  ]);
});

// Graustufenbild (PGM, gzip) aus tests/fixtures als RGBA laden
function loadPGM(name) {
  const zlib = require('node:zlib');
  const fs = require('node:fs');
  const path = require('node:path');
  const pgm = zlib.gunzipSync(fs.readFileSync(path.join(__dirname, 'fixtures', name)));
  const [, w, h] = pgm.toString('latin1', 0, 20).match(/^P5\n(\d+) (\d+)\n255\n/).map(Number);
  const gray = pgm.subarray(pgm.length - w * h);
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) rgba.set([gray[i], gray[i], gray[i], 255], i * 4);
  return { rgba, w, h };
}

test('Netto-Regaletikett: Code 128 aus einem echten Foto wird gelesen, Nummer ist eine gültige ladeninterne EAN', () => {
  const zlib = require('node:zlib');
  const fs = require('node:fs');
  const path = require('node:path');
  const { rgba, w, h } = loadPGM('regaletikett-code128.pgm.gz');
  const reader = CameraScanner.createZXingReader(ZXing);
  const code = CameraScanner.decodeRGBA(ZXing, reader, rgba, w, h);
  assert.equal(code, '2707338130000'); // enthält die Netto-Artikelnummer 733813

  assert.equal(Erfassung.isInStore(code), true);
  assert.equal(Erfassung.isInStore('4002720002117'), false); // normale Hersteller-EAN
  assert.equal(Erfassung.isInStore('96385074'), false);
  const r = Erfassung.capture([], code, () => null, 1);
  assert.equal(r.status, 'added');
  assert.equal(r.list[0].code, '2707338130000');
});

test('Regaletikett im Kamerabild: Code liegt auf dunkelgrauem Grund dicht am Etikettrand, erst der Kontrast-Versuch liest ihn', () => {
  const { rgba, w, h } = loadPGM('regaletikett-kamera.pgm.gz');
  const reader = CameraScanner.createZXingReader(ZXing);
  assert.equal(CameraScanner.decodeRGBA(ZXing, reader, rgba, w, h), null); // normaler Kontrast: Ruhezone reicht nicht
  assert.equal(CameraScanner.decodeRGBAHard(ZXing, reader, rgba, w, h), '2707338130000');
  // gewöhnliche EANs (hellgrauer Grund, verrauscht) liest die Funktion weiterhin
  for (const code of ['4002720002117', '42470700']) {
    const img = renderBarcode(code, 3, 80, 11);
    assert.equal(CameraScanner.decodeRGBAHard(ZXing, reader, img.rgba, img.w, img.h), code);
  }
});

test('searchRect: sichtbarer Teil des Kamerabilds plus Rand, für Quer- und Hochformat', () => {
  // Querformat-Kamera (16:9) im 4:3-Fenster: links/rechts abgeschnitten
  assert.deepEqual(CameraScanner.searchRect(1920, 1080, 400, 300, 0), { x: 240, y: 0, w: 1440, h: 1080 });
  // mit Rand: etwas breiter, aber nie größer als das Bild
  assert.deepEqual(CameraScanner.searchRect(1920, 1080, 400, 300, 0.08), { x: 86, y: 0, w: 1747, h: 1080 });
  // Hochformat-Kamera (iPhone hochkant, 1080×1920) im 4:3-Fenster: oben/unten abgeschnitten
  const r = CameraScanner.searchRect(1080, 1920, 400, 300, 0.08);
  assert.equal(r.w, 1080);
  assert.equal(r.h, Math.round(810 + 2 * 0.08 * 1920));
  assert.ok(Math.abs(r.y - (1920 - r.h) / 2) <= 1 && r.y + r.h <= 1920, JSON.stringify(r));
  // Fenstergröße unbekannt: ganzes Bild
  assert.deepEqual(CameraScanner.searchRect(1280, 720, 0, 0, 0.08), { x: 0, y: 0, w: 1280, h: 720 });
});

test('rename: Bezeichnung korrigieren; schon übernommene Einträge werden zum Nachziehen markiert', () => {
  let list = [{ code: '4006381333931', at: 1, name: 'Aandeln' }, { code: '96385074', at: 2, name: 'X', synced: true }];
  list = Erfassung.rename(list, '4006381333931', { name: ' Mandeln ', marke: 'Clarkys' });
  assert.deepEqual(list[0], { code: '4006381333931', at: 1, name: 'Mandeln', marke: 'Clarkys' });
  list = Erfassung.rename(list, '96385074', { name: 'Kaffee', inhalt: '' });
  assert.deepEqual(list[1], { code: '96385074', at: 2, name: 'Kaffee', synced: true, dirty: true });
  assert.deepEqual(Erfassung.normalizeList(JSON.parse(JSON.stringify(list))), list); // bleibt beim Speichern erhalten
  // CSV: Zeile mit Anführungszeichen und Semikolon im Feld korrekt ersetzen, andere Spalten bleiben
  const csv = '﻿ean;produktname;marke;inhalt;warengruppe;quelle\n96385074;"Alt; Name";M;1 l;Kühlregal;"Kamera-Scan; Regaletikett"\n4006381333931;Andere;;;;\n';
  const r = Erfassung.updateInCSV(csv, [list[1]]);
  assert.deepEqual(r.updated, ['96385074']);
  assert.equal(r.text.split('\n')[1], '96385074;Kaffee;;;Kühlregal;"Kamera-Scan; Regaletikett"');
  assert.equal(r.text.split('\n')[2], '4006381333931;Andere;;;;');
});

test('barFromPosition: Lage aus den vier Ecken von zxing-cpp, mit Verschiebung des Suchbereichs', () => {
  const pos = { topLeft: { x: 313, y: 800 }, topRight: { x: 851, y: 802 }, bottomRight: { x: 850, y: 850 }, bottomLeft: { x: 312, y: 848 } };
  assert.deepEqual(CameraScanner.barFromPosition(pos, 0, 0), { left: 312, right: 851, y: 825 });
  assert.deepEqual(CameraScanner.barFromPosition(pos, 100, 50), { left: 412, right: 951, y: 875 });
  assert.equal(CameraScanner.barFromPosition(null, 0, 0), null);
});
