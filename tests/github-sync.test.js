const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Sync = require('../js/github-sync.js');
const Sortiment = require('../js/sortiment.js');

const CSV = fs.readFileSync(path.join(__dirname, '..', 'data', 'netto-sortiment.csv'), 'utf8');

// Nachgebautes GitHub: eine Datei mit sha, PUT nur mit passendem sha.
function fakeGitHub(opts) {
  const o = Object.assign({ push: true, conflicts: 0, status: 200 }, opts);
  const gh = { text: CSV, sha: 'sha0', puts: [], calls: [] };
  gh.fetch = async (url, init) => {
    gh.calls.push(init.method + ' ' + url);
    assert.equal(init.headers.Authorization, 'Bearer TOKEN');
    const reply = (status, body) => ({ ok: status < 300, status, json: async () => body });
    if (o.status !== 200) return reply(o.status, { message: 'nope' });
    if (url.endsWith('/repos/rchristianpader-creator/Netto')) return reply(200, { permissions: { push: o.push } });
    if (init.method === 'GET') return reply(200, { sha: gh.sha, content: Sync.encodeBase64(gh.text).replace(/(.{60})/g, '$1\n') });
    const body = JSON.parse(init.body);
    if (o.conflicts > 0) {
      o.conflicts--;
      gh.sha = 'changed-' + o.conflicts; // jemand anderes hat inzwischen geschrieben
      return reply(409, { message: 'conflict' });
    }
    if (body.sha !== gh.sha) return reply(409, { message: 'sha mismatch' });
    gh.puts.push(body);
    gh.text = Sync.decodeBase64(body.content);
    gh.sha = 'sha' + gh.puts.length;
    return reply(200, {});
  };
  return gh;
}

test('Base64 hin und zurück, auch mit Umlauten und BOM', () => {
  const t = '﻿ean;produktname\n1;Blütenhonig Crème fraîche\n';
  assert.equal(Sync.decodeBase64(Sync.encodeBase64(t)), t);
  assert.equal(Sync.decodeBase64(Sync.encodeBase64(CSV)), CSV);
});

test('push: fehlende EANs werden angehängt, vorhandene nicht, Rest der Datei bleibt gleich', async () => {
  const gh = fakeGitHub();
  const list = [{ code: '4006381333931', at: 0 }, { code: '4316268604710', at: 0 }]; // zweite steht schon drin
  const r = await Sync.push('TOKEN', list, gh.fetch);
  assert.deepEqual(r, { added: ['4006381333931'], present: ['4316268604710'] });
  assert.equal(gh.puts.length, 1);
  assert.equal(gh.puts[0].branch, 'main');
  assert.equal(gh.puts[0].sha, 'sha0');
  assert.match(gh.puts[0].message, /1 selbst erfasste EAN ergänzt/);
  assert.ok(gh.text.startsWith(CSV));
  const items = Sortiment.parse(gh.text).items;
  assert.equal(items.length, Sortiment.parse(CSV).items.length + 1);
  assert.equal(items[items.length - 1].code, '4006381333931');

  // nochmal: nichts mehr zu tun, kein zweiter Commit
  const again = await Sync.push('TOKEN', list, gh.fetch);
  assert.deepEqual(again.added, []);
  assert.equal(gh.puts.length, 1);
});

test('push: bei zwischenzeitlich geänderter Datei neu lesen und nochmal versuchen', async () => {
  const gh = fakeGitHub({ conflicts: 1 });
  const r = await Sync.push('TOKEN', [{ code: '4006381333931', at: 0 }], gh.fetch);
  assert.deepEqual(r.added, ['4006381333931']);
  assert.equal(gh.puts.length, 1);
  assert.equal(gh.calls.filter((c) => c.startsWith('GET')).length, 2);
});

test('check und Fehlermeldungen', async () => {
  assert.equal(await Sync.check('TOKEN', fakeGitHub().fetch), true);
  await assert.rejects(Sync.check('TOKEN', fakeGitHub({ push: false }).fetch), /darf das Repository/);
  await assert.rejects(Sync.check('TOKEN', fakeGitHub({ status: 401 }).fetch), /ungültig oder abgelaufen/);
  await assert.rejects(Sync.push('TOKEN', [{ code: '4006381333931', at: 0 }], fakeGitHub({ status: 404 }).fetch), /darf das Repository/);
  const offline = async () => {
    throw new TypeError('Failed to fetch');
  };
  await assert.rejects(Sync.push('TOKEN', [], offline), /Keine Verbindung/);
});
