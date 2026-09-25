const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Sortiment = require('../js/sortiment.js');
const W = require('../js/warengruppen.js');

// Es gibt keine vorgegebenen Warengruppen: nur eigene (hier angelegt) und "Ohne Warengruppe".
const EIGENE = ['Kühlregal', 'Trockenware', 'Getränke', 'Tiefkühl'];
const IDS = EIGENE.map((name) => W.register(name));

// Beispiel-Sortiment; die letzten 20 Artikel bleiben ohne Warengruppe
const items = Sortiment.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'sortiment-beispiel.csv'), 'utf8')).items;
items.forEach((it, i) => {
  it.warengruppe = i < items.length - 20 ? EIGENE[i % EIGENE.length] : '';
  it.gruppe = W.classify(it);
});

test('keine vorgegebenen Warengruppen, keine automatische Zuordnung', () => {
  assert.deepEqual(W.DEFAULT_ORDER, [...IDS, 'sonstiges']);
  assert.equal(W.nameOf('sonstiges'), 'Ohne Warengruppe');
  assert.equal(W.classify({ name: 'Gouda jung', kategorie: 'Käse', tags: ['en:cheeses'] }), 'sonstiges');
  assert.equal(W.idOf('Käse'), null);
});

test('classify: Warengruppe aus der Spalte "warengruppe" (Name oder id, Groß/klein egal), sonst "Ohne Warengruppe"', () => {
  assert.equal(W.classify({ name: 'Gouda', warengruppe: 'Kühlregal' }), 'x-kuehlregal');
  assert.equal(W.classify({ name: 'Gouda', warengruppe: ' tiefkühl ' }), 'x-tiefkuehl');
  assert.equal(W.classify({ name: 'Gouda', warengruppe: 'x-getraenke' }), 'x-getraenke');
  assert.equal(W.classify({ name: 'Gouda', warengruppe: 'Gibt es nicht' }), 'sonstiges');
  assert.equal(W.classify({ name: 'Gouda' }), 'sonstiges');
});

test('arrange: Gruppen in Laufweg-Reihenfolge, jeder Artikel genau einmal', () => {
  const sorted = W.arrange(items, W.DEFAULT_ORDER, 12345);
  assert.equal(sorted.length, items.length);
  assert.equal(new Set(sorted).size, items.length);
  const rank = (g) => W.DEFAULT_ORDER.indexOf(g);
  for (let i = 1; i < sorted.length; i++) assert.ok(rank(sorted[i - 1].gruppe) <= rank(sorted[i].gruppe));
  assert.equal(sorted[sorted.length - 1].gruppe, 'sonstiges');
});

test('arrange: gleicher seed = gleiche Mischung, anderer seed = andere Mischung', () => {
  const codes = (seed, order) => W.arrange(items, order || W.DEFAULT_ORDER, seed).map((it) => it.code);
  assert.deepEqual(codes(1), codes(1));
  assert.notDeepEqual(codes(1), codes(2));
  // innerhalb einer Gruppe gemischt, nicht in CSV-Reihenfolge
  const csv = items.filter((it) => it.gruppe === 'x-kuehlregal').map((it) => it.code);
  assert.notDeepEqual(codes(1).filter((c) => csv.includes(c)), csv);
  // Laufweg ändern verschiebt nur die Gruppen, die Mischung innerhalb bleibt gleich
  const umgestellt = ['x-tiefkuehl', ...W.DEFAULT_ORDER.filter((g) => g !== 'x-tiefkuehl')];
  const inGruppe = (list, g) => list.filter((c) => items.find((it) => it.code === c).gruppe === g);
  assert.deepEqual(inGruppe(codes(7, umgestellt), 'x-kuehlregal'), inGruppe(codes(7), 'x-kuehlregal'));
  assert.equal(items.find((it) => it.code === codes(7, umgestellt)[0]).gruppe, 'x-tiefkuehl');
});

test('normalizeOrder: unbekannte raus, fehlende rein, "Ohne Warengruppe" zuletzt', () => {
  const order = W.normalizeOrder(['x-tiefkuehl', 'kaese', 'sonstiges', 'x-getraenke', 'x-tiefkuehl']);
  assert.equal(order[0], 'x-tiefkuehl');
  assert.equal(order[1], 'x-getraenke');
  assert.equal(order[order.length - 1], 'sonstiges');
  assert.deepEqual([...order].sort(), [...W.DEFAULT_ORDER].sort());
  // alte, vorgegebene Gruppen aus einem gespeicherten Laufweg fallen weg
  assert.deepEqual(W.normalizeOrder(['obst', 'kaese', 'tk']), W.DEFAULT_ORDER);
});

test('normalizeOrder: neu angelegte Gruppe kommt in einem gespeicherten Laufweg ans Ende (vor "Ohne Warengruppe")', () => {
  const gespeichert = ['x-tiefkuehl', 'x-kuehlregal', 'x-trockenware', 'x-getraenke', 'sonstiges'];
  const neu = W.register('Aktion');
  const order = W.normalizeOrder(gespeichert);
  assert.deepEqual(order, ['x-tiefkuehl', 'x-kuehlregal', 'x-trockenware', 'x-getraenke', neu, 'sonstiges']);
});
