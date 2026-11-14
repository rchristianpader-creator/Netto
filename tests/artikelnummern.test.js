const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../js/artikelnummern.js');

test('Liste: 179 eindeutige fünfstellige Artikelnummern', () => {
  assert.equal(A.LISTE.length, 179);
  const nrs = A.LISTE.slice();
  assert.equal(new Set(nrs).size, nrs.length);
  nrs.forEach((nr) => assert.match(nr, /^\d{5}$/));
  // Reihenfolge fest wie auf der Liste, nur Nummern
  assert.deepEqual(nrs.slice(0, 3), ['38018', '38032', '38015']);
  assert.deepEqual(A.items().map((it) => it.code), nrs);
});

test('Code 128 B: bekannte Modulfolge und Länge', () => {
  // Start B (11010010000), "1" = Wert 17 (11001110010) ... Stopp mit Abschlussbalken (1100011101011)
  const m = A.encode128('38018');
  assert.equal(m.length, A.geometry('38018').bars);
  assert.ok(m.startsWith('11010010000'));
  assert.ok(m.endsWith('1100011101011'));
  // Prüfzeichen: (104 + 1·19 + 2·24 + 3·16 + 4·17 + 5·24) mod 103 = 407 mod 103 = 98
  assert.equal(m.slice(-24, -13), '11110100010'); // Wert 98
  assert.throws(() => A.encode128('ä'));
});

test('EAN-13 aus Artikelnummer und Vergleich mit Scanner-Eingabe', () => {
  assert.equal(A.toEan13('38018'), '0000000380188');
  assert.ok(A.matches('38018', '38018'));
  assert.ok(A.matches('0000000380188', '38018'));
  assert.ok(A.matches('000000380188', '38018')); // als UPC-A gelesen
  assert.ok(!A.matches('38019', '38018'));
  assert.ok(!A.matches('', '38018'));
  assert.deepEqual(A.barcode('38018', 'ean'), { type: 'EAN-13', value: '0000000380188', kind: 'ean' });
  assert.equal(A.barcode('38018', 'c128').kind, 'c128');
});

test('SVG enthält Klarschrift und passende viewBox', () => {
  const svg = A.toSVG('38018', { module: 2, barHeight: 40 });
  const g = A.geometry('38018');
  assert.ok(svg.includes('viewBox="0 0 ' + g.width + ' ' + (40 + g.textHeight) + '"'));
  assert.ok(svg.includes('>38018</text>'));
});
