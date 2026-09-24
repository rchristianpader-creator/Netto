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

test('Kategorie-Kürzel wie bei Open Food Facts: eindeutige legen fest, bei groben entscheidet der Name', () => {
  const faelle = [
    ['Mozzarella Sticks', 'frozen', 'tk'],
    ['Gebratene Nudeln Ente', 'frozen', 'tk'],
    ['Family Cappuccino Karamell', 'coffee_tea', 'fruehstueck'],
    ['Tee Kirsche-Joghurt', 'coffee_tea', 'fruehstueck'],
    ['Zitronensaft', 'sauces_spices_condiments', 'saucen'],
    ['Milchbrötchen', 'bakery', 'brot'],
    ['Naturalis Classic', 'beverages_nonalcoholic', 'getraenke'],
    ['Duschcreme', 'personal_care', 'drogerie'],
    ['Toilettenpapier 3-lagig', 'paper_hygiene', 'haushalt'],
    ['Pablo Trockenfutter', 'pet', 'tier'],
    // grob: dairy
    ['Kräuterquark', 'dairy', 'dessert'],
    ['Joghurt Drink', 'dairy', 'joghurt'],
    ['Kaffeeweißer', 'dairy', 'hmilch'],
    ['Crème fraîche 30%', 'dairy', 'butter'],
    ['Fruchtmolke', 'dairy', 'milch'],
    // grob: meat_fish
    ['Paprika Lyoner', 'meat_fish', 'wurst'],
    ['Hähnchen-Flügel', 'meat_fish', 'fleisch'],
    ['Sardinen in Sonnenblumenöl', 'meat_fish', 'konserven'],
    ['Heringsfilet in Tomaten-Creme', 'meat_fish', 'konserven'],
    ['Lachsfilet', 'meat_fish', 'fleisch'],
    // grob: sweets, plant_based
    ['Alpen Vollmilch Schokolade', 'sweets', 'snacks'],
    ['Weinbrandbohnen', 'sweets', 'snacks'],
    ['Feine Kaffee-Kränze', 'sweets', 'snacks'],
    ['Blütenhonig', 'sweets', 'fruehstueck'],
    ['Agavendicksaft', 'sweets', 'fruehstueck'],
    ['Haferdrink Schoko', 'plant_based', 'hmilch'],
    ['Streichcreme Paprika-Zucchini-Tomate', 'plant_based', 'fruehstueck'],
    // "other" und Unbekanntes: wie ohne Kategorie
    ['10 Frische Eier', 'other', 'eier'],
    ['Kartoffelsalat Essig & Öl', 'other', 'feinkost'],
    ['Gouda', 'constructor', 'kaese'],
  ];
  for (const [name, kategorie, gruppe] of faelle) assert.equal(W.classify({ name, kategorie }), gruppe, name);
  assert.equal(W.classify({ name: 'Pizza Margherita', kategorie: ' Frozen ' }), 'tk');
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

test('normalizeOrder: unbekannte raus, fehlende an ihre Standardstelle, Sonstiges zuletzt', () => {
  const order = W.normalizeOrder(['tk', 'gibtsnicht', 'sonstiges', 'kaese', 'tk']);
  assert.ok(order.indexOf('tk') < order.indexOf('kaese'), 'eigene Reihenfolge bleibt');
  assert.equal(order.indexOf('wurst'), order.indexOf('kaese') + 1, 'Wurst kommt wie im Standard hinter Käse');
  assert.equal(order[order.length - 1], 'sonstiges');
  assert.equal(order.length, W.DEFAULT_ORDER.length);
  assert.deepEqual([...order].sort(), [...W.DEFAULT_ORDER].sort());
  // gespeicherter Laufweg aus der Zeit vor den neuen Gruppen: die kommen an ihre Standardstelle, nicht ans Ende
  const vorher = W.DEFAULT_ORDER.filter((g) => !['eier', 'drogerie', 'haushalt', 'tier'].includes(g));
  assert.deepEqual(W.normalizeOrder(vorher), W.DEFAULT_ORDER);
  const eigener = ['tk', ...vorher.filter((g) => g !== 'tk')];
  assert.deepEqual(W.normalizeOrder(eigener), ['tk', ...W.DEFAULT_ORDER.filter((g) => g !== 'tk')]);
});
