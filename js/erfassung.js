/*
 * Erfassen: per Kamera (oder Scanner) gescannte EANs ohne Rückfrage ins Sortiment aufnehmen.
 * Was schon im Sortiment ist (auch schon selbst erfasst), wird nicht nochmal aufgenommen.
 * Die eigene Liste ist ein Array aus { code, at, name?, marke?, inhalt?, quelle?, synced? }
 * (at = Zeitpunkt in ms; name/marke/inhalt/quelle = nachgeschlagene Bezeichnung;
 * synced = schon in die Sortiment-Datei auf GitHub übernommen), gespeichert im Browser.
 */
(function (root, factory) {
  const api = factory(root.EAN || (typeof require === 'function' ? require('./ean.js') : null));
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Erfassung = api;
})(typeof self !== 'undefined' ? self : this, function (EAN) {
  'use strict';

  const NAME = 'Selbst gescannter Artikel';

  /** Gespeicherte Liste bereinigen: nur gültige EANs, jede nur einmal, ohne die aus `exclude` (Set von Codes). */
  function normalizeList(list, exclude) {
    const seen = new Set(exclude || []);
    const out = [];
    (Array.isArray(list) ? list : []).forEach((e) => {
      const norm = e && EAN.normalize(String(e.code || ''));
      if (!norm || !norm.valid || seen.has(norm.code)) return;
      seen.add(norm.code);
      const entry = { code: norm.code, at: Number.isFinite(e.at) ? e.at : 0 };
      ['name', 'marke', 'inhalt', 'quelle'].forEach((k) => {
        if (typeof e[k] === 'string' && e[k].trim()) entry[k] = e[k].trim();
      });
      if (e.synced === true) entry.synced = true;
      out.push(entry);
    });
    return out;
  }

  /**
   * Einen gescannten Code verarbeiten. `known(code)` liefert den Artikel, wenn die EAN schon im Sortiment ist.
   * Ergebnis: { status: 'added' | 'known' | 'invalid', code, item?, list }
   * (bei 'added' ist `list` die neue Liste, sonst die unveränderte).
   */
  function capture(list, raw, known, now) {
    const norm = EAN.normalize(String(raw || ''));
    if (!norm || !norm.valid) return { status: 'invalid', code: norm ? norm.code : String(raw || ''), list };
    const item = known(norm.code);
    if (item) return { status: 'known', code: norm.code, item, list };
    return { status: 'added', code: norm.code, list: list.concat({ code: norm.code, at: now }) };
  }

  /** Nachgeschlagene Bezeichnung ({ name, marke, inhalt, quelle }) bei einer EAN eintragen. */
  function describe(list, code, info) {
    if (!info || !info.name) return list;
    const found = {};
    ['name', 'marke', 'inhalt', 'quelle'].forEach((k) => {
      if (info[k]) found[k] = info[k];
    });
    return list.map((e) => (e.code === code ? Object.assign({}, e, found) : e));
  }

  /** Artikel für das Sortiment (gleiche Felder wie aus der CSV). */
  function toItems(list) {
    return list.map((e) =>
      Object.assign(EAN.normalize(e.code), {
        name: e.name || NAME,
        marke: e.marke || '',
        inhalt: e.inhalt || '',
        kategorie: '',
        warengruppe: '',
        eigen: true,
        at: e.at,
      })
    );
  }

  const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

  const HEADER = 'ean;produktname;marke;inhalt;kategorie;status;quelle;datenstand';
  const cell = (v) => (/[;"\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v);
  const quelleOf = (e) => (e.quelle ? 'Kamera-Scan; ' + e.quelle : 'Kamera-Scan');
  const csvRow = (e) =>
    [e.code, e.name || NAME, e.marke || '', e.inhalt || '', '', 'selbst gescannt', quelleOf(e), isoDay(e.at || 0)].map(cell).join(';');

  /** CSV im Format von data/netto-sortiment.csv, damit die Codes dort übernommen werden können. */
  function toCSV(list) {
    return '﻿' + [HEADER].concat(list.map(csvRow)).join('\n') + '\n';
  }

  /**
   * Selbst erfasste EANs an den Text der Sortiment-CSV anhängen, nur die, die dort noch fehlen.
   * `existing` = Set der EANs, die schon in der Datei stehen. Ergebnis: { text, added: [codes] }.
   */
  function appendToCSV(text, list, existing) {
    const added = [];
    list.forEach((e) => {
      if (!existing.has(e.code) && !added.includes(e.code)) added.push(e.code);
    });
    if (!added.length) return { text, added };
    const rows = added.map((code) => csvRow(list.find((e) => e.code === code)));
    const base = text.length && !text.endsWith('\n') ? text + '\n' : text;
    return { text: base + rows.join('\n') + '\n', added };
  }

  /**
   * Filter für einen laufenden Kamera-Scan: Ein Code zählt erst, wenn er `confirm`-mal hintereinander
   * gelesen wurde (schützt vor Fehllesungen). Danach wird derselbe Code ignoriert, solange er im Bild
   * bleibt, also bis er `holdMs` lang nicht mehr gelesen wurde.
   */
  class ReadFilter {
    constructor(opts) {
      const o = Object.assign({ confirm: 2, gapMs: 800, holdMs: 1500 }, opts);
      this.o = o;
      this.cand = null;
      this.count = 0;
      this.candAt = -Infinity;
      this.held = null;
      this.heldAt = -Infinity;
    }

    /** Ein gelesener Code (oder null, wenn in diesem Bild nichts erkannt wurde). Liefert den Code, wenn er zählt. */
    push(code, now) {
      if (this.held && now - this.heldAt > this.o.holdMs) this.held = null;
      if (!code) return null;
      if (code === this.held) {
        this.heldAt = now;
        return null;
      }
      if (code === this.cand && now - this.candAt <= this.o.gapMs) this.count++;
      else this.count = 1;
      this.cand = code;
      this.candAt = now;
      if (this.count < this.o.confirm) return null;
      this.cand = null;
      this.count = 0;
      this.held = code;
      this.heldAt = now;
      return code;
    }
  }

  return { NAME, normalizeList, capture, describe, toItems, toCSV, appendToCSV, ReadFilter };
});
