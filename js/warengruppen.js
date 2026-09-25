/*
 * Warengruppen und Laufweg: Es gibt nur selbst angelegte Warengruppen (beim Erfassen gewählt, in der CSV-Spalte
 * "warengruppe") und "Ohne Warengruppe". Das Sortiment wird sortiert, als würde man durch den Laden gehen:
 * Gruppen in Laufweg-Reihenfolge, Artikel innerhalb einer Gruppe zufällig gemischt (reproduzierbar über "seed").
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Warengruppen = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Keine vorgegebenen Warengruppen: nur "Ohne Warengruppe" (id 'sonstiges', immer zuletzt) und eigene.
  const GRUPPEN = [{ id: 'sonstiges', name: 'Ohne Warengruppe' }];
  const BY_ID = new Map(GRUPPEN.map((g) => [g.id, g]));
  const DEFAULT_ORDER = GRUPPEN.map((g) => g.id);

  /** Warengruppe (id) zu einem Namen oder einer id; sonst null. */
  function idOf(nameOrId) {
    const key = String(nameOrId || '').trim().toLowerCase();
    if (!key) return null;
    const g = GRUPPEN.find((x) => x.id === key || x.name.toLowerCase() === key);
    return g ? g.id : null;
  }

  /**
   * Eigene Warengruppe anlegen (z. B. "Aktion"); gibt die id zurück, bei schon vorhandenem Namen dessen id.
   * Neue Gruppen kommen im Laufweg ans Ende (vor "Ohne Warengruppe") und lassen sich verschieben.
   */
  function register(name) {
    const clean = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    if (!clean) return null;
    const known = idOf(clean);
    if (known) return known;
    const slug = clean
      .toLowerCase()
      .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
      .normalize('NFKD').replace(/[\u0300-\u036f]/g, '') // übrige Akzente weg
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const base = 'x-' + (slug || 'gruppe');
    let id = base;
    for (let n = 2; BY_ID.has(id); n++) id = base + '-' + n;
    const g = { id, name: clean };
    GRUPPEN.splice(GRUPPEN.length - 1, 0, g); // vor "Ohne Warengruppe"
    DEFAULT_ORDER.splice(DEFAULT_ORDER.length - 1, 0, id);
    BY_ID.set(id, g);
    return id;
  }

  /** Warengruppe (id) eines Artikels: die in der Spalte "warengruppe" angegebene, sonst "Ohne Warengruppe". */
  function classify(item) {
    return idOf(item.warengruppe) || 'sonstiges';
  }

  /**
   * Gespeicherte Reihenfolge bereinigen: unbekannte raus, fehlende (z. B. neu angelegte) ans Ende,
   * "Ohne Warengruppe" immer zuletzt.
   */
  function normalizeOrder(order) {
    const result = (Array.isArray(order) ? order : []).filter((id, i, a) => BY_ID.has(id) && a.indexOf(id) === i);
    DEFAULT_ORDER.forEach((id) => {
      if (!result.includes(id)) result.push(id);
    });
    return result.filter((id) => id !== 'sonstiges').concat('sonstiges');
  }

  // Stabiler Pseudozufall je (seed, EAN): gleiche Mischung nach Neuladen, neue Mischung bei neuem seed.
  function hash(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    h ^= h >>> 16;
    h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return h >>> 0;
  }

  /** Sortiert Artikel nach Laufweg; innerhalb jeder Warengruppe zufällig (abhängig von seed). */
  function arrange(items, order, seed) {
    const rank = new Map(normalizeOrder(order).map((id, i) => [id, i]));
    const key = (it) => hash(seed + ':' + it.code);
    return items
      .map((it) => ({ it, g: rank.get(it.gruppe || 'sonstiges'), k: key(it) }))
      .sort((a, b) => a.g - b.g || a.k - b.k)
      .map((x) => x.it);
  }

  const nameOf = (id) => (BY_ID.get(id) || BY_ID.get('sonstiges')).name;

  return { GRUPPEN, DEFAULT_ORDER, classify, idOf, register, arrange, normalizeOrder, nameOf, hash };
});
