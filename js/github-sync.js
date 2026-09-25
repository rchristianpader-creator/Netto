/*
 * Selbst erfasste EANs direkt in die Sortiment-Datei auf GitHub schreiben (data/netto-sortiment.csv).
 * Braucht einen GitHub-Zugangsschlüssel (Fine-grained token, nur Repository "Netto",
 * Berechtigung "Contents: Read and write"). Er liegt nur im Browser dieses Geräts.
 * Nach dem Schreiben baut GitHub Pages die Seite neu, nach 1–2 Minuten sehen alle Geräte die Artikel.
 */
(function (root, factory) {
  const api = factory(
    root.Erfassung || (typeof require === 'function' ? require('./erfassung.js') : null),
    root.Sortiment || (typeof require === 'function' ? require('./sortiment.js') : null)
  );
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GitHubSync = api;
})(typeof self !== 'undefined' ? self : this, function (Erfassung, Sortiment) {
  'use strict';

  const TARGET = { owner: 'rchristianpader-creator', repo: 'Netto', branch: 'main', path: 'data/netto-sortiment.csv' };
  const API = 'https://api.github.com';

  // Base64 <-> UTF-8-Text (die GitHub-API liefert und erwartet Dateiinhalte als Base64).
  function decodeBase64(b64) {
    const bin = atob(String(b64).replace(/\s/g, ''));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes); // BOM am Dateianfang behalten
  }

  function encodeBase64(text) {
    const bytes = new TextEncoder().encode(text);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }

  class SyncError extends Error {
    constructor(message, status) {
      super(message);
      this.name = 'SyncError';
      this.status = status;
    }
  }

  function explain(status) {
    if (status === 401) return 'Der GitHub-Schlüssel ist ungültig oder abgelaufen.';
    if (status === 403 || status === 404)
      return 'Der GitHub-Schlüssel darf das Repository „Netto“ nicht beschreiben (Berechtigung „Contents: Read and write“ nötig).';
    return 'GitHub hat mit Fehler ' + status + ' geantwortet.';
  }

  async function call(fetchFn, token, method, url, body) {
    let res;
    try {
      res = await fetchFn(url, {
        method,
        cache: 'no-store',
        headers: Object.assign(
          { Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + token, 'X-GitHub-Api-Version': '2022-11-28' },
          body ? { 'Content-Type': 'application/json' } : {}
        ),
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      throw new SyncError('Keine Verbindung zu GitHub. Internet prüfen und nochmal versuchen.', 0);
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new SyncError(explain(res.status), res.status);
    return data;
  }

  const fileUrl = () => API + '/repos/' + TARGET.owner + '/' + TARGET.repo + '/contents/' + TARGET.path;

  /** Prüft den Schlüssel: Lesen der Datei klappt und Schreibrecht ist vorhanden. */
  async function check(token, fetchFn) {
    const repo = await call(fetchFn, token, 'GET', API + '/repos/' + TARGET.owner + '/' + TARGET.repo);
    if (!repo.permissions || !repo.permissions.push) throw new SyncError(explain(403), 403);
    await call(fetchFn, token, 'GET', fileUrl() + '?ref=' + TARGET.branch);
    return true;
  }

  /**
   * Hängt die noch fehlenden EANs aus `list` an die Sortiment-Datei an und zieht von Hand korrigierte
   * (dirty) Einträge in ihren vorhandenen Zeilen nach.
   * Ergebnis: { added: [codes], updated: [codes], present: [codes] } (present = stand schon in der Datei).
   * Hat sich die Datei zwischen Lesen und Schreiben geändert, wird neu gelesen und nochmal versucht.
   */
  async function push(token, list, fetchFn) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const file = await call(fetchFn, token, 'GET', fileUrl() + '?ref=' + TARGET.branch);
      const text = decodeBase64(file.content);
      const existing = new Set(Sortiment.parse(text).items.map((it) => it.code));
      // von Hand korrigierte, schon übernommene Artikel: ihre Zeile nachziehen
      const upd = Erfassung.updateInCSV(text, list.filter((e) => e.dirty && existing.has(e.code)));
      const result = Erfassung.appendToCSV(upd.text, list, existing);
      const present = list.map((e) => e.code).filter((c) => existing.has(c));
      if (!result.added.length && !upd.updated.length) return { added: [], updated: [], present };
      const n = (k, one, many) => k + (k === 1 ? one : many);
      const parts = [];
      if (result.added.length) parts.push(n(result.added.length, ' selbst erfasste EAN', ' selbst erfasste EANs') + ' ergänzt');
      if (upd.updated.length) parts.push(n(upd.updated.length, ' Bezeichnung', ' Bezeichnungen') + ' korrigiert');
      try {
        await call(fetchFn, token, 'PUT', fileUrl(), {
          message: 'Sortiment: ' + parts.join(', ') + ' (Kamera-Scan)',
          content: encodeBase64(result.text),
          sha: file.sha,
          branch: TARGET.branch,
        });
        return { added: result.added, updated: upd.updated, present };
      } catch (err) {
        if (!(err instanceof SyncError) || (err.status !== 409 && err.status !== 422) || attempt === 2) throw err;
      }
    }
    return { added: [], updated: [], present: [] };
  }

  return { TARGET, check, push, decodeBase64, encodeBase64, SyncError };
});
