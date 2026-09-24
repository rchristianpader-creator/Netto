const test = require('node:test');
const assert = require('node:assert/strict');
const EAN = require('../js/ean.js');

test('Prüfziffer', () => {
  assert.equal(EAN.checkDigit('400638133393'), '1'); // EAN-13
  assert.equal(EAN.checkDigit('9638507'), '4'); // EAN-8
  assert.equal(EAN.checkDigit('03600029145'), '2'); // UPC-A
});

test('normalize: EAN-13, EAN-8, UPC-A, fehlende/falsche Prüfziffer', () => {
  assert.deepEqual(EAN.normalize('4006381333931'), { code: '4006381333931', type: 'EAN-13', valid: true, note: '' });
  assert.deepEqual(EAN.normalize('96385074'), { code: '96385074', type: 'EAN-8', valid: true, note: '' });
  assert.equal(EAN.normalize('036000291452').code, '0036000291452');
  assert.equal(EAN.normalize('036000291452').note, 'UPC-A');
  assert.equal(EAN.normalize('400638133393').code, '4006381333931');
  assert.equal(EAN.normalize('9638507').code, '96385074');
  assert.equal(EAN.normalize('04006381333931').code, '4006381333931'); // GTIN-14
  const bad = EAN.normalize('4006381333932');
  assert.equal(bad.valid, false);
  assert.match(bad.note, /richtig wäre 1/);
  assert.equal(EAN.normalize('12345'), null);
  assert.equal(EAN.normalize(''), null);
});

test('encode liefert die Referenz-Modulfolgen (gegengeprüft mit JsBarcode)', () => {
  assert.equal(
    EAN.encode('4006381333931'),
    '10100011010100111010111101111010001001011001101010100001010000101000010111010010000101100110101'
  );
  assert.equal(EAN.encode('96385074'), '1010001011010111101111010110111010101001110111001010001001011100101');
  assert.throws(() => EAN.encode('123'));
});

test('encode: Länge, Randzeichen und gleich viele Module für jede Ziffer', () => {
  for (let i = 0; i < 200; i++) {
    let body = '';
    for (let k = 0; k < 12; k++) body += Math.floor(Math.random() * 10);
    const s = EAN.encode(body + EAN.checkDigit(body));
    assert.equal(s.length, 95);
    assert.equal(s.slice(0, 3), '101');
    assert.equal(s.slice(45, 50), '01010');
    assert.equal(s.slice(-3), '101');
  }
});

test('toSVG: Balkenbreiten ergeben die Modulfolge, Ruhezonen vorhanden', () => {
  const code = '4006381333931';
  const svg = EAN.toSVG(code, { module: 2, barHeight: 50 });
  const g = EAN.geometry(code);
  assert.match(svg, new RegExp('viewBox="0 0 ' + g.width + ' 60"'));
  assert.match(svg, /width="226" height="120"/);
  const modules = new Array(g.width).fill('0');
  for (const m of svg.matchAll(/<rect x="(\d+)" y="0" width="(\d+)"/g)) {
    for (let i = 0; i < Number(m[2]); i++) modules[Number(m[1]) + i] = '1';
  }
  const bars = modules.join('');
  assert.equal(bars.slice(0, g.quietLeft), '0'.repeat(11));
  assert.equal(bars.slice(g.quietLeft, g.quietLeft + 95), EAN.encode(code));
  assert.equal(bars.slice(-7), '0'.repeat(7));
});

test('sameCode: tolerant bei Präfixen, führenden Nullen und fehlender Prüfziffer', () => {
  assert.ok(EAN.sameCode('4006381333931', '4006381333931'));
  assert.ok(EAN.sameCode(']E04006381333931', '4006381333931'));
  assert.ok(EAN.sameCode('036000291452', '0036000291452'));
  assert.ok(EAN.sameCode('400638133393', '4006381333931'));
  assert.ok(!EAN.sameCode('4006381333931', '96385074'));
  assert.ok(!EAN.sameCode('1', '4006381333931'));
});
