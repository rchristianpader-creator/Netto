const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Sortiment = require('../js/sortiment.js');

test('CSV: Semikolon, Anführungszeichen mit ; darin, BOM, CRLF, Spalten per Kopfzeile', () => {
  const csv = [
    '\uFEFFean;produktname;marke;inhalt;kategorie;status;datenstand',
    '4006381333931;Textmarker;Stabilo;1 Stück;;"belegt; nicht verifiziert";2026-09',
    '96385074;"Artikel ""Spezial""";Marke;200 g;Snacks;x;2026-09-24',
    'keine-ean;Kaputt;;;;;',
    '4006381333931;Duplikat;;;;;',
    '',
  ].join('\r\n');
  const { items, errors, datenstand } = Sortiment.parse(csv);
  assert.deepEqual(
    items.map((i) => [i.code, i.name, i.marke, i.inhalt, i.kategorie]),
    [
      ['4006381333931', 'Textmarker', 'Stabilo', '1 Stück', ''],
      ['96385074', 'Artikel "Spezial"', 'Marke', '200 g', 'Snacks'],
    ]
  );
  assert.equal(errors.length, 1);
  assert.equal(errors[0].row, 4);
  assert.equal(datenstand, '2026-09-24');
});

test('CSV: andere Spaltenreihenfolge, Komma als Trennzeichen', () => {
  const { items } = Sortiment.parse('Marke,Name,EAN\nStabilo,Textmarker,4006381333931\n');
  assert.deepEqual(items.map((i) => [i.code, i.name, i.marke]), [['4006381333931', 'Textmarker', 'Stabilo']]);
});

test('Sortiment (data/netto-sortiment.csv): lesbar, alle EANs gültig und eindeutig, jeder Artikel mit Name', () => {
  // Das Sortiment wird per Kamera-Scan gefüllt (anfangs leer); die Kopfzeile muss zum Anhängen passen.
  const text = fs.readFileSync(path.join(__dirname, '..', 'data', 'netto-sortiment.csv'), 'utf8');
  assert.equal(text.replace(/^\uFEFF/, '').split(/\r?\n/)[0], 'ean;produktname;marke;inhalt;kategorie;status;quelle;datenstand');
  const { items, errors } = Sortiment.parse(text);
  assert.equal(errors.length, 0);
  assert.deepEqual(items.filter((i) => !i.valid).map((i) => i.code), []);
  assert.equal(new Set(items.map((i) => i.code)).size, items.length);
  assert.ok(items.every((i) => i.name), 'jeder Artikel hat einen Namen');
});

test('Beispiel-Sortiment (tests/fixtures): 571 Artikel, alle EANs gültig, eindeutig, mit Name und Marke', () => {
  const text = fs.readFileSync(path.join(__dirname, 'fixtures', 'sortiment-beispiel.csv'), 'utf8');
  const { items, errors, datenstand } = Sortiment.parse(text);
  assert.equal(errors.length, 0);
  assert.equal(items.length, 571);
  assert.deepEqual(items.filter((i) => !i.valid).map((i) => i.code), []);
  assert.equal(new Set(items.map((i) => i.code)).size, items.length);
  assert.ok(items.every((i) => i.name && i.marke), 'jeder Artikel hat Name und Marke');
  assert.equal(items[0].code, '4316268687140');
  assert.equal(datenstand, '2026-09-24');
});
