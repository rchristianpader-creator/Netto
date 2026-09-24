/*
 * EAN-8 / EAN-13 (inkl. UPC-A): Prüfziffer, Normalisierung, Listen-Parser und SVG-Rendering.
 * Keine Abhängigkeiten. Im Browser als window.EAN, in Node per require() nutzbar.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EAN = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // L-Codes (linke Hälfte, ungerade Parität). R = Komplement von L, G = R rückwärts.
  const L = ['0001101', '0011001', '0010011', '0111101', '0100011',
             '0110001', '0101111', '0111011', '0110111', '0001011'];
  const R = L.map((p) => p.replace(/[01]/g, (b) => (b === '1' ? '0' : '1')));
  const G = R.map((p) => p.split('').reverse().join(''));

  // Paritätsmuster der linken sechs Ziffern, bestimmt durch die erste Ziffer (EAN-13).
  const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG',
                  'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

  // Ruhezonen (in Modulen) laut GS1: EAN-13 links 11 / rechts 7, EAN-8 beidseitig 7.
  const QUIET = { 13: [11, 7], 8: [7, 7] };
  const TEXT_HEIGHT = 10; // Platz unter den Balken für die Klarschrift (in Modulen)

  /** Prüfziffer (Modulo 10, Gewichte 3/1 von rechts) zu einer Ziffernfolge ohne Prüfziffer. */
  function checkDigit(body) {
    let sum = 0;
    for (let i = body.length - 1, w = 3; i >= 0; i--, w = 4 - w) sum += (body.charCodeAt(i) - 48) * w;
    return String((10 - (sum % 10)) % 10);
  }

  function describe(code, type, note) {
    const expected = checkDigit(code.slice(0, -1));
    const valid = expected === code.slice(-1);
    return {
      code,
      type,
      valid,
      note: valid ? note || '' : 'Prüfziffer falsch (richtig wäre ' + expected + ')',
    };
  }

  /**
   * Bringt eine Eingabe in eine druckbare EAN.
   *  8/13 Ziffern -> unverändert (Prüfziffer wird nur kontrolliert)
   *  7 Ziffern    -> EAN-8, Prüfziffer wird ergänzt
   *  12 Ziffern   -> UPC-A (wird als EAN-13 mit führender 0 dargestellt), sonst EAN-13 ohne Prüfziffer
   *  14 Ziffern   -> GTIN-14 mit führender 0 wird zu EAN-13
   * Liefert null, wenn keine EAN daraus werden kann.
   */
  function normalize(raw) {
    const d = String(raw == null ? '' : raw).replace(/\D/g, '');
    switch (d.length) {
      case 13: return describe(d, 'EAN-13');
      case 8: return describe(d, 'EAN-8');
      case 7: return describe(d + checkDigit(d), 'EAN-8', 'Prüfziffer ergänzt');
      case 12:
        if (checkDigit(d.slice(0, 11)) === d[11]) return describe('0' + d, 'EAN-13', 'UPC-A');
        return describe(d + checkDigit(d), 'EAN-13', 'Prüfziffer ergänzt');
      case 14:
        return d[0] === '0' ? normalize(d.slice(1)) : null;
      default:
        return null;
    }
  }

  /** Vergleicht zwei Codes tolerant (führende Nullen, fehlende Prüfziffer, Präfixe wie "]E0"). */
  function sameCode(a, b) {
    const x = String(a).replace(/\D/g, '').replace(/^0+/, '');
    const y = String(b).replace(/\D/g, '').replace(/^0+/, '');
    if (x.length < 6 || y.length < 6) return false;
    return x === y || x === y.slice(0, -1) || y === x.slice(0, -1);
  }

  /** Modulfolge ('1' = Balken, '0' = Lücke) ohne Ruhezonen: 95 Module (EAN-13) bzw. 67 (EAN-8). */
  function encode(code) {
    if (!/^\d{8}$|^\d{13}$/.test(code)) throw new Error('Nur EAN-8 oder EAN-13 möglich: ' + code);
    const d = code.split('').map(Number);
    let s = '101';
    if (d.length === 13) {
      const parity = PARITY[d[0]];
      for (let i = 1; i <= 6; i++) s += (parity[i - 1] === 'L' ? L : G)[d[i]];
      s += '01010';
      for (let i = 7; i <= 12; i++) s += R[d[i]];
    } else {
      for (let i = 0; i < 4; i++) s += L[d[i]];
      s += '01010';
      for (let i = 4; i < 8; i++) s += R[d[i]];
    }
    return s + '101';
  }

  /** Maße eines Barcodes in Modulen (inkl. Ruhezonen). */
  function geometry(code) {
    const q = QUIET[code.length];
    const bars = code.length === 13 ? 95 : 67;
    return { quietLeft: q[0], quietRight: q[1], bars, width: q[0] + bars + q[1], textHeight: TEXT_HEIGHT };
  }

  // Module, deren Balken als Begrenzungszeichen verlängert werden.
  function isGuard(i, len) {
    if (len === 13) return i < 3 || (i >= 45 && i < 50) || i >= 92;
    return i < 3 || (i >= 31 && i < 36) || i >= 64;
  }

  // x-Mittelpunkte (in Modulen, ab Beginn der Balken) für die Klarschrift unter den Balken.
  function digitCenters(len) {
    const xs = [];
    if (len === 13) {
      for (let i = 0; i < 6; i++) xs.push(3 + 7 * i + 3.5);
      for (let i = 0; i < 6; i++) xs.push(50 + 7 * i + 3.5);
    } else {
      for (let i = 0; i < 4; i++) xs.push(3 + 7 * i + 3.5);
      for (let i = 0; i < 4; i++) xs.push(36 + 7 * i + 3.5);
    }
    return xs;
  }

  /**
   * SVG-Markup eines EAN-8/EAN-13 (schwarz auf weiß, inkl. Ruhezonen und Klarschrift).
   * options.module: CSS-Pixel pro Modul (für gestochen scharfe Balken ganzzahlige Gerätepixel wählen)
   * options.barHeight: Balkenhöhe in Modulen (Standard 55)
   */
  function toSVG(code, options) {
    const opts = options || {};
    const m = opts.module || 3;
    const barH = opts.barHeight || 55;
    const g = geometry(code);
    const pattern = encode(code);
    const guardExtra = 5;
    const height = barH + g.textHeight;

    let rects = '';
    for (let i = 0; i < pattern.length;) {
      if (pattern[i] !== '1') { i++; continue; }
      let j = i;
      while (j < pattern.length && pattern[j] === '1') j++;
      const h = isGuard(i, code.length) ? barH + guardExtra : barH;
      rects += '<rect x="' + (g.quietLeft + i) + '" y="0" width="' + (j - i) + '" height="' + h + '"/>';
      i = j;
    }

    const baseline = barH + 8.5;
    const digits = code.length === 13 ? code.slice(1) : code;
    let text = '';
    digitCenters(code.length).forEach((x, k) => {
      text += '<text x="' + (g.quietLeft + x) + '" y="' + baseline + '">' + digits[k] + '</text>';
    });
    if (code.length === 13) text += '<text x="' + (g.quietLeft - 5) + '" y="' + baseline + '">' + code[0] + '</text>';

    return (
      '<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="' + (code.length === 13 ? 'EAN-13 ' : 'EAN-8 ') + code + '"' +
      ' viewBox="0 0 ' + g.width + ' ' + height + '" width="' + g.width * m + '" height="' + height * m + '">' +
      '<rect width="' + g.width + '" height="' + height + '" fill="#fff"/>' +
      '<g fill="#000" shape-rendering="crispEdges">' + rects + '</g>' +
      '<g fill="#000" font-family="OCR-B, OCRB, ui-monospace, Menlo, Consolas, \'Courier New\', monospace" font-size="8.5" text-anchor="middle">' + text + '</g>' +
      '</svg>'
    );
  }

  /**
   * Liest eine Liste (eine EAN pro Zeile, optional mit Namen davor/dahinter,
   * getrennt durch Tab, Semikolon, Komma oder Leerzeichen). Zeilen mit # sind Kommentare.
   * Liefert { items: [{code, type, valid, note, name, line}], errors: [{line, text}] }.
   */
  function parseList(text) {
    const items = [];
    const errors = [];
    String(text || '').replace(/^﻿/, '').split(/\r\n|\r|\n/).forEach((raw, idx) => {
      const line = raw.trim();
      if (!line || line[0] === '#') return;
      let source = line;
      let m = /(^|\D)(\d{7,14})(?!\d)/.exec(source);
      if (!m) {
        // z. B. "4 006381 333931" wie unter dem Barcode gedruckt
        source = line.replace(/(\d)[ .-](?=\d)/g, '$1');
        m = /(^|\D)(\d{7,14})(?!\d)/.exec(source);
      }
      const norm = m && normalize(m[2]);
      if (!norm) {
        errors.push({ line: idx + 1, text: line });
        return;
      }
      const start = m.index + m[1].length;
      const name = (source.slice(0, start) + ' ' + source.slice(start + m[2].length))
        .replace(/"/g, '')
        .replace(/[\t;|]+/g, ' · ')
        .replace(/\s+/g, ' ')
        .replace(/^[\s·,:–-]+|[\s·,:–-]+$/g, '');
      items.push(Object.assign(norm, { name, line: idx + 1 }));
    });
    return { items, errors };
  }

  return { checkDigit, normalize, sameCode, encode, geometry, toSVG, parseList };
});
