/* EAN Scan-Liste – Bedienoberfläche. Benötigt ean.js, tone-detector.js, keyboard-scanner.js, off-import.js. */
(function () {
  'use strict';

  const STORE_KEY = 'ean-scan-liste.v1';
  const BASE_WIDTH = 520; // maximale Barcode-Breite in CSS-Pixeln bei Größe 100 %
  const MIN_BAR_HEIGHT = 22; // Module
  const MAX_BAR_HEIGHT = 70; // Module (GS1-Nennmaß EAN-13: ca. 69)
  const MARKS = { ok: '✓', mismatch: '⚠', skip: '↷' };
  const DEFAULT_SETTINGS = {
    mic: true,
    keyboard: true,
    freq: null, // angelernte Frequenz des Scan-Tons (Hz), null = automatisch
    minLevelDb: ToneDetector.DEFAULTS.minLevelDb,
    cooldownMs: 400,
    size: 100,
    loop: false,
  };

  const $ = (sel) => document.querySelector(sel);
  const el = {
    summary: $('#list-summary'),
    viewEmpty: $('#view-empty'),
    viewCode: $('#view-code'),
    viewDone: $('#view-done'),
    pos: $('#pos'),
    name: $('#item-name'),
    area: $('#barcode-area'),
    card: $('#barcode-card'),
    barcode: $('#barcode'),
    code: $('#item-code'),
    note: $('#item-note'),
    progress: $('#progress-bar'),
    doneText: $('#done-text'),
    prev: $('#btn-prev'),
    next: $('#btn-next'),
    listen: $('#btn-listen'),
    status: $('#status'),
    toast: $('#toast'),
    fullscreen: $('#btn-fullscreen'),
    dlgList: $('#dlg-list'),
    dlgSettings: $('#dlg-settings'),
    listText: $('#list-text'),
    listCheck: $('#list-check'),
    listFile: $('#list-file'),
    overview: $('#overview'),
    overviewStats: $('#overview-stats'),
    offBox: $('#off-box'),
    offCount: $('#off-count'),
    offStatus: $('#off-status'),
    offReplace: $('#btn-off-replace'),
    offAppend: $('#btn-off-append'),
    setMic: $('#set-mic'),
    setKeyboard: $('#set-keyboard'),
    setLevel: $('#set-level'),
    setCooldown: $('#set-cooldown'),
    setSize: $('#set-size'),
    setLoop: $('#set-loop'),
    outLevel: $('#out-level'),
    outCooldown: $('#out-cooldown'),
    outSize: $('#out-size'),
    calibState: $('#calib-state'),
    calibProgress: $('#calib-progress'),
    calibBar: $('#calib-bar'),
    calibrate: $('#btn-calibrate'),
    calibReset: $('#btn-calib-reset'),
  };
  const meters = Array.from(document.querySelectorAll('[data-meter]')).map((root) => ({
    root,
    fill: root.querySelector('.meter-fill'),
    threshold: root.querySelector('.meter-threshold'),
    label: root.querySelector('.meter-label'),
  }));

  // ---------- Zustand & Speicher ----------

  const saved = load();
  const state = {
    text: typeof saved.text === 'string' ? saved.text : '',
    items: [],
    index: Number.isInteger(saved.index) ? saved.index : 0,
    marks: Array.isArray(saved.marks) ? saved.marks : [],
    settings: Object.assign({}, DEFAULT_SETTINGS, saved.settings),
  };
  state.items = EAN.parseList(state.text).items;
  if (state.marks.length > state.items.length) state.marks = [];
  state.index = Math.max(0, Math.min(state.index, state.items.length));

  function load() {
    try {
      return JSON.parse(localStorage.getItem(STORE_KEY)) || {};
    } catch (e) {
      return {};
    }
  }

  function save() {
    try {
      localStorage.setItem(
        STORE_KEY,
        JSON.stringify({ text: state.text, index: state.index, marks: state.marks, settings: state.settings })
      );
    } catch (e) {
      /* privater Modus o. ä. – dann eben ohne Speichern */
    }
  }

  const countMarks = (kind) => state.marks.filter((m) => m === kind).length;

  // ---------- Anzeige ----------

  function render() {
    const n = state.items.length;
    const i = state.index;
    const done = n > 0 && i >= n;
    const scanned = countMarks('ok') + countMarks('mismatch');

    el.viewEmpty.hidden = n > 0;
    el.viewCode.hidden = !n || done;
    el.viewDone.hidden = !done;
    el.prev.disabled = !n || i === 0;
    el.next.disabled = !n || done;
    el.summary.textContent = n ? n + ' Codes · ' + scanned + ' gescannt' : 'keine Liste';

    if (done) {
      const skipped = countMarks('skip');
      el.doneText.textContent =
        'Alle ' + n + ' Codes durchlaufen – ' + scanned + ' per Scan' + (skipped ? ', ' + skipped + ' übersprungen.' : '.');
      return;
    }
    if (!n) return;

    const item = state.items[i];
    el.pos.textContent = i + 1 + ' / ' + n;
    el.name.textContent = item.name || 'Artikel ' + (i + 1);
    el.code.textContent = item.type + ' ' + item.code;
    el.note.textContent = item.valid ? item.note : item.note + ' – der Scanner wird diesen Code nicht lesen';
    el.note.classList.toggle('bad', !item.valid);
    el.progress.style.width = (i / n) * 100 + '%';
    drawBarcode();
  }

  // Barcode so groß wie möglich, aber mit ganzzahligen Gerätepixeln pro Modul (gleichmäßige, scharfe Balken).
  function drawBarcode() {
    const item = state.items[state.index];
    if (!item || el.viewCode.hidden) return;
    const g = EAN.geometry(item.code);
    const dpr = window.devicePixelRatio || 1;
    const pad = 20; // Innenabstand der weißen Karte, beidseitig
    const availW = el.area.clientWidth - pad;
    const availH = el.area.clientHeight - pad;
    if (availW <= 0 || availH <= 0) return;

    const targetW = Math.min(availW, (BASE_WIDTH * state.settings.size) / 100);
    let px = Math.max(1, Math.floor((targetW * dpr) / g.width));
    let barHeight;
    for (;;) {
      barHeight = Math.min(MAX_BAR_HEIGHT, Math.floor((availH * dpr) / px) - g.textHeight);
      if (barHeight >= MIN_BAR_HEIGHT || px === 1) break;
      px--;
    }
    el.barcode.innerHTML = EAN.toSVG(item.code, { module: px / dpr, barHeight: Math.max(MIN_BAR_HEIGHT, barHeight) });
  }

  let drawQueued = false;
  new ResizeObserver(() => {
    if (drawQueued) return;
    drawQueued = true;
    requestAnimationFrame(() => {
      drawQueued = false;
      drawBarcode();
    });
  }).observe(el.area);

  let toastTimer = null;
  function toast(message, kind, ms) {
    el.toast.textContent = message;
    el.toast.className = 'toast' + (kind ? ' ' + kind : '');
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.toast.hidden = true), ms || 1600);
  }

  let flashTimer = null;
  function flash(kind) {
    el.card.classList.remove('flash-ok', 'flash-warn');
    el.card.classList.add(kind === 'warn' ? 'flash-warn' : 'flash-ok');
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => el.card.classList.remove('flash-ok', 'flash-warn'), 350);
  }

  function pulseMeters() {
    meters.forEach((m) => {
      m.root.classList.add('hit');
      setTimeout(() => m.root.classList.remove('hit'), 400);
    });
  }

  function setStatus(message, isError) {
    el.status.textContent = message;
    el.status.classList.toggle('error', !!isError);
  }

  // ---------- Navigation ----------

  function goTo(i) {
    const n = state.items.length;
    if (!n) return;
    if (i >= n && state.settings.loop) i = 0;
    state.index = Math.max(0, Math.min(i, n)); // n = "Fertig"-Ansicht
    save();
    render();
  }

  function next() {
    if (state.index >= state.items.length) return;
    if (!state.marks[state.index]) state.marks[state.index] = 'skip';
    goTo(state.index + 1);
  }

  function prev() {
    goTo(Math.min(state.index, state.items.length) - 1);
  }

  function restart() {
    state.marks = [];
    goTo(0);
  }

  const dialogOpen = () => el.dlgList.open || el.dlgSettings.open;

  // Ein Scan wurde erkannt (Piepton oder Tastatureingabe des Scanners).
  let lastScanAt = -Infinity;
  function onScan(source, scanned) {
    pulseMeters();
    if (dialogOpen()) return;
    const n = state.items.length;
    if (!n) return;
    if (state.index >= n) {
      toast('Die Liste ist fertig.');
      return;
    }
    const now = performance.now();
    if (now - lastScanAt < state.settings.cooldownMs) return; // z. B. Piepton + Tastatur vom selben Scan
    lastScanAt = now;

    const match = source !== 'keyboard' || EAN.sameCode(scanned, state.items[state.index].code);
    state.marks[state.index] = match ? 'ok' : 'mismatch';
    goTo(state.index + 1);
    flash(match ? 'ok' : 'warn');
    if (!match) toast('Gescannt: ' + scanned + ' – passt nicht zum angezeigten Code', 'warn', 3500);
  }

  el.prev.addEventListener('click', () => {
    prev();
    keepAwake(true);
  });
  el.next.addEventListener('click', () => {
    next();
    keepAwake(true);
  });

  // ---------- Mikrofon ----------

  const toneOptions = () => ({ freq: state.settings.freq, minLevelDb: state.settings.minLevelDb });
  const listener = new ToneDetector.ToneListener(
    {
      onFrame: updateMeters,
      onTone: () => onScan('mic'),
      onEnded: () => {
        micState = 'off';
        updateListenUI();
        setStatus('Das Mikrofon wurde getrennt – bitte neu starten.', true);
      },
    },
    toneOptions()
  );
  let micState = 'off'; // off | starting | on | paused

  function micError(err) {
    switch (err && err.name) {
      case 'InsecureContext':
        return 'Mikrofon geht nur über https:// (oder localhost). Seite z. B. über GitHub Pages öffnen.';
      case 'NotAllowedError':
      case 'SecurityError':
        return 'Mikrofon-Zugriff verweigert. Bitte in den Browser-Einstellungen für diese Seite erlauben.';
      case 'NotFoundError':
      case 'OverconstrainedError':
        return 'Kein Mikrofon gefunden.';
      case 'NotReadableError':
        return 'Das Mikrofon wird gerade von einer anderen App benutzt.';
      case 'NotSupportedError':
        return 'Dieser Browser kann nicht aufs Mikrofon zugreifen.';
      default:
        return 'Mikrofon konnte nicht gestartet werden' + (err && err.message ? ' (' + err.message + ')' : '') + '.';
    }
  }

  async function startMic() {
    micState = 'starting';
    updateListenUI();
    try {
      await listener.start();
      micState = 'on';
      keepAwake(true);
    } catch (err) {
      micState = 'off';
      updateListenUI();
      setStatus(micError(err), true);
      return false;
    }
    updateListenUI();
    return true;
  }

  function pauseMic() {
    listener.pause();
    micState = 'paused';
    updateListenUI();
  }

  function stopMic() {
    listener.stop();
    micState = 'off';
    updateListenUI();
  }

  function updateListenUI() {
    const s = state.settings;
    const btn = el.listen;
    btn.classList.toggle('listening', micState === 'on');
    if (!s.mic) {
      btn.disabled = true;
      btn.textContent = s.keyboard ? 'Weiter per Scanner-Eingabe' : 'Nur manuell (‹ ›)';
    } else {
      btn.disabled = micState === 'starting';
      btn.textContent = {
        off: 'Scan-Ton-Erkennung starten',
        starting: 'Mikrofon wird gestartet …',
        on: 'Hört zu – Pause',
        paused: 'Fortsetzen',
      }[micState];
    }
    meters.forEach((m) => (m.root.hidden = micState !== 'on' && micState !== 'paused'));
    setIdleStatus();
  }

  function setIdleStatus() {
    const s = state.settings;
    if (s.mic && micState === 'on') {
      setStatus(
        s.freq
          ? 'Hört zu – wartet auf den Scan-Ton (' + s.freq + ' Hz).'
          : 'Hört zu – reagiert auf jeden Piepton. Tipp: In den Einstellungen den Scan-Ton anlernen.'
      );
    } else if (s.mic && micState === 'paused') {
      setStatus('Pausiert – es wird nicht weitergeschaltet.');
    } else if (s.mic && micState === 'off') {
      setStatus(
        window.isSecureContext
          ? 'Auf „Scan-Ton-Erkennung starten“ tippen und das Mikrofon erlauben.'
          : 'Achtung: Mikrofon geht nur über https:// – Seite z. B. über GitHub Pages öffnen.',
        !window.isSecureContext
      );
    } else if (s.keyboard) {
      setStatus('Schaltet weiter, sobald ein angeschlossener Scanner einen Code sendet.');
    } else {
      setStatus('Automatisches Weiterschalten ist aus.');
    }
  }

  el.listen.addEventListener('click', () => {
    if (micState === 'on') pauseMic();
    else startMic();
  });

  let labelAt = 0;
  function updateMeters(a, on) {
    const s = state.settings;
    const pos = (db) => Math.max(0, Math.min(1, (db + 100) / 80)); // Skala −100 … −20 dB
    const now = performance.now();
    const refreshLabel = now - labelAt > 150;
    if (refreshLabel) labelAt = now;
    meters.forEach((m) => {
      if (m.root.hidden) return;
      m.fill.style.transform = 'scaleX(' + pos(a.level).toFixed(3) + ')';
      m.threshold.style.left = pos(s.minLevelDb) * 100 + '%';
      m.root.classList.toggle('on', on);
      if (refreshLabel) {
        const what = on ? 'Ton ' + Math.round(a.freq) + ' Hz' : 'Suche ' + (s.freq ? s.freq + ' Hz' : '1–5 kHz');
        m.label.textContent = what + ' · ' + Math.round(a.level) + ' dB';
      }
    });
  }

  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible') return;
    if (wantAwake) keepAwake(true);
    if (micState !== 'on') return;
    // Nach App-Wechsel/Sperrbildschirm ist das Audio oft angehalten (v. a. iOS).
    const resumed = await Promise.race([
      listener.resume().then(() => listener.ctx && listener.ctx.state === 'running', () => false),
      new Promise((r) => setTimeout(() => r(false), 1500)),
    ]);
    if (!resumed) {
      pauseMic();
      setStatus('Zum Weitermachen auf „Fortsetzen“ tippen.', true);
    }
  });

  // Bildschirm anlassen, solange gescannt wird.
  let wakeLock = null;
  let wantAwake = false;
  async function keepAwake(on) {
    wantAwake = on;
    try {
      if (on && !wakeLock && 'wakeLock' in navigator && document.visibilityState === 'visible') {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => (wakeLock = null));
      } else if (!on && wakeLock) {
        const w = wakeLock;
        wakeLock = null;
        await w.release();
      }
    } catch (e) {
      /* nicht unterstützt oder vom System abgelehnt (z. B. Energiesparmodus) */
    }
  }

  // ---------- Tastatur (Scanner per USB/Bluetooth + Pfeiltasten) ----------

  const keyboardScanner = new KeyboardScanner((code) => onScan('keyboard', code));

  document.addEventListener(
    'keydown',
    (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (state.settings.keyboard && keyboardScanner.key(e.key, performance.now())) {
        e.preventDefault();
        return;
      }
      if (dialogOpen()) return;
      const actions = { ArrowRight: next, PageDown: next, ArrowLeft: prev, PageUp: prev, Home: () => goTo(0) };
      if (actions[e.key]) {
        e.preventDefault();
        actions[e.key]();
      }
    },
    true
  );

  // ---------- Liste ----------

  let draftDirty = false;

  function openList() {
    if (!draftDirty) el.listText.value = state.text;
    checkDraft();
    renderOverview();
    el.dlgList.showModal();
    const cur = el.overview.querySelector('.is-current');
    if (cur) cur.scrollIntoView({ block: 'center' });
  }

  function checkDraft() {
    const parsed = EAN.parseList(el.listText.value);
    const invalid = parsed.items.filter((it) => !it.valid).length;
    let html = '<strong>' + parsed.items.length + '</strong> Codes erkannt';
    if (invalid) html += ' · <span class="bad">' + invalid + ' mit falscher Prüfziffer</span>';
    if (parsed.errors.length) {
      const lines = parsed.errors.slice(0, 6).map((e) => e.line).join(', ');
      html += ' · <span class="bad">ohne gültige EAN: Zeile ' + lines + (parsed.errors.length > 6 ? ' …' : '') + '</span>';
    }
    if (draftDirty) html += ' · <em>noch nicht übernommen</em>';
    el.listCheck.innerHTML = html;
  }

  let checkTimer = null;
  el.listText.addEventListener('input', () => {
    draftDirty = el.listText.value !== state.text;
    clearTimeout(checkTimer);
    checkTimer = setTimeout(checkDraft, 200);
  });

  // Übernimmt eine neue Liste. Der Fortschritt bleibt erhalten, wenn die bisherigen Codes unverändert am Anfang stehen.
  function applyText(raw) {
    const text = String(raw).replace(/\r\n?/g, '\n');
    const items = EAN.parseList(text).items;
    const keep = state.items.length <= items.length && state.items.every((it, k) => it.code === items[k].code);
    state.text = text;
    state.items = items;
    if (!keep) {
      state.index = 0;
      state.marks = [];
    }
    state.index = Math.min(state.index, items.length);
    draftDirty = false;
    el.listText.value = text;
    save();
    render();
    if (el.dlgList.open) {
      checkDraft();
      renderOverview();
    }
    return items.length;
  }

  function renderOverview() {
    const frag = document.createDocumentFragment();
    state.items.forEach((it, k) => {
      const mark = MARKS[state.marks[k]] ? state.marks[k] : '';
      const li = document.createElement('li');
      li.className = [k === state.index ? 'is-current' : '', it.valid ? '' : 'invalid'].join(' ').trim();
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.index = String(k);
      b.innerHTML =
        '<span class="n">' + (k + 1) + '</span><span class="mark ' + mark + '">' + (MARKS[mark] || '') +
        '</span><span class="name"></span><span class="code">' + it.code + '</span>';
      b.querySelector('.name').textContent = it.name || it.type;
      li.appendChild(b);
      frag.appendChild(li);
    });
    el.overview.replaceChildren(frag);
    const n = state.items.length;
    const ok = countMarks('ok');
    const mis = countMarks('mismatch');
    const skip = countMarks('skip');
    el.overviewStats.textContent = n
      ? '(' + ok + ' ✓' + (mis ? ' · ' + mis + ' ⚠' : '') + (skip ? ' · ' + skip + ' ↷' : '') + ' · ' + (n - ok - mis - skip) + ' offen)'
      : '(leer)';
  }

  el.overview.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-index]');
    if (!b) return;
    el.dlgList.close();
    goTo(Number(b.dataset.index));
  });

  $('#btn-apply-list').addEventListener('click', () => {
    const n = applyText(el.listText.value);
    el.dlgList.close();
    toast(n + ' Codes übernommen', 'ok');
  });

  el.listFile.addEventListener('change', async () => {
    const file = el.listFile.files[0];
    el.listFile.value = '';
    if (!file) return;
    const buf = await file.arrayBuffer();
    let text;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
    } catch (e) {
      text = new TextDecoder('windows-1252').decode(buf); // Excel-CSV unter Windows
    }
    const n = applyText(text);
    toast(n + ' Codes aus „' + file.name + '“ übernommen', 'ok', 2500);
  });

  function demoText() {
    const lines = ['# Testcodes (keine echten Produkte) – zum Ausprobieren von Scanner und Ton-Erkennung'];
    for (let i = 1; i <= 8; i++) {
      const body = '200000000' + String(i).padStart(3, '0');
      lines.push(body + EAN.checkDigit(body) + ';Testcode ' + i);
    }
    lines.push('2000009' + EAN.checkDigit('2000009') + ';Testcode 9 (EAN-8)');
    return lines.join('\n');
  }

  async function loadOff(mode) {
    const count = Number(el.offCount.value) || 50;
    el.offReplace.disabled = el.offAppend.disabled = true;
    el.offStatus.textContent = 'Lade Produkte von Open Food Facts …';
    try {
      const entries = await OffImport.loadNettoProducts(count, EAN, (n) => {
        el.offStatus.textContent = 'Lade … ' + n + ' Produkte';
      });
      if (!entries.length) {
        el.offStatus.textContent = 'Keine Produkte gefunden.';
        return;
      }
      const lines = entries.map((e) => e.code + ';' + e.name).join('\n');
      const base = el.listText.value.replace(/\s+$/, '');
      const header = '# Netto Marken-Discount – Daten: Open Food Facts (ODbL), Stand ' + new Date().toLocaleDateString('de-DE');
      applyText(mode === 'append' && base ? base + '\n' + lines : header + '\n' + lines);
      el.offStatus.textContent = '✓ ' + entries.length + ' Produkte geladen.';
    } catch (err) {
      const msg = String((err && err.message) || '');
      let reason = 'Open Food Facts nicht erreichbar (Internetverbindung?).';
      if (err && err.name === 'AbortError') reason = 'Zeitüberschreitung – bitte nochmal versuchen.';
      else if (msg === 'HTTP 429') reason = 'Zu viele Anfragen – bitte eine Minute warten.';
      else if (/^HTTP \d+/.test(msg)) reason = 'Server-Fehler (' + msg + ') – später nochmal versuchen.';
      el.offStatus.textContent = 'Laden fehlgeschlagen: ' + reason;
    } finally {
      el.offReplace.disabled = el.offAppend.disabled = false;
    }
  }

  el.offReplace.addEventListener('click', () => loadOff('replace'));
  el.offAppend.addEventListener('click', () => loadOff('append'));

  // ---------- Einstellungen ----------

  function openSettings() {
    fillSettings();
    renderCalibState();
    el.dlgSettings.showModal();
  }

  function fillSettings() {
    const s = state.settings;
    el.setMic.checked = s.mic;
    el.setKeyboard.checked = s.keyboard;
    el.setLoop.checked = s.loop;
    el.setLevel.value = s.minLevelDb;
    el.setCooldown.value = s.cooldownMs;
    el.setSize.value = s.size;
    el.outLevel.textContent = s.minLevelDb + ' dB';
    el.outCooldown.textContent = (s.cooldownMs / 1000).toLocaleString('de-DE', { minimumFractionDigits: 2 }) + ' s';
    el.outSize.textContent = s.size + ' %';
  }

  function renderCalibState(prefix) {
    const f = state.settings.freq;
    el.calibState.innerHTML =
      (prefix ? prefix + ' ' : '') +
      (f
        ? 'Reagiert nur auf den angelernten Ton bei <strong>' + f + ' Hz</strong>.'
        : 'Automatisch: reagiert auf jeden deutlichen Piepton zwischen 1 und 5 kHz. Anlernen macht die Erkennung zuverlässiger.');
    el.calibReset.hidden = !f;
  }

  function changeSettings(patch) {
    Object.assign(state.settings, patch);
    save();
    fillSettings();
    listener.configure(toneOptions());
  }

  el.setMic.addEventListener('change', () => {
    changeSettings({ mic: el.setMic.checked });
    if (!state.settings.mic && micState !== 'off') stopMic();
    updateListenUI();
  });
  el.setKeyboard.addEventListener('change', () => {
    changeSettings({ keyboard: el.setKeyboard.checked });
    updateListenUI();
  });
  el.setLoop.addEventListener('change', () => changeSettings({ loop: el.setLoop.checked }));
  el.setLevel.addEventListener('input', () => changeSettings({ minLevelDb: Number(el.setLevel.value) }));
  el.setCooldown.addEventListener('input', () => changeSettings({ cooldownMs: Number(el.setCooldown.value) }));
  el.setSize.addEventListener('input', () => {
    changeSettings({ size: Number(el.setSize.value) });
    drawBarcode();
  });

  el.calibrate.addEventListener('click', async () => {
    if (!state.settings.mic) changeSettings({ mic: true });
    if (micState !== 'on' && !(await startMic())) {
      renderCalibState('<span class="bad">Ohne Mikrofon kein Anlernen.</span>');
      return;
    }
    const duration = 8000;
    el.calibrate.disabled = true;
    el.calibProgress.hidden = false;
    el.calibState.innerHTML =
      '<strong>Jetzt einen beliebigen Barcode scannen</strong> (z. B. von einem Produkt), damit der Scanner nah an diesem Gerät piept …';
    const t0 = performance.now();
    const anim = setInterval(() => {
      el.calibBar.style.width = Math.min(100, ((performance.now() - t0) / duration) * 100) + '%';
    }, 100);
    const result = await listener.calibrate(duration);
    clearInterval(anim);
    el.calibProgress.hidden = true;
    el.calibBar.style.width = '0';
    el.calibrate.disabled = false;
    if (result) {
      changeSettings({ freq: result.freq, minLevelDb: Math.max(-100, Math.min(-20, result.minLevelDb)) });
      renderCalibState('<span class="ok">✓ Scan-Ton erkannt (' + Math.round(result.level) + ' dB).</span>');
      setIdleStatus();
    } else if (el.dlgSettings.open) {
      renderCalibState(
        '<span class="bad">Kein deutlicher Piepton erkannt.</span> Scanner näher ans Mikrofon halten oder lauter stellen und nochmal versuchen.'
      );
    }
  });

  el.calibReset.addEventListener('click', () => {
    changeSettings({ freq: null, minLevelDb: DEFAULT_SETTINGS.minLevelDb });
    renderCalibState();
    setIdleStatus();
  });

  el.dlgSettings.addEventListener('close', () => listener.cancelCalibration());

  $('#btn-reset-progress').addEventListener('click', () => {
    restart();
    el.dlgSettings.close();
    toast('Zurück auf Anfang');
  });

  // ---------- Kopfzeile & Aktionen ----------

  $('#btn-list').addEventListener('click', openList);
  $('#btn-settings').addEventListener('click', openSettings);

  if (document.fullscreenEnabled) {
    el.fullscreen.hidden = false;
    el.fullscreen.addEventListener('click', () => {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen().catch(() => {});
    });
  }

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-action]');
    if (!b) return;
    const action = b.dataset.action;
    if (action === 'open-list') openList();
    else if (action === 'open-off') {
      openList();
      el.offBox.open = true;
    } else if (action === 'load-demo') {
      const n = applyText(demoText());
      toast(n + ' Testcodes geladen', 'ok');
    } else if (action === 'restart') restart();
  });

  // ---------- Start ----------

  render();
  updateListenUI();
})();
