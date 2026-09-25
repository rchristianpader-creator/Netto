/*
 * Erfassen: per Kamera (oder Scanner) gescannte EANs ohne Rückfrage ins Sortiment aufnehmen.
 * Was schon im Sortiment ist (auch schon selbst erfasst), wird nicht nochmal aufgenommen.
 * Die eigene Liste ist ein Array aus { code, at, name?, marke?, inhalt?, quelle?, tags?, gruppe?, synced? }
 * (at = Zeitpunkt in ms; name/marke/inhalt/quelle/tags = nachgeschlagene Bezeichnung und Kategorien;
 * gruppe = beim Scannen fest gewählte Warengruppe (Name), sonst automatisch;
 * synced = schon in die Sortiment-Datei auf GitHub übernommen), gespeichert im Browser.
 */
(function (root, factory) {
  const api = factory(root.EAN || (typeof require === 'function' ? require('./ean.js') : null));
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Erfassung = api;
})(typeof self !== 'undefined' ? self : this, function (EAN) {
  'use strict';

  const NAME = 'Selbst gescannter Artikel';

  const cleanTags = (tags) => (Array.isArray(tags) ? tags.filter((t) => typeof t === 'string' && t).slice(0, 40) : []);

  /** Gespeicherte Liste bereinigen: nur gültige EANs, jede nur einmal, ohne die aus `exclude` (Set von Codes). */
  function normalizeList(list, exclude) {
    const seen = new Set(exclude || []);
    const out = [];
    (Array.isArray(list) ? list : []).forEach((e) => {
      const norm = e && EAN.normalize(String(e.code || ''));
      if (!norm || !norm.valid || seen.has(norm.code)) return;
      seen.add(norm.code);
      const entry = { code: norm.code, at: Number.isFinite(e.at) ? e.at : 0 };
      ['name', 'marke', 'inhalt', 'quelle', 'gruppe'].forEach((k) => {
        if (typeof e[k] === 'string' && e[k].trim()) entry[k] = e[k].trim();
      });
      const tags = cleanTags(e.tags);
      if (tags.length) entry.tags = tags;
      if (e.synced === true) entry.synced = true;
      out.push(entry);
    });
    return out;
  }

  /**
   * Einen gescannten Code verarbeiten. `known(code)` liefert den Artikel, wenn die EAN schon im Sortiment ist.
   * Ergebnis: { status: 'added' | 'known' | 'invalid', code, item?, list }
   * (bei 'added' ist `list` die neue Liste, sonst die unveränderte).
   * `gruppe` (optional): feste Warengruppe (Name) für diesen Scan statt automatischer Zuordnung.
   */
  function capture(list, raw, known, now, gruppe) {
    const norm = EAN.normalize(String(raw || ''));
    if (!norm || !norm.valid) return { status: 'invalid', code: norm ? norm.code : String(raw || ''), list };
    const item = known(norm.code);
    if (item) return { status: 'known', code: norm.code, item, list };
    const entry = { code: norm.code, at: now };
    if (gruppe) entry.gruppe = String(gruppe);
    return { status: 'added', code: norm.code, list: list.concat(entry) };
  }

  /**
   * Ladeninterne Nummer (GS1-Präfix 20–29 bei EAN-13, 2 bei EAN-8), z. B. vom Netto-Regaletikett
   * (Code 128 mit 27…): gilt nur im Laden, Produktdatenbanken kennen sie nicht.
   */
  const isInStore = (code) => /^2\d{12}$|^2\d{7}$/.test(String(code));

  /** Nachgeschlagene Bezeichnung ({ name, marke, inhalt, quelle, tags }) bei einer EAN eintragen. */
  function describe(list, code, info) {
    if (!info || !info.name) return list;
    const found = {};
    ['name', 'marke', 'inhalt', 'quelle'].forEach((k) => {
      if (info[k]) found[k] = info[k];
    });
    const tags = cleanTags(info.tags);
    if (tags.length) found.tags = tags;
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
        warengruppe: e.gruppe || '',
        tags: e.tags || [],
        quelle: e.quelle ? 'Kamera-Scan; ' + e.quelle : 'Kamera-Scan',
        eigen: true,
        at: e.at,
      })
    );
  }

  const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

  const HEADER = 'ean;produktname;marke;inhalt;kategorie;warengruppe;status;quelle;datenstand';
  const cell = (v) => (/[;"\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v);
  const quelleOf = (e) => (e.quelle ? 'Kamera-Scan; ' + e.quelle : 'Kamera-Scan');

  // Werte einer Zeile nach Spaltenname; `e.gruppe` = Name der Warengruppe (vom Aufrufer bestimmt).
  const record = (e) => ({
    ean: e.code,
    produktname: e.name || NAME,
    marke: e.marke || '',
    inhalt: e.inhalt || '',
    kategorie: '',
    warengruppe: e.gruppe || '',
    status: 'selbst gescannt',
    quelle: quelleOf(e),
    datenstand: isoDay(e.at || 0),
  });

  // Zeile passend zur Kopfzeile der Datei (unbekannte Spalten bleiben leer, fehlende werden weggelassen).
  const csvRow = (e, columns) => {
    const r = record(e);
    return columns.map((c) => cell(r[c] || '')).join(';');
  };

  const columnsOf = (text) =>
    String(text || '').replace(/^﻿/, '').split(/\r?\n/, 1)[0].split(';').map((c) => c.trim().toLowerCase());

  /** CSV im Format von data/netto-sortiment.csv, damit die Codes dort übernommen werden können. */
  function toCSV(list) {
    const columns = HEADER.split(';');
    return '﻿' + [HEADER].concat(list.map((e) => csvRow(e, columns))).join('\n') + '\n';
  }

  /**
   * Selbst erfasste EANs an den Text der Sortiment-CSV anhängen, nur die, die dort noch fehlen.
   * `existing` = Set der EANs, die schon in der Datei stehen. Ergebnis: { text, added: [codes] }.
   * Die Spalten richten sich nach der Kopfzeile der Datei.
   */
  function appendToCSV(text, list, existing) {
    const added = [];
    list.forEach((e) => {
      if (!existing.has(e.code) && !added.includes(e.code)) added.push(e.code);
    });
    if (!added.length) return { text, added };
    const columns = text.trim() ? columnsOf(text) : HEADER.split(';');
    const head = text.trim() ? text : '﻿' + HEADER + '\n';
    const rows = added.map((code) => csvRow(list.find((e) => e.code === code), columns));
    const base = head.endsWith('\n') ? head : head + '\n';
    return { text: base + rows.join('\n') + '\n', added };
  }

  /**
   * Filter für einen laufenden Kamera-Scan: Ein Code zählt erst, wenn er `confirm`-mal hintereinander
   * gelesen wurde (schützt vor Fehllesungen). Danach wird derselbe Code ignoriert, solange er im Bild
   * bleibt, also bis er `holdMs` lang nicht mehr gelesen wurde.
   */
  class ReadFilter {
    constructor(opts) {
      // gapMs großzügig: die Kamera wechselt zwischen mehreren Suchversuchen, nicht jedes Bild findet den Code
      const o = Object.assign({ confirm: 2, gapMs: 1500, holdMs: 1500 }, opts);
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

  return { NAME, normalizeList, capture, describe, isInStore, toItems, toCSV, appendToCSV, ReadFilter };
});
