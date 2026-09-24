const test = require('node:test');
const assert = require('node:assert/strict');
const KeyboardScanner = require('../js/keyboard-scanner.js');

function typeCode(kb, text, gapMs, start) {
  let t = start;
  for (const ch of text) kb.key(ch, (t += gapMs));
  return t;
}

test('schnelle Eingabe mit Enter wird als Scan erkannt', () => {
  const scans = [];
  const kb = new KeyboardScanner((c) => scans.push(c));
  const t = typeCode(kb, '4006381333931', 5, 0);
  assert.equal(kb.key('Enter', t + 5), true);
  assert.deepEqual(scans, ['4006381333931']);
  kb.clear();
});

test('menschliches Tippen ist kein Scan', () => {
  const scans = [];
  const kb = new KeyboardScanner((c) => scans.push(c));
  const t = typeCode(kb, '4006381333931', 180, 0);
  assert.equal(kb.key('Enter', t + 150), false);
  assert.deepEqual(scans, []);
  kb.clear();
});

test('Scanner ohne Enter/Tab: Scan endet nach kurzer Pause', async () => {
  const scans = [];
  const kb = new KeyboardScanner((c) => scans.push(c), { idleMs: 30 });
  typeCode(kb, '96385074', 5, 0);
  await new Promise((r) => setTimeout(r, 60));
  assert.deepEqual(scans, ['96385074']);
});
