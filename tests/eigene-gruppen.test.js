const test = require('node:test');
const assert = require('node:assert/strict');
const W = require('../js/warengruppen.js');
const Erfassung = require('../js/erfassung.js');
const Sortiment = require('../js/sortiment.js');

// Eigene Datei: register() verändert die Warengruppen des Moduls.

test('eigene Warengruppe anlegen: vor "Sonstiges", per Name oder id auffindbar, kein Doppel', () => {
  const vorher = W.DEFAULT_ORDER.length;
  const id = W.register('  Aktion  ');
  assert.equal(id, 'x-aktion');
  assert.equal(W.nameOf(id), 'Aktion');
  assert.equal(W.idOf('aktion'), id);
  assert.equal(W.idOf('Käse'), 'kaese');
  assert.equal(W.idOf('gibt es nicht'), null);
  assert.equal(W.register('AKTION'), id); // gleicher Name → gleiche Gruppe
  assert.equal(W.DEFAULT_ORDER.length, vorher + 1);
  assert.equal(W.DEFAULT_ORDER[W.DEFAULT_ORDER.length - 2], id);
  assert.equal(W.DEFAULT_ORDER[W.DEFAULT_ORDER.length - 1], 'sonstiges');
  assert.equal(W.register('Gang 3 – Süßes'), 'x-gang-3-suesses');
  assert.equal(W.register(''), null);
  // gespeicherter Laufweg von vorher bekommt die neuen Gruppen vor "Sonstiges"
  const alt = W.DEFAULT_ORDER.filter((g) => !g.startsWith('x-'));
  const order = W.normalizeOrder(alt);
  assert.deepEqual(order.slice(-3), ['x-aktion', 'x-gang-3-suesses', 'sonstiges']);
});

test('Scan mit fest gewählter Warengruppe: gilt statt der automatischen Zuordnung und steht in der CSV', () => {
  const id = W.register('Aktion');
  let list = Erfassung.capture([], '4002720002117', () => null, 1, 'Aktion').list;
  assert.deepEqual(list, [{ code: '4002720002117', at: 1, gruppe: 'Aktion' }]);
  // Bezeichnung kommt nach, die Gruppe bleibt fest
  list = Erfassung.describe(list, '4002720002117', { name: 'Kaffee Auslese', tags: ['en:coffees'] });
  const [item] = Erfassung.toItems(list);
  assert.equal(W.classify(item), id);
  assert.deepEqual(Erfassung.normalizeList(JSON.parse(JSON.stringify(list))), list);
  // CSV-Zeile trägt die Gruppe; ein anderes Gerät liest sie zurück
  const csv = Erfassung.toCSV(list);
  const [back] = Sortiment.parse(csv).items;
  assert.equal(back.warengruppe, 'Aktion');
  assert.equal(W.classify(back), id);
  // ohne feste Gruppe: automatisch
  const auto = Erfassung.describe(Erfassung.capture([], '4002720002117', () => null, 1, '').list, '4002720002117', { name: 'Kaffee', tags: ['en:coffees'] });
  assert.equal(W.classify(Erfassung.toItems(auto)[0]), 'kaffee');
});
