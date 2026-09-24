/*
 * Lädt EAN-Codes von Produkten, die in Open Food Facts (freie Produktdatenbank, ODbL)
 * dem Händler "Netto Marken-Discount" zugeordnet sind – sortiert nach Beliebtheit.
 * https://world.openfoodfacts.org/store/netto-marken-discount
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OffImport = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const API = 'https://world.openfoodfacts.org/api/v2/search';
  const STORE_TAG = 'netto-marken-discount';
  const PAGE_SIZE = 100;
  const MAX_PAGES = 4;

  async function fetchJson(url, timeoutMs) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  const clean = (s) => String(s || '').replace(/[;\t\r\n|]+/g, ' ').replace(/\s+/g, ' ').trim();

  /** Macht aus einem Open-Food-Facts-Produkt eine Listenzeile {code, name} oder null. */
  function toEntry(product, EAN) {
    const norm = EAN.normalize(product && product.code);
    if (!norm || !norm.valid) return null;
    const title = clean(product.product_name_de) || clean(product.product_name);
    const brand = clean(String(product.brands || '').split(',')[0]);
    const name = [title, brand && !title.toLowerCase().includes(brand.toLowerCase()) ? brand : '', clean(product.quantity)]
      .filter(Boolean)
      .join(' – ');
    return { code: norm.code, name };
  }

  /** Lädt bis zu `count` Produkte. onProgress(anzahl) wird nach jeder Seite aufgerufen. */
  async function loadNettoProducts(count, EAN, onProgress) {
    const entries = [];
    const seen = new Set();
    for (let page = 1; entries.length < count && page <= MAX_PAGES; page++) {
      const params = new URLSearchParams({
        stores_tags: STORE_TAG,
        fields: 'code,product_name,product_name_de,brands,quantity',
        sort_by: 'unique_scans_n',
        page_size: String(PAGE_SIZE),
        page: String(page),
      });
      const data = await fetchJson(API + '?' + params.toString(), 20000);
      const products = (data && data.products) || [];
      for (const p of products) {
        const e = toEntry(p, EAN);
        if (e && !seen.has(e.code)) {
          seen.add(e.code);
          entries.push(e);
        }
      }
      if (onProgress) onProgress(Math.min(entries.length, count));
      if (products.length < PAGE_SIZE) break;
    }
    return entries.slice(0, count);
  }

  return { loadNettoProducts, toEntry, STORE_TAG };
});
