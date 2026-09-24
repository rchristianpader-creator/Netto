const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Sortiment = require('../js/sortiment.js');
const W = require('../js/warengruppen.js');
const T = require('../js/tagesliste.js');

const items = Sortiment.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'netto-sortiment.csv'), 'utf8')).items;
items.forEach((it) => (it.gruppe = W.classify(it)));
const codes = (list) => list.map((it) => it.code);
// n aufeinanderfolgende Tage ab dem 24.09.2026
const tage = (n) => Array.from({ length: n }, (_, i) => T.dayKey(new Date(2026, 8, 24 + i)));
const tagesliste = (tag, range) => T.pick(items, T.daySeed(tag), range);

test('dayKey: Datum in Ortszeit als JJJJ-MM-TT', () => {
  assert.equal(T.dayKey(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
  assert.equal(T.dayKey(new Date(2026, 11, 31, 0, 0)), '2026-12-31');
  assert.deepEqual(tage(9).slice(-2), ['2026-10-01', '2026-10-02']);
});

test('jeden Tag 50 bis 80 Artikel, auch die Anzahl ist zufällig', () => {
  const anzahl = tage(365).map((tag) => tagesliste(tag).length);
  assert.ok(anzahl.every((n) => n >= 50 && n <= 80), 'immer zwischen 50 und 80');
  assert.equal(Math.min(...anzahl), 50);
  assert.equal(Math.max(...anzahl), 80);
  assert.equal(new Set(anzahl).size, 31, 'jede Anzahl von 50 bis 80 kommt vor');
});

test('gleicher Tag = gleiche Liste, jeder Tag eine andere', () => {
  assert.deepEqual(codes(tagesliste('2026-09-24')), codes(tagesliste('2026-09-24')));
  const listen = tage(30).map((tag) => codes(tagesliste(tag)).sort().join());
  assert.equal(new Set(listen).size, 30);
  // aufeinanderfolgende Tage überschneiden sich nur zufällig, nicht größtenteils
  const heute = tagesliste('2026-09-24');
  const morgen = tagesliste('2026-09-25');
  assert.ok(morgen.filter((it) => heute.includes(it)).length < morgen.length / 2);
});

test('Auswahl: jeder Artikel höchstens einmal, nur aus dem Sortiment; nach und nach kommt jeder dran', () => {
  const gesehen = new Set();
  for (const tag of tage(365)) {
    const auswahl = tagesliste(tag);
    assert.equal(new Set(auswahl).size, auswahl.length);
    auswahl.forEach((it) => {
      assert.ok(items.includes(it));
      gesehen.add(it.code);
    });
  }
  assert.equal(gesehen.size, items.length, 'im Lauf eines Jahres kommt jeder Artikel mindestens einmal vor');
});

test('Auswahl bleibt stabil, wenn sich das Sortiment ändert', () => {
  const seed = T.daySeed('2026-09-24');
  const auswahl = T.pick(items, seed);
  const nichtDabei = items.find((it) => !auswahl.includes(it));
  assert.deepEqual(codes(T.pick(items.filter((it) => it !== nichtDabei), seed)), codes(auswahl));
  // fällt ein ausgewählter Artikel weg, rückt genau einer nach
  const ohne = T.pick(items.filter((it) => it !== auswahl[0]), seed);
  assert.equal(ohne.length, auswahl.length);
  assert.equal(ohne.filter((it) => !auswahl.includes(it)).length, 1);
});

test('Bereich "Artikel pro Tag": eigene Grenzen, vertauscht, Unsinn → Standard, höchstens das ganze Sortiment', () => {
  assert.deepEqual(T.normalizeRange(), { min: 50, max: 80 });
  assert.deepEqual(T.normalizeRange({ min: '30', max: '40' }), { min: 30, max: 40 });
  assert.deepEqual(T.normalizeRange({ min: 90, max: 60 }), { min: 60, max: 90 });
  assert.deepEqual(T.normalizeRange({ min: 'abc', max: null }), { min: 50, max: 80 });
  assert.deepEqual(T.normalizeRange({ min: 0, max: 12.4 }), { min: 1, max: 12 });
  for (let seed = 0; seed < 200; seed++) {
    const n = T.pick(items, seed, { min: 10, max: 12 }).length;
    assert.ok(n >= 10 && n <= 12, String(n));
  }
  assert.equal(tagesliste('2026-09-24', { min: 7, max: 7 }).length, 7);
  assert.equal(tagesliste('2026-09-24', { min: items.length + 1, max: items.length + 50 }).length, items.length);
  assert.equal(T.pick(items.slice(0, 30), 1).length, 30);
  // größerer Bereich: die bisherige Auswahl bleibt, es kommen nur Artikel dazu
  const klein = tagesliste('2026-09-24', { min: 50, max: 50 });
  const gross = tagesliste('2026-09-24', { min: 60, max: 60 });
  assert.ok(klein.every((it) => gross.includes(it)));
});

test('Tagesliste nach Laufweg: Warengruppen in Ladenreihenfolge', () => {
  const seed = T.daySeed('2026-09-24');
  const liste = W.arrange(T.pick(items, seed), W.DEFAULT_ORDER, seed);
  const rank = (g) => W.DEFAULT_ORDER.indexOf(g);
  for (let i = 1; i < liste.length; i++) assert.ok(rank(liste[i - 1].gruppe) <= rank(liste[i].gruppe));
});
