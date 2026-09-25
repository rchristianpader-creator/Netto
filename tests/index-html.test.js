const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Alle eigenen CSS/JS-Dateien tragen dieselbe Version (?v=…), damit der Browser nach einem Update
// nicht eine neue Seite mit alten Skripten mischt. Bei Änderungen an CSS/JS die Version hochsetzen.
test('index.html: eigene CSS/JS-Dateien mit einheitlicher Versionsnummer', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const refs = [...html.matchAll(/(?:src|href)="((?:js|css)\/[^"]+)"/g)].map((m) => m[1]);
  assert.ok(refs.length >= 10, String(refs.length));
  const versions = new Set(refs.map((r) => (r.match(/\?v=([\w.-]+)$/) || [])[1]));
  assert.equal(versions.size, 1, refs.join(', '));
  assert.ok([...versions][0], 'jede Datei braucht ?v=…');
  for (const r of refs) assert.ok(fs.existsSync(path.join(__dirname, '..', r.split('?')[0])), r);
});
