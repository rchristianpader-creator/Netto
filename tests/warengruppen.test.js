const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Sortiment = require('../js/sortiment.js');
const W = require('../js/warengruppen.js');

const items = Sortiment.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'netto-sortiment.csv'), 'utf8')).items;
items.forEach((it) => (it.gruppe = W.classify(it)));
const gruppeVon = (name) => W.classify({ name });

test('jeder Artikel des Netto-Sortiments hat eine Warengruppe (nichts unter "Sonstiges")', () => {
  assert.deepEqual(items.filter((it) => it.gruppe === 'sonstiges').map((it) => it.name), []);
});

test('knifflige Zuordnungen', () => {
  const faelle = {
    'Feiner Leberkäse': 'wurst',
    'Bayerisches Leberkäsbrät': 'fleisch',
    'Butterkäse': 'kaese',
    'Pizzakäse': 'kaese',
    'Steinofen Pizza Salami-Rucola': 'tk',
    'Parmesan Mayonnaise': 'saucen',
    'Panna Cotta mit Mangosauce': 'dessert',
    Buttermilch: 'milch',
    'Buttermilch-Dessert Zitrone-Limette': 'dessert',
    'Sahnekefir Erdbeere': 'milch',
    'Sahnepudding Vollmilchschokolade': 'dessert',
    'H-Schlagsahne': 'hmilch',
    'Haltbarer Schmand': 'hmilch',
    Schlagsahne: 'butter',
    'Frischkäsezubereitung mit Schwarzwälder Schinken': 'kaese',
    'Geflügel-Bierschinken': 'wurst',
    Hähnchenflügel: 'fleisch',
    'Bratwurst grob roh': 'fleisch',
    'Joghurt Mix Vanille & Keks': 'joghurt',
    '4-Korn Joghurt Bircher Müsli': 'joghurt',
    'Espresso macchiato': 'milch',
    'Saftiger Krustenschinken': 'wurst',
    Fleischsalat: 'feinkost',
  };
  for (const [name, gruppe] of Object.entries(faelle)) assert.equal(gruppeVon(name), gruppe, name);
  // Kategorie aus der CSV hat Vorrang vor dem Namen
  assert.equal(W.classify({ name: 'Kartoffeleintopf mit Speck', kategorie: 'Fertiggerichte / Konserven' }), 'konserven');
  // eine Spalte "warengruppe" hat Vorrang vor allem
  assert.equal(W.classify({ name: 'Gouda', warengruppe: 'Tiefkühl' }), 'tk');
});

test('arrange: Gruppen in Laufweg-Reihenfolge, jeder Artikel genau einmal', () => {
  const sorted = W.arrange(items, W.DEFAULT_ORDER, 12345);
  assert.equal(sorted.length, items.length);
  assert.equal(new Set(sorted).size, items.length);
  const rank = (g) => W.DEFAULT_ORDER.indexOf(g);
  for (let i = 1; i < sorted.length; i++) assert.ok(rank(sorted[i - 1].gruppe) <= rank(sorted[i].gruppe));
});

test('arrange: gleicher seed = gleiche Mischung, anderer seed = andere Mischung', () => {
  const codes = (seed, order) => W.arrange(items, order || W.DEFAULT_ORDER, seed).map((it) => it.code);
  assert.deepEqual(codes(1), codes(1));
  assert.notDeepEqual(codes(1), codes(2));
  // innerhalb einer Gruppe gemischt, nicht in CSV-Reihenfolge
  const kaeseCsv = items.filter((it) => it.gruppe === 'kaese').map((it) => it.code);
  const kaeseGemischt = codes(1).filter((c) => kaeseCsv.includes(c));
  assert.notDeepEqual(kaeseGemischt, kaeseCsv);
  // Laufweg ändern verschiebt nur die Gruppen, die Mischung innerhalb bleibt gleich
  const umgestellt = ['tk', ...W.DEFAULT_ORDER.filter((g) => g !== 'tk')];
  const inGruppe = (list, g) => list.filter((c) => items.find((it) => it.code === c).gruppe === g);
  assert.deepEqual(inGruppe(codes(7, umgestellt), 'kaese'), inGruppe(codes(7), 'kaese'));
  assert.equal(items.find((it) => it.code === codes(7, umgestellt)[0]).gruppe, 'tk');
});

test('normalizeOrder: unbekannte raus, fehlende rein, Sonstiges zuletzt', () => {
  const order = W.normalizeOrder(['tk', 'gibtsnicht', 'sonstiges', 'kaese', 'tk']);
  assert.equal(order[0], 'tk');
  assert.equal(order[1], 'kaese');
  assert.equal(order[order.length - 1], 'sonstiges');
  assert.equal(order.length, W.DEFAULT_ORDER.length);
  assert.deepEqual([...order].sort(), [...W.DEFAULT_ORDER].sort());
});
