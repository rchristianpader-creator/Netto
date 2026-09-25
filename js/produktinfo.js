/*
 * Artikelbezeichnung zu einer EAN nachschlagen: erst Open Food Facts (Lebensmittel),
 * dann Open Beauty Facts (Drogerie). Beide sind freie Datenbanken mit offener API (CORS erlaubt).
 * Liefert { name, marke, inhalt, tags, quelle } oder null, wenn die EAN dort nicht bekannt ist
 * (tags = Kategorien, z. B. "en:ground-coffees", daraus ergibt sich die Warengruppe).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Produktinfo = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SOURCES = [
    { name: 'Open Food Facts', url: 'https://world.openfoodfacts.org/api/v2/product/' },
    { name: 'Open Beauty Facts', url: 'https://world.openbeautyfacts.org/api/v2/product/' },
  ];
  const FIELDS = 'product_name_de,product_name,generic_name_de,brands,quantity,categories_tags';
  const TIMEOUT_MS = 8000;

  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();

  /** Antwort der API in { name, marke, inhalt, tags } umwandeln (null, wenn kein Name bekannt ist). */
  function fromProduct(p) {
    if (!p) return null;
    const name = clean(p.product_name_de) || clean(p.product_name) || clean(p.generic_name_de);
    if (!name) return null;
    const tags = (Array.isArray(p.categories_tags) ? p.categories_tags : []).map(clean).filter(Boolean).slice(0, 40);
    return { name, marke: clean(String(p.brands || '').split(',')[0]), inhalt: clean(p.quantity), tags };
  }

  // Ob die Antwort einen Treffer meldet: API v2 liefert status 1, neuere Versionen "success".
  const found = (data) => !!(data && data.product && (data.status === 1 || data.status === 'success' || data.status === undefined));

  /** Eine Quelle abfragen: Artikel, null (dort unbekannt) oder Fehler (Netz, Zeitüberschreitung, Überlastung). */
  async function fromSource(source, code, fetchFn) {
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctrl && setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetchFn(source.url + code + '.json?fields=' + FIELDS, ctrl ? { signal: ctrl.signal } : {});
      if (res.status === 404) return null; // dort nicht bekannt
      if (!res.ok) throw new Error(source.name + ' antwortet mit Fehler ' + res.status + (res.status === 429 ? ' (zu viele Anfragen)' : ''));
      const data = await res.json();
      const info = found(data) ? fromProduct(data.product) : null;
      return info && Object.assign(info, { quelle: source.name });
    } catch (err) {
      if (err && err.name === 'AbortError') throw new Error(source.name + ' antwortet nicht (Zeitüberschreitung)');
      if (err instanceof TypeError) throw new Error(source.name + ' nicht erreichbar (Internet?)');
      throw err;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * Bezeichnung nachschlagen. Ergebnis: { info } bei Treffer, { info: null } wenn keine Quelle die EAN kennt,
   * { info: null, error } wenn es keinen Treffer gab und mindestens eine Quelle nicht antworten konnte
   * (dann lohnt sich ein neuer Versuch).
   */
  async function lookupDetailed(code, fetchFn) {
    let error = '';
    for (const source of SOURCES) {
      try {
        const info = await fromSource(source, code, fetchFn);
        if (info) return { info };
      } catch (e) {
        error = error || (e && e.message) || 'Fehler beim Nachschlagen';
      }
    }
    return error ? { info: null, error } : { info: null };
  }

  /** Kurzform: Artikel oder null. */
  async function lookup(code, fetchFn) {
    return (await lookupDetailed(code, fetchFn)).info;
  }

  return { lookup, lookupDetailed, fromProduct, SOURCES };
});
