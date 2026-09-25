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

test('describe: Bezeichnung eintragen (Warengruppe bleibt Sache des Nutzers); CSV-Zeile mit Name', () => {
  let list = [{ code: '4316268476096', at: Date.UTC(2026, 8, 25) }, { code: '4006381333931', at: 0 }];
  list = Erfassung.describe(list, '4316268476096', { name: 'Gouda jung', marke: 'Gutes Land', inhalt: '400 g', quelle: 'Open Food Facts' });
  assert.deepEqual(list[1], { code: '4006381333931', at: 0 });
  const [gouda, ohne] = Erfassung.toItems(list);
  assert.equal(gouda.name, 'Gouda jung');
  assert.equal(W.classify(gouda), 'sonstiges'); // keine automatische Zuordnung
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

test('lookupDetailed: "nicht gefunden" und Fehler werden unterschieden (Fehler → neuer Versuch lohnt sich)', async () => {
  const reply = (status, body) => ({ ok: status < 300, status, json: async () => body });
  const route = (handlers) => async (url) => handlers[new URL(url).host](url);
  const off = 'world.openfoodfacts.org';
  const obf = 'world.openbeautyfacts.org';

  // neuere API-Antwort mit status "success"
  let r = await Produktinfo.lookupDetailed('1', route({ [off]: () => reply(200, { status: 'success', product: { product_name: 'Kaffee' } }) }));
  assert.equal(r.info.name, 'Kaffee');
  assert.equal(r.error, undefined);

  // beide Quellen kennen die EAN nicht: kein Fehler
  r = await Produktinfo.lookupDetailed('2', route({ [off]: () => reply(404, { status: 0 }), [obf]: () => reply(404, { status: 0 }) }));
  assert.deepEqual(r, { info: null });
  r = await Produktinfo.lookupDetailed('2', route({ [off]: () => reply(200, { status: 0, status_verbose: 'product not found' }), [obf]: () => reply(404, {}) }));
  assert.deepEqual(r, { info: null });

  // Überlastung / zu viele Anfragen: Fehler, nicht "unbekannt"
  r = await Produktinfo.lookupDetailed('3', route({ [off]: () => reply(429, {}), [obf]: () => reply(404, {}) }));
  assert.equal(r.info, null);
  assert.match(r.error, /Open Food Facts antwortet mit Fehler 429 \(zu viele Anfragen\)/);

  // offline
  r = await Produktinfo.lookupDetailed('4', route({ [off]: () => { throw new TypeError('Load failed'); }, [obf]: () => { throw new TypeError('Load failed'); } }));
  assert.match(r.error, /nicht erreichbar/);

  // Zeitüberschreitung (abgebrochene Anfrage)
  const abort = () => { throw Object.assign(new Error('aborted'), { name: 'AbortError' }); };
  r = await Produktinfo.lookupDetailed('5', route({ [off]: abort, [obf]: () => reply(404, {}) }));
  assert.match(r.error, /Zeitüberschreitung/);

  // Fehler bei der einen, Treffer bei der anderen Quelle: Treffer zählt
  r = await Produktinfo.lookupDetailed('6', route({ [off]: () => reply(503, {}), [obf]: () => reply(200, { status: 1, product: { product_name: 'Duschgel' } }) }));
  assert.equal(r.info.name, 'Duschgel');
  assert.equal(r.error, undefined);
});
