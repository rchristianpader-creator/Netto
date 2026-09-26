/*
 * Tagesliste: jeden Tag eine neue Zufallsauswahl aus dem Sortiment, standardmäßig 50 bis 80 Artikel
 * (auch die Anzahl ist zufällig). Alles hängt nur vom Zufallswert "seed" ab; der seed eines Tages ergibt
 * sich aus dem Datum und der zufälligen Kennung des Geräts – so hat jedes Gerät eine andere Liste, die
 * auf diesem Gerät den ganzen Tag gleich bleibt (auch nach dem Neuladen); am nächsten Tag kommt eine neue.
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

  /**
   * Zufallswert eines Tages: an jedem Tag ein anderer, am selben Tag immer derselbe. Mit Gerätekennung
   * (device) bekommt jedes Gerät einen eigenen; ohne gilt der frühere, für alle gleiche Wert.
   */
  const daySeed = (day, device) => hash('tagesliste:' + day + (device ? ':' + device : ''));

  /** Neue zufällige Gerätekennung (einmal pro Gerät erzeugt und gespeichert). */
  function newDeviceId() {
    const bytes = new Uint8Array(8);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(bytes);
    else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }

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

  // Häufigkeit je Warengruppe: Gewicht beim Auslosen ("selten" z. B. für Fix-Tüten, die sich wenig verkaufen)
  const HAEUFIGKEIT = Object.freeze({ selten: 0.35, normal: 1, oft: 2.5 });

  /**
   * Zufallsauswahl für einen seed: Jeder Artikel bekommt eine Losnummer, genommen werden die kleinsten.
   * Mit Gewichten (weightOf(item) > 0, Standard 1) wird gewichtet gezogen, ohne Zurücklegen: Die Losnummer
   * u ∈ (0,1) wird zu −ln(1−u)/Gewicht (Verfahren von Efraimidis/Spirakis) – ein doppelt so hohes Gewicht
   * gibt ungefähr die doppelte Chance. Bei lauter Gewicht 1 ist die Reihenfolge dieselbe wie ohne Gewichte.
   * Kommen Artikel ins Sortiment dazu oder fallen weg, bleibt der Rest der Auswahl gleich.
   */
  function pick(items, seed, range, weightOf) {
    const n = count(seed, range, items.length);
    return items
      .map((it) => {
        const u = (hash(seed + ':los:' + it.code) + 0.5) / 4294967296;
        const w = weightOf ? weightOf(it) : 1;
        return { it, los: -Math.log(1 - u) / (w > 0 ? w : 1) };
      })
      .sort((a, b) => a.los - b.los)
      .slice(0, n)
      .map((x) => x.it);
  }

  return { DEFAULT_RANGE, HAEUFIGKEIT, dayKey, daySeed, newDeviceId, normalizeRange, count, pick };
});
