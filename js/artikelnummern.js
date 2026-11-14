/*
 * Inventur Liste: feste Liste mit fünfstelligen Netto-Artikelnummern, eigene Kategorie in der App. Nur die Nummern,
 * Reihenfolge fest (wird nicht gemischt).
 * Barcode als Code 128 (Zeichensatz B, wie auf den Etiketten) oder als EAN-13 mit führenden Nullen.
 * Im Browser als window.Artikelnummern, in Node per require() nutzbar (EAN wird für die Prüfziffer gebraucht).
 */
(function (root, factory) {
  const EANlib = typeof module === 'object' && module.exports ? require('./ean.js') : root.EAN;
  const api = factory(EANlib);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Artikelnummern = api;
})(typeof self !== 'undefined' ? self : this, function (EAN) {
  'use strict';

  const GRUPPE = 'inventur'; // eigene Kategorie, unabhängig von den Warengruppen des Sortiments
  const GRUPPE_NAME = 'Inventur Liste';

  // Artikelnummern in fester Reihenfolge (wird nicht gemischt)
  const LISTE = [
    '38018', '38032', '38015', '39042', '39020', '39023', '39094', '39025', '39046', '39059', '39106', '39124',
    '39150', '39071', '39096', '39170', '39008', '39010', '39000', '39158', '40148', '40020', '40025', '40141',
    '40142', '40152', '40039', '40421', '40422', '40423', '40101', '40098', '40720', '40100', '39162', '41071',
    '40722', '41020', '41055', '41213', '41329', '41510', '41069', '41221', '41241', '41248', '41269', '41270',
    '41277', '41359', '41518', '41332', '41346', '41153', '41169', '46005', '41371', '41317', '42077', '42088',
    '43073', '43101', '43103', '43125', '43025', '43036', '40084', '43009', '43132', '43054', '43131', '43047',
    '43112', '43126', '44146', '44031', '44137', '44075', '44211', '44212', '44213', '44214', '44156', '44095',
    '44980', '46298', '45263', '44999', '45022', '45099', '45103', '45161', '45270', '45271', '45272', '45331',
    '45345', '45163', '45301', '45330', '45110', '45136', '45268', '45554', '45111', '45200', '45210', '45230',
    '45521', '45540', '46730', '45020', '45239', '45544', '45545', '46370', '48580', '45247', '45308', '45325',
    '45553', '46915', '48634', '46150', '46158', '46746', '46098', '46141', '46082', '46097', '46104', '46111',
    '46119', '46584', '46865', '46877', '46884', '46812', '46220', '46190', '46200', '46230', '46405', '46416',
    '46417', '46827', '46875', '46934', '46500', '46512', '46676', '46296', '46323', '46824', '46863', '45138',
    '46325', '46402', '46805', '46854', '46603', '46607', '46857', '46859', '46860', '46861', '46883', '46886',
    '45156', '46084', '46086', '46118', '46290', '46343', '46912', '46914', '46924', '46946', '46989',
  ];

  // Code 128: Balken-/Lückenbreiten der Werte 0–105, Stoppzeichen mit Abschlussbalken
  const C128 = (
    '212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 ' +
    '113222 123122 123221 223211 221132 221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 ' +
    '212123 212321 232121 111323 131123 131321 112313 132113 132311 211313 231113 231311 112133 112331 132131 ' +
    '113123 113321 133121 313121 211331 231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 ' +
    '314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 112412 122114 122411 142112 142211 ' +
    '241211 221114 413111 241112 134111 111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 ' +
    '214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 114131 311141 411131 211412 211214 211232'
  ).split(' ');
  const STOP = '2331112';
  const START_B = 104;
  const QUIET = 10; // Ruhezone links und rechts in Modulen
  const TEXT_HEIGHT = 10;

  /** Modulfolge ('1' = Balken) eines Code 128 (Zeichensatz B) ohne Ruhezonen. */
  function encode128(text) {
    const s = String(text);
    if (!/^[\x20-\x7e]+$/.test(s)) throw new Error('Code 128 B: nur druckbare ASCII-Zeichen: ' + s);
    const vals = [START_B];
    for (const ch of s) vals.push(ch.charCodeAt(0) - 32);
    let sum = START_B;
    for (let k = 1; k < vals.length; k++) sum += k * vals[k];
    vals.push(sum % 103);
    const widths = vals.map((v) => C128[v]).join('') + STOP;
    let m = '';
    for (let k = 0; k < widths.length; k++) m += (k % 2 ? '0' : '1').repeat(Number(widths[k]));
    return m;
  }

  /** Maße in Modulen (inkl. Ruhezonen), gleiche Form wie EAN.geometry. */
  function geometry(text) {
    const bars = 11 * (String(text).length + 3) + 2;
    return { quietLeft: QUIET, quietRight: QUIET, bars, width: 2 * QUIET + bars, textHeight: TEXT_HEIGHT };
  }

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  /** SVG-Markup eines Code 128 (schwarz auf weiß, mit Klarschrift); Optionen wie EAN.toSVG. */
  function toSVG(text, options) {
    const opts = options || {};
    const m = opts.module || 3;
    const barH = opts.barHeight || 55;
    const g = geometry(text);
    const pattern = encode128(text);
    const height = barH + g.textHeight;
    let rects = '';
    for (let i = 0; i < pattern.length;) {
      if (pattern[i] !== '1') { i++; continue; }
      let j = i;
      while (j < pattern.length && pattern[j] === '1') j++;
      rects += '<rect x="' + (g.quietLeft + i) + '" y="0" width="' + (j - i) + '" height="' + barH + '"/>';
      i = j;
    }
    return (
      '<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Code 128 ' + esc(text) + '"' +
      ' viewBox="0 0 ' + g.width + ' ' + height + '" width="' + g.width * m + '" height="' + height * m + '">' +
      '<rect width="' + g.width + '" height="' + height + '" fill="#fff"/>' +
      '<g fill="#000" shape-rendering="crispEdges">' + rects + '</g>' +
      '<text x="' + g.width / 2 + '" y="' + (barH + 8.5) + '" fill="#000" font-size="8.5" text-anchor="middle"' +
      ' font-family="OCR-B, OCRB, ui-monospace, Menlo, Consolas, \'Courier New\', monospace" letter-spacing="1">' +
      esc(text) + '</text></svg>'
    );
  }

  /** Artikelnummer als EAN-13: links mit Nullen auf 12 Stellen aufgefüllt, Prüfziffer ergänzt. */
  function toEan13(nr) {
    const body = String(nr).replace(/\D/g, '').padStart(12, '0').slice(-12);
    return body + EAN.checkDigit(body);
  }

  /** Barcode eines Artikels im gewünschten Format: { type, value, kind: 'c128' | 'ean' } */
  function barcode(nr, format) {
    return format === 'ean' ? { type: 'EAN-13', value: toEan13(nr), kind: 'ean' } : { type: 'Code 128', value: String(nr), kind: 'c128' };
  }

  /** Passt eine Scanner-Eingabe zur Artikelnummer? (Code 128 direkt, EAN-13 mit Nullen und Prüfziffer) */
  function matches(scanned, nr) {
    const x = String(scanned).replace(/\D/g, '').replace(/^0+/, '');
    const y = String(nr).replace(/^0+/, '');
    return !!x && (x === y || x === y + EAN.checkDigit(String(nr).padStart(12, '0')));
  }

  /** Einträge in der Form der App-Artikel (code = Artikelnummer). */
  function items() {
    return LISTE.map((nr) => ({
      code: nr,
      name: '',
      marke: '',
      gruppe: GRUPPE,
      type: 'Artikelnummer',
      valid: true,
      note: '',
      artnr: true,
    }));
  }

  return { GRUPPE, GRUPPE_NAME, LISTE, encode128, geometry, toSVG, toEan13, barcode, matches, items };
});
