/*
 * Artikelbezeichnung zu einer EAN nachschlagen: erst Open Food Facts (Lebensmittel),
 * dann Open Beauty Facts (Drogerie). Beide sind freie Datenbanken mit offener API (CORS erlaubt).
 * Liefert { name, marke, inhalt, quelle } oder null, wenn die EAN dort nicht bekannt ist.
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
  const FIELDS = 'product_name_de,product_name,generic_name_de,brands,quantity';
  const TIMEOUT_MS = 8000;

  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();

  /** Antwort der API in { name, marke, inhalt } umwandeln (null, wenn kein Name bekannt ist). */
  function fromProduct(p) {
    if (!p) return null;
    const name = clean(p.product_name_de) || clean(p.product_name) || clean(p.generic_name_de);
    if (!name) return null;
    return { name, marke: clean(String(p.brands || '').split(',')[0]), inhalt: clean(p.quantity) };
  }

  async function fromSource(source, code, fetchFn) {
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctrl && setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetchFn(source.url + code + '.json?fields=' + FIELDS, ctrl ? { signal: ctrl.signal } : {});
      if (!res.ok) return null; // 404: nicht bekannt
      const data = await res.json();
      const info = data && data.status === 1 ? fromProduct(data.product) : null;
      return info && Object.assign(info, { quelle: source.name });
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** Bezeichnung nachschlagen. Netzwerkfehler einer Quelle führen zur nächsten; ohne Treffer null. */
  async function lookup(code, fetchFn) {
    for (const source of SOURCES) {
      try {
        const info = await fromSource(source, code, fetchFn);
        if (info) return info;
      } catch (e) {
        /* offline, Zeitüberschreitung o. ä.: nächste Quelle */
      }
    }
    return null;
  }

  return { lookup, fromProduct, SOURCES };
});
