/*
 * Tagesliste: jeden Tag eine neue Zufallsauswahl aus dem Sortiment, standardmäßig 50 bis 80 Artikel
 * (auch die Anzahl ist zufällig). Alles hängt nur vom Zufallswert "seed" ab; der seed eines Tages ergibt
 * sich aus dem Datum – so bleibt die Liste den ganzen Tag gleich (auch nach dem Neuladen, auf jedem Gerät)
 * und am nächsten Tag kommt eine neue.
 */
(function (root, factory) {
  const api = factory(root.Warengruppen || (typeof require === 'function' ? require('./warengruppen.js') : null));
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Tagesliste = api;
})(typeof self !== 'undefined' ? self : this, function (Warengruppen) {
  'use strict';

  const hash = Warengruppen.hash;
  const DEFAULT_RANGE = Object.freeze({ min: 50, max: 80 });
  const LIMIT = 9999;

  /** Datum in Ortszeit als "JJJJ-MM-TT" (die Liste wechselt um Mitternacht). */
  function dayKey(date) {
    const d = date || new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  /** Zufallswert eines Tages: an jedem Tag ein anderer, am selben Tag immer derselbe. */
  const daySeed = (day) => hash('tagesliste:' + day);

  /** Bereich "Artikel pro Tag" bereinigen: ganze Zahlen ab 1, von ≤ bis; Unbrauchbares → Standard. */
  function normalizeRange(range) {
    const r = range && typeof range === 'object' ? range : {};
    const clean = (v, fallback) => {
      const n = typeof v === 'number' || (typeof v === 'string' && v.trim()) ? Math.round(Number(v)) : NaN;
      return Number.isFinite(n) ? Math.max(1, Math.min(LIMIT, n)) : fallback;
    };
    const a = clean(r.min, DEFAULT_RANGE.min);
    const b = clean(r.max, DEFAULT_RANGE.max);
    return { min: Math.min(a, b), max: Math.max(a, b) };
  }

  /** Anzahl Artikel für diesen seed: zufällig zwischen min und max (beide inklusive), höchstens total. */
  function count(seed, range, total) {
    const r = normalizeRange(range);
    return Math.min(total, r.min + (hash(seed + ':anzahl') % (r.max - r.min + 1)));
  }

  /**
   * Zufallsauswahl für einen seed: Jeder Artikel bekommt eine Losnummer, genommen werden die kleinsten.
   * Kommen Artikel ins Sortiment dazu oder fallen weg, bleibt der Rest der Auswahl gleich.
   */
  function pick(items, seed, range) {
    const n = count(seed, range, items.length);
    return items
      .map((it) => ({ it, los: hash(seed + ':los:' + it.code) }))
      .sort((a, b) => a.los - b.los)
      .slice(0, n)
      .map((x) => x.it);
  }

  return { DEFAULT_RANGE, dayKey, daySeed, normalizeRange, count, pick };
});
