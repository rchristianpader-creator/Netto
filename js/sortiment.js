/*
 * Lädt das Sortiment aus einer CSV-Datei (data/netto-sortiment.csv).
 * Erwartete Spalten (Reihenfolge egal, weitere Spalten werden ignoriert):
 *   ean; produktname; marke; inhalt; kategorie; …; datenstand (optional: warengruppe)
 * Englische Spaltennamen wie bei Open Food Facts gehen auch: ean, product_name, brand, quantity, category.
 * Trennzeichen Semikolon, Komma oder Tab; Felder dürfen in "Anführungszeichen" stehen.
 */
(function (root, factory) {
  const api = factory(root.EAN || (typeof require === 'function' ? require('./ean.js') : null));
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Sortiment = api;
})(typeof self !== 'undefined' ? self : this, function (EAN) {
  'use strict';

  const COLUMNS = {
    ean: ['ean', 'gtin', 'barcode', 'ean-code'],
    name: ['produktname', 'name', 'artikel', 'bezeichnung', 'product_name'],
    marke: ['marke', 'brand'],
    inhalt: ['inhalt', 'menge', 'größe', 'groesse', 'quantity'],
    kategorie: ['kategorie', 'category'],
    warengruppe: ['warengruppe', 'abteilung'],
    datenstand: ['datenstand', 'stand'],
  };

  /** Zerlegt CSV-Text in Zeilen und Felder (RFC-4180-artig, mit wählbarem Trennzeichen). */
  function parseRows(text, delimiter) {
    const s = String(text || '').replace(/^\uFEFF/, '');
    const rows = [];
    let row = [];
    let field = '';
    let quoted = false;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (quoted) {
        if (c !== '"') field += c;
        else if (s[i + 1] === '"') field += s[++i];
        else quoted = false;
      } else if (c === '"') {
        quoted = true;
      } else if (c === delimiter) {
        row.push(field);
        field = '';
      } else if (c === '\n' || c === '\r') {
        if (c === '\r' && s[i + 1] === '\n') i++;
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
      } else {
        field += c;
      }
    }
    if (field || row.length) {
      row.push(field);
      rows.push(row);
    }
    return rows.filter((r) => r.some((f) => f.trim()));
  }

  function detectDelimiter(text) {
    const first = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0];
    const count = (d) => first.split(d).length;
    return [';', '\t', ','].reduce((best, d) => (count(d) > count(best) ? d : best), ';');
  }

  /**
   * Liefert { items: [{code, type, valid, note, name, marke, inhalt, kategorie, warengruppe}], errors: [{row, text}], datenstand }.
   * Doppelte EANs werden nur einmal übernommen.
   */
  function parse(text) {
    const rows = parseRows(text, detectDelimiter(text));
    if (!rows.length) return { items: [], errors: [], datenstand: '' };

    const header = rows[0].map((h) => h.trim().toLowerCase());
    const col = {};
    Object.keys(COLUMNS).forEach((key) => (col[key] = header.findIndex((h) => COLUMNS[key].includes(h))));
    const hasHeader = col.ean >= 0;
    if (!hasHeader) col.ean = 0;

    const items = [];
    const errors = [];
    const seen = new Set();
    let datenstand = '';
    rows.slice(hasHeader ? 1 : 0).forEach((r, k) => {
      const get = (i) => (i >= 0 && r[i] ? r[i].trim() : '');
      const norm = EAN.normalize(get(col.ean));
      if (!norm) {
        errors.push({ row: k + (hasHeader ? 2 : 1), text: r.join(' | ') });
        return;
      }
      if (seen.has(norm.code)) return;
      seen.add(norm.code);
      items.push(
        Object.assign(norm, {
          name: get(col.name),
          marke: get(col.marke),
          inhalt: get(col.inhalt),
          kategorie: get(col.kategorie),
          warengruppe: get(col.warengruppe),
        })
      );
      const stand = get(col.datenstand);
      if (stand > datenstand) datenstand = stand;
    });
    return { items, errors, datenstand };
  }

  /** Lädt und liest die CSV-Datei (immer frisch vom Server, damit Änderungen sofort ankommen). */
  async function load(url) {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return parse(await res.text());
  }

  return { parse, parseRows, load };
});
