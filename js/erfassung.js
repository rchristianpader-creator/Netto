/*
 * Erfassen: per Kamera (oder Scanner) gescannte EANs ohne Rückfrage ins Sortiment aufnehmen.
 * Was schon im Sortiment ist (auch schon selbst erfasst), wird nicht nochmal aufgenommen.
 * Die eigene Liste ist ein Array aus { code, at } (at = Zeitpunkt in ms), gespeichert im Browser.
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
      out.push({ code: norm.code, at: Number.isFinite(e.at) ? e.at : 0 });
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

  /** Artikel für das Sortiment (gleiche Felder wie aus der CSV). */
  function toItems(list) {
    return list.map((e) =>
      Object.assign(EAN.normalize(e.code), {
        name: NAME,
        marke: '',
        inhalt: '',
        kategorie: '',
        warengruppe: '',
        eigen: true,
        at: e.at,
      })
    );
  }

  const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

  /** CSV im Format von data/netto-sortiment.csv, damit die Codes dort übernommen werden können. */
  function toCSV(list) {
    const lines = ['ean;produktname;marke;inhalt;kategorie;status;quelle;datenstand'];
    list.forEach((e) => lines.push([e.code, '', '', '', '', 'selbst gescannt', 'Kamera-Scan', isoDay(e.at || 0)].join(';')));
    return '﻿' + lines.join('\n') + '\n';
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

  return { NAME, normalizeList, capture, toItems, toCSV, ReadFilter };
});
