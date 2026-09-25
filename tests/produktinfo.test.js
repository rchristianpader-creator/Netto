const test = require('node:test');
const assert = require('node:assert/strict');
const Produktinfo = require('../js/produktinfo.js');
const Erfassung = require('../js/erfassung.js');
const W = require('../js/warengruppen.js');

// Nachgebaute Datenbanken: je Host eine Tabelle EAN → product
function fakeFetch(tables, calls) {
  return async (url) => {
    calls && calls.push(url);
    const host = new URL(url).host;
    const code = url.match(/product\/(\d+)\.json/)[1];
    if (tables[host] === 'offline') throw new TypeError('Failed to fetch');
    const p = (tables[host] || {})[code];
    if (!p) return { ok: false, status: 404, json: async () => ({ status: 0 }) };
    return { ok: true, status: 200, json: async () => ({ status: 1, product: p }) };
  };
}

test('lookup: deutscher Name, erste Marke, Inhalt; Quelle angegeben', async () => {
  const calls = [];
  const f = fakeFetch(
    { 'world.openfoodfacts.org': { '4316268476096': { product_name_de: ' Gouda  jung ', product_name: 'Young gouda', brands: 'Gutes Land, Netto', quantity: '400 g', categories_tags: ['en:dairies', 'en:cheeses'] } } },
    calls
  );
  assert.deepEqual(await Produktinfo.lookup('4316268476096', f), { name: 'Gouda jung', marke: 'Gutes Land', inhalt: '400 g', tags: ['en:dairies', 'en:cheeses'], quelle: 'Open Food Facts' });
  assert.equal(calls.length, 1);
  assert.match(calls[0], /fields=product_name_de,product_name,.*categories_tags/);
});

test('lookup: ohne deutschen Namen den allgemeinen; sonst Open Beauty Facts; sonst null', async () => {
  const f = fakeFetch({
    'world.openfoodfacts.org': { '1': { product_name: 'Hafercookies' }, '3': { product_name: '', brands: 'X' } },
    'world.openbeautyfacts.org': { '2': { product_name_de: 'Pflege Shampoo', brands: 'Hairwell' } },
  });
  assert.equal((await Produktinfo.lookup('1', f)).name, 'Hafercookies');
  assert.deepEqual(await Produktinfo.lookup('2', f), { name: 'Pflege Shampoo', marke: 'Hairwell', inhalt: '', tags: [], quelle: 'Open Beauty Facts' });
  assert.equal(await Produktinfo.lookup('3', f), null); // Eintrag ohne Namen hilft nicht
  assert.equal(await Produktinfo.lookup('4', f), null);
  // offline bei Open Food Facts: weiter mit Open Beauty Facts, kein Fehler
  const off = fakeFetch({ 'world.openfoodfacts.org': 'offline', 'world.openbeautyfacts.org': { '2': { product_name: 'Duschgel' } } });
  assert.equal((await Produktinfo.lookup('2', off)).name, 'Duschgel');
  assert.equal(await Produktinfo.lookup('9', fakeFetch({ 'world.openfoodfacts.org': 'offline', 'world.openbeautyfacts.org': 'offline' })), null);
});

test('describe: Bezeichnung eintragen, daraus automatisch die Warengruppe; CSV-Zeile mit Name', () => {
  let list = [{ code: '4316268476096', at: Date.UTC(2026, 8, 25) }, { code: '4006381333931', at: 0 }];
  list = Erfassung.describe(list, '4316268476096', { name: 'Gouda jung', marke: 'Gutes Land', inhalt: '400 g', quelle: 'Open Food Facts' });
  assert.deepEqual(list[1], { code: '4006381333931', at: 0 });
  const [gouda, ohne] = Erfassung.toItems(list);
  assert.equal(gouda.name, 'Gouda jung');
  assert.equal(W.classify(gouda), 'kaese');
  assert.equal(ohne.name, Erfassung.NAME);
  assert.equal(W.classify(ohne), 'sonstiges');
  assert.equal(Erfassung.describe(list, '4006381333931', null), list);

  const csv = Erfassung.toCSV([Object.assign({}, list[0], { gruppe: 'Käse' })]).split('\n')[1];
  assert.equal(csv, '4316268476096;Gouda jung;Gutes Land;400 g;;Käse;selbst gescannt;"Kamera-Scan; Open Food Facts";2026-09-25');
  // Semikolon oder Anführungszeichen im Namen werden korrekt maskiert
  const odd = Erfassung.describe(list, '4006381333931', { name: 'Chips "Paprika"; scharf' });
  const Sortiment = require('../js/sortiment.js');
  const parsed = Sortiment.parse(Erfassung.toCSV(odd)).items;
  assert.equal(parsed[1].name, 'Chips "Paprika"; scharf');
  assert.equal(parsed[0].quelle, 'Kamera-Scan; Open Food Facts');
  // Bezeichnung bleibt beim Speichern/Laden erhalten
  assert.deepEqual(Erfassung.normalizeList(JSON.parse(JSON.stringify(odd))), odd);
});

test('Warengruppe aus den Kategorien von Open Food Facts (vor dem Namen)', () => {
  const faelle = [
    [['en:beverages', 'en:hot-beverages', 'en:coffees', 'en:ground-coffees'], 'kaffee'],
    [['en:beverages', 'en:hot-beverages', 'en:teas', 'en:green-teas'], 'kaffee'],
    [['en:spreads', 'en:sweet-spreads', 'en:honeys'], 'fruehstueck'],
    [['en:dairies', 'en:fermented-milk-products', 'en:cheeses', 'en:goudas'], 'kaese'],
    [['en:dairies', 'en:fermented-milk-products', 'en:desserts', 'en:dairy-desserts', 'en:yogurts'], 'joghurt'],
    [['en:dairies', 'en:fermented-milk-products', 'en:cheeses', 'en:fresh-cheeses', 'en:quarks'], 'dessert'],
    [['en:beverages', 'en:plant-based-beverages', 'en:milk-substitutes', 'en:plant-based-milk-alternatives'], 'milch'],
    [['en:dairies', 'en:milks', 'en:uht-milks'], 'hmilch'],
    [['en:beverages', 'en:fruit-based-beverages', 'en:juices-and-nectars', 'en:orange-juices'], 'getraenke'],
    [['en:snacks', 'en:sweet-snacks', 'en:confectioneries', 'en:chocolates'], 'snacks'],
    [['en:meats', 'en:prepared-meats', 'en:sausages'], 'wurst'],
    [['en:meats', 'en:poultries', 'en:chickens', 'en:chicken-breasts'], 'fleisch'],
    [['en:frozen-foods', 'en:pizzas'], 'tk'],
    [['en:canned-foods', 'en:canned-fishes', 'en:sardines'], 'konserven'],
    [['en:cereals-and-potatoes', 'en:pastas', 'en:spaghetti'], 'nudeln'],
    [['en:condiments', 'en:sauces', 'en:ketchup'], 'saucen'],
    [['en:cereals-and-potatoes', 'en:breads'], 'brot'],
  ];
  for (const [tags, gruppe] of faelle) assert.equal(W.classify({ name: 'egal', tags }), gruppe, tags.join(','));
  // Kategorie schlägt einen irreführenden Namen
  assert.equal(W.classify({ name: 'Milchkaffee Klassisch', tags: ['en:coffees'] }), 'kaffee');
  // ohne Kategorien: Name; "Klassisch" enthält "lassi", ist aber kein Lassi
  assert.equal(W.classify({ name: 'Kaffee Auslese Klassisch-Mild' }), 'kaffee');
  assert.equal(W.classify({ name: 'Café Gold' }), 'kaffee');
  assert.equal(W.classify({ name: 'Kräutertee' }), 'kaffee');
  assert.equal(W.classify({ name: 'Erdbeer Fruchtaufstrich' }), 'fruehstueck');
  assert.equal(W.classify({ name: 'Mango Lassi' }), 'milch');
  // Open Beauty Facts → Drogerie
  assert.equal(W.classify({ name: 'Pflege Shampoo', quelle: 'Kamera-Scan; Open Beauty Facts' }), 'drogerie');
  // Warengruppe aus der CSV hat Vorrang
  assert.equal(W.classify({ name: 'Gouda', tags: ['en:coffees'], warengruppe: 'Käse' }), 'kaese');
});
