/*
 * EAN Scan-Liste – Bedienoberfläche.
 * Benötigt ean.js, sortiment.js, warengruppen.js, tagesliste.js, tone-detector.js, keyboard-scanner.js.
 */
(function () {
  'use strict';

  const DATA_URL = 'data/netto-sortiment.csv';
  const STORE_KEY = 'ean-scan-liste.v2';
  const OLD_STORE_KEY = 'ean-scan-liste.v1'; // frühere Version: Einstellungen (z. B. angelernter Ton) übernehmen
  const BASE_WIDTH = 520; // maximale Barcode-Breite in CSS-Pixeln bei Größe 100 %
  const MIN_BAR_HEIGHT = 22; // Module
  const MAX_BAR_HEIGHT = 70; // Module (GS1-Nennmaß EAN-13: ca. 69)
  const IDLE_MS = 10 * 60 * 1000; // neuer Tag bei offener Seite: erst so lange nach dem letzten Scan umschalten
  const MARKS = { ok: '✓', mismatch: '⚠', skip: '↷' };
  const DEFAULT_SETTINGS = {
    mic: true,
    keyboard: true,
    freq: null, // angelernte Frequenz des Scan-Tons (Hz), null = automatisch
    minLevelDb: ToneDetector.DEFAULTS.minLevelDb,
    cooldownMs: 400,
    size: 100,
    loop: false,
    perDay: Tagesliste.DEFAULT_RANGE, // Artikel pro Tag: zufällige Anzahl in diesem Bereich
  };

  const $ = (sel) => document.querySelector(sel);
  const el = {
    summary: $('#list-summary'),
    viewLoading: $('#view-loading'),
    loadingTitle: $('#loading-title'),
    loadingText: $('#loading-text'),
    loadingActions: $('#loading-actions'),
    viewCode: $('#view-code'),
    viewDone: $('#view-done'),
    pos: $('#pos'),
    group: $('#item-group'),
    name: $('#item-name'),
    meta: $('#item-meta'),
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
    overview: $('#overview'),
    overviewStats: $('#overview-stats'),
    search: $('#overview-search'),
    dataInfo: $('#data-info'),
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
    laufweg: $('#laufweg'),
    laufwegReset: $('#btn-laufweg-reset'),
    tagesInfo: $('#tages-info'),
    setPerDayMin: $('#set-per-day-min'),
    setPerDayMax: $('#set-per-day-max'),
  };
  const meters = Array.from(document.querySelectorAll('[data-meter]')).map((root) => ({
    root,
    fill: root.querySelector('.meter-fill'),
    threshold: root.querySelector('.meter-threshold'),
    label: root.querySelector('.meter-label'),
  }));

  // ---------- Zustand & Speicher ----------

  function load(key) {
    try {
      const value = JSON.parse(localStorage.getItem(key));
      return value && typeof value === 'object' ? value : {};
    } catch (e) {
      return {};
    }
  }

  const newSeed = () => Math.floor(Math.random() * 0x100000000);
  const formatDay = (day) => day.split('-').reverse().join('.'); // "2026-09-24" → "24.09.2026"

  const saved = load(STORE_KEY);
  const legacy = saved.settings ? {} : load(OLD_STORE_KEY);
  const today = Tagesliste.dayKey();
  // Der gespeicherte Stand gilt nur für denselben Tag – an einem neuen Tag gibt es eine neue Liste.
  const sameDay = saved.day === today && Number.isInteger(saved.seed);
  const state = {
    all: [], // ganzes Sortiment wie in der CSV
    items: [], // heutige Auswahl, nach Laufweg sortiert, innerhalb der Warengruppen gemischt
    index: 0,
    day: today,
    // Fortschritt je EAN ('ok' | 'mismatch' | 'skip'), damit er auch nach einer geänderten Liste passt
    marks: sameDay && saved.marks && typeof saved.marks === 'object' && !Array.isArray(saved.marks) ? saved.marks : {},
    seed: sameDay ? saved.seed : Tagesliste.daySeed(today),
    settings: Object.assign({}, DEFAULT_SETTINGS, legacy.settings, saved.settings),
    datenstand: '',
    loading: true,
    loadError: '',
  };
  state.settings.laufweg = Warengruppen.normalizeOrder(state.settings.laufweg);
  state.settings.perDay = Tagesliste.normalizeRange(state.settings.perDay);
  let resume = sameDay ? { code: saved.code, index: saved.index } : null; // Stelle, an der es heute weitergeht

  function save() {
    const item = state.items[state.index];
    try {
      localStorage.setItem(
        STORE_KEY,
        JSON.stringify({
          day: state.day,
          code: item ? item.code : null,
          index: state.index,
          marks: state.marks,
          seed: state.seed,
          settings: state.settings,
        })
      );
    } catch (e) {
      /* privater Modus o. ä. – dann eben ohne Speichern */
    }
  }

  const markOf = (item) => (MARKS[state.marks[item.code]] ? state.marks[item.code] : '');

  function counts() {
    const c = { ok: 0, mismatch: 0, skip: 0, open: 0 };
    state.items.forEach((it) => c[markOf(it) || 'open']++);
    return c;
  }

  // Heutige Liste: Zufallsauswahl aus dem Sortiment, nach Laufweg sortiert.
  function arrangeDay() {
    const s = state.settings;
    return Warengruppen.arrange(Tagesliste.pick(state.all, state.seed, s.perDay), s.laufweg, state.seed);
  }

  async function loadData() {
    state.loading = true;
    state.loadError = '';
    render();
    try {
      const data = await Sortiment.load(DATA_URL);
      data.items.forEach((it) => (it.gruppe = Warengruppen.classify(it)));
      state.all = data.items;
      state.items = arrangeDay();
      state.datenstand = data.datenstand;
      if (!state.items.length) state.loadError = 'Die Sortimentsliste enthält keine gültigen EAN-Codes.';
      const byCode = resume && resume.code ? state.items.findIndex((it) => it.code === resume.code) : -1;
      const byIndex = resume && Number.isInteger(resume.index) ? resume.index : 0;
      state.index = byCode >= 0 ? byCode : Math.max(0, Math.min(byIndex, state.items.length));
      if (!resume && state.items.length) toast('Neue Tagesliste: ' + state.items.length + ' Artikel', 'ok', 2500);
      save();
    } catch (err) {
      state.loadError = 'Das Sortiment konnte nicht geladen werden (' + ((err && err.message) || 'unbekannter Fehler') + ').';
    }
    state.loading = false;
    render();
  }

  // Erster Artikel ohne Markierung (alle markiert: "Fertig"-Ansicht).
  function firstOpen() {
    const i = state.items.findIndex((it) => !markOf(it));
    return i >= 0 ? i : state.items.length;
  }

  // Neu zusammenstellen (Laufweg oder Anzahl pro Tag geändert); der aktuelle Artikel bleibt der aktuelle.
  function rearrange() {
    const current = state.items[state.index];
    state.items = arrangeDay();
    const k = current ? state.items.indexOf(current) : -1;
    state.index = k >= 0 ? k : firstOpen();
    save();
    render();
  }

  // ---------- Anzeige ----------

  function render() {
    const n = state.items.length;
    const i = state.index;
    const ready = !state.loading && !state.loadError && n > 0;
    const done = ready && i >= n;
    const c = counts();

    el.viewLoading.hidden = ready;
    el.viewCode.hidden = !ready || done;
    el.viewDone.hidden = !done;
    el.prev.disabled = !ready || i === 0;
    el.next.disabled = !ready || done;

    if (!ready) {
      el.summary.textContent = state.loading ? 'Sortiment wird geladen …' : 'Sortiment nicht verfügbar';
      el.loadingTitle.textContent = state.loading ? 'Sortiment wird geladen …' : 'Fehler beim Laden';
      el.loadingText.textContent = state.loadError;
      el.loadingActions.hidden = state.loading;
      return;
    }
    el.summary.textContent = 'Heute ' + n + ' Artikel · ' + (c.ok + c.mismatch) + ' gescannt';

    if (done) {
      el.doneText.textContent =
        'Alle ' + n + ' Artikel der Tagesliste durchlaufen – ' + (c.ok + c.mismatch) + ' per Scan' +
        (c.skip ? ', ' + c.skip + ' übersprungen' : '') + '. Morgen gibt es eine neue Liste.';
      return;
    }

    const item = state.items[i];
    el.pos.textContent = i + 1 + ' / ' + n;
    el.group.textContent = Warengruppen.nameOf(item.gruppe);
    el.name.textContent = item.name || 'Artikel ' + (i + 1);
    el.meta.textContent = [item.marke, item.inhalt].filter(Boolean).join(' · ');
    el.code.textContent = item.type + ' ' + item.code;
    if (!item.valid) el.note.textContent = item.note + ' – der Scanner wird diesen Code nicht lesen';
    else if (markOf(item) === 'ok') el.note.textContent = '✓ bereits gescannt';
    else el.note.textContent = item.note;
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

  let lastActivityAt = Date.now();
  function goTo(i) {
    const n = state.items.length;
    if (!n) return;
    if (i >= n && state.settings.loop) i = 0;
    state.index = Math.max(0, Math.min(i, n)); // n = "Fertig"-Ansicht
    lastActivityAt = Date.now();
    save();
    render();
  }

  // Einen Artikel weiter; beim Wechsel in die nächste Warengruppe kurz Bescheid geben.
  function advance() {
    const before = state.items[state.index];
    goTo(state.index + 1);
    const after = state.items[state.index];
    const changed = before && after && after !== before && after.gruppe !== before.gruppe;
    if (changed) toast('Weiter mit: ' + Warengruppen.nameOf(after.gruppe), 'ok', 2200);
    return changed;
  }

  function next() {
    const item = state.items[state.index];
    if (!item) return;
    if (!state.marks[item.code]) state.marks[item.code] = 'skip';
    advance();
  }

  function prev() {
    goTo(Math.min(state.index, state.items.length) - 1);
  }

  // Heutige Liste von vorne: Markierungen zurücksetzen, gleiche Artikel in gleicher Reihenfolge.
  function restart() {
    state.marks = {};
    goTo(0);
  }

  // Andere Liste (neuer Tag oder neu ausgelost): Auswahl, Anzahl und Reihenfolge hängen am seed.
  function startList(seed) {
    state.seed = seed;
    state.marks = {};
    state.items = arrangeDay();
    resume = null;
    goTo(0);
  }

  const dialogOpen = () => el.dlgList.open || el.dlgSettings.open;

  // Neuer Tag bei offener Seite (z. B. über Nacht angelassen): neue Liste, aber nicht mitten im Scannen.
  function checkDay() {
    const day = Tagesliste.dayKey();
    if (day === state.day || !state.all.length || dialogOpen()) return;
    if (Date.now() - lastActivityAt < IDLE_MS) return;
    state.day = day;
    startList(Tagesliste.daySeed(day));
    toast('Neuer Tag – neue Liste mit ' + state.items.length + ' Artikeln', 'ok', 3000);
  }
  setInterval(checkDay, 60 * 1000);

  // Ein Scan wurde erkannt (Piepton oder Tastatureingabe des Scanners).
  let lastScanAt = -Infinity;
  function onScan(source, scanned) {
    pulseMeters();
    if (dialogOpen() || !state.items.length) return;
    const item = state.items[state.index];
    if (!item) {
      toast('Alle Artikel sind durch.');
      return;
    }
    const now = performance.now();
    if (now - lastScanAt < state.settings.cooldownMs) return; // z. B. Piepton + Tastatur vom selben Scan
    lastScanAt = now;

    const match = source !== 'keyboard' || EAN.sameCode(scanned, item.code);
    state.marks[item.code] = match ? 'ok' : 'mismatch';
    advance();
    flash(match ? 'ok' : 'warn');
    if (!match) toast('Gescannt: ' + scanned + ' – passt nicht zum angezeigten Artikel', 'warn', 3500);
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
    checkDay();
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

  // ---------- Sortiment-Übersicht ----------

  function openList() {
    if (!state.items.length) return;
    el.search.value = '';
    renderOverview();
    el.dlgList.showModal();
    const cur = el.overview.querySelector('.is-current');
    if (cur) cur.scrollIntoView({ block: 'center' });
  }

  function matches(item, q) {
    const text = item.name + ' ' + item.marke + ' ' + Warengruppen.nameOf(item.gruppe);
    return !q || item.code.includes(q) || text.toLowerCase().includes(q);
  }

  // Stand je Warengruppe: { gruppe: { total, done } }
  function groupStats() {
    const stats = {};
    state.items.forEach((it) => {
      const s = stats[it.gruppe] || (stats[it.gruppe] = { total: 0, done: 0 });
      s.total++;
      if (markOf(it) === 'ok' || markOf(it) === 'mismatch') s.done++;
    });
    return stats;
  }

  function renderOverview() {
    const q = el.search.value.trim().toLowerCase();
    const frag = document.createDocumentFragment();
    const stats = groupStats();
    let lastGroup = null;
    state.items.forEach((it, k) => {
      if (!matches(it, q)) return;
      if (it.gruppe !== lastGroup) {
        lastGroup = it.gruppe;
        const head = document.createElement('li');
        head.className = 'group-head';
        head.innerHTML = '<span class="gname"></span><span class="gcount"></span>';
        head.querySelector('.gname').textContent = Warengruppen.nameOf(it.gruppe);
        head.querySelector('.gcount').textContent = stats[it.gruppe].done + ' / ' + stats[it.gruppe].total + ' ✓';
        frag.appendChild(head);
      }
      const mark = markOf(it);
      const li = document.createElement('li');
      li.className = [k === state.index ? 'is-current' : '', it.valid ? '' : 'invalid'].join(' ').trim();
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.index = String(k);
      b.innerHTML =
        '<span class="n">' + (k + 1) + '</span><span class="mark ' + mark + '">' + (MARKS[mark] || '') + '</span>' +
        '<span class="name"><span class="title"></span><span class="sub"></span></span><span class="code">' + it.code + '</span>';
      b.querySelector('.title').textContent = it.name || it.type;
      b.querySelector('.sub').textContent = [it.marke, it.inhalt].filter(Boolean).join(' · ');
      li.appendChild(b);
      frag.appendChild(li);
    });
    if (!frag.querySelector('button')) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = 'Keine Treffer';
      frag.appendChild(li);
    }
    el.overview.replaceChildren(frag);

    const c = counts();
    el.overviewStats.textContent =
      state.items.length + ' Artikel: ' + c.ok + ' ✓ gescannt' + (c.mismatch ? ' · ' + c.mismatch + ' ⚠ abweichend' : '') +
      (c.skip ? ' · ' + c.skip + ' ↷ übersprungen' : '') + ' · ' + c.open + ' offen';
    el.dataInfo.textContent =
      'Tagesliste vom ' + formatDay(state.day) + ': ' + state.items.length + ' von ' + state.all.length +
      ' Artikeln aus dem Sortiment von Netto Marken-Discount (Deutschland), Eigenmarken-Lebensmittel' +
      (state.datenstand ? ', Datenstand ' + state.datenstand : '') + '. Angaben ohne Gewähr.';
  }

  el.search.addEventListener('input', renderOverview);
  el.search.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault(); // sonst schließt das Formular den Dialog
    const first = el.overview.querySelector('button[data-index]');
    if (first) first.click();
  });

  el.overview.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-index]');
    if (!b) return;
    el.dlgList.close();
    goTo(Number(b.dataset.index));
  });

  // ---------- Einstellungen ----------

  function openSettings() {
    fillSettings();
    renderCalibState();
    renderTagesInfo();
    renderLaufweg();
    el.dlgSettings.showModal();
  }

  function renderTagesInfo() {
    el.tagesInfo.textContent =
      'Heute (' + formatDay(state.day) + '): ' + state.items.length + ' von ' + state.all.length + ' Artikeln';
  }

  // Laufweg: alle Warengruppen, die im Sortiment vorkommen (auch wenn heute keiner ihrer Artikel dran ist).
  function visibleGroups() {
    const present = new Set(state.all.map((it) => it.gruppe));
    return state.settings.laufweg.filter((id) => present.has(id));
  }

  function renderLaufweg() {
    const stats = groupStats();
    const visible = visibleGroups();
    el.laufweg.replaceChildren(
      ...visible.map((id, i) => {
        const li = document.createElement('li');
        li.dataset.id = id;
        li.innerHTML =
          '<span class="lw-name"></span><span class="lw-count"></span>' +
          '<button type="button" class="icon-btn" data-move="-1" aria-label="Nach oben">↑</button>' +
          '<button type="button" class="icon-btn" data-move="1" aria-label="Nach unten">↓</button>';
        li.querySelector('.lw-name').textContent = Warengruppen.nameOf(id);
        li.querySelector('.lw-count').textContent = stats[id] ? stats[id].total : 0;
        li.querySelector('[data-move="-1"]').disabled = i === 0;
        li.querySelector('[data-move="1"]').disabled = i === visible.length - 1;
        return li;
      })
    );
    const isDefault = state.settings.laufweg.join() === Warengruppen.normalizeOrder(Warengruppen.DEFAULT_ORDER).join();
    el.laufwegReset.hidden = isDefault;
  }

  el.laufweg.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-move]');
    if (!btn) return;
    const id = btn.closest('li').dataset.id;
    const dir = Number(btn.dataset.move);
    const visible = visibleGroups();
    const other = visible[visible.indexOf(id) + dir];
    if (!other) return;
    const order = state.settings.laufweg.slice();
    const a = order.indexOf(id);
    const b = order.indexOf(other);
    [order[a], order[b]] = [order[b], order[a]];
    changeSettings({ laufweg: order });
    rearrange();
    renderLaufweg();
    const again = el.laufweg.querySelector('li[data-id="' + id + '"] [data-move="' + dir + '"]');
    if (again && !again.disabled) again.focus();
  });

  el.laufwegReset.addEventListener('click', () => {
    changeSettings({ laufweg: Warengruppen.normalizeOrder(Warengruppen.DEFAULT_ORDER) });
    rearrange();
    renderLaufweg();
  });

  function fillSettings() {
    const s = state.settings;
    el.setMic.checked = s.mic;
    el.setKeyboard.checked = s.keyboard;
    el.setLoop.checked = s.loop;
    el.setLevel.value = s.minLevelDb;
    el.setCooldown.value = s.cooldownMs;
    el.setSize.value = s.size;
    el.setPerDayMin.value = s.perDay.min;
    el.setPerDayMax.value = s.perDay.max;
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

  // Artikel pro Tag: die heutige Liste wird sofort angepasst, der Fortschritt bleibt.
  function applyPerDay(edited) {
    const s = state.settings;
    let min = Number(el.setPerDayMin.value || s.perDay.min);
    let max = Number(el.setPerDayMax.value || s.perDay.max);
    if (min > max) {
      // "von" über "bis" (oder umgekehrt): das gerade geänderte Feld gilt, das andere zieht nach
      if (edited === el.setPerDayMin) max = min;
      else min = max;
    }
    changeSettings({ perDay: Tagesliste.normalizeRange({ min, max }) });
    rearrange();
    renderTagesInfo();
    renderLaufweg();
  }
  [el.setPerDayMin, el.setPerDayMax].forEach((input) => {
    input.addEventListener('change', () => applyPerDay(input));
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault(); // sonst schließt das Formular den Dialog
      applyPerDay(input);
    });
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

  $('#btn-restart-day').addEventListener('click', () => {
    restart();
    el.dlgSettings.close();
    toast('Von vorne – ' + state.items.length + ' Artikel');
  });

  $('#btn-new-list').addEventListener('click', () => {
    startList(newSeed());
    el.dlgSettings.close();
    const first = state.items[0];
    toast(
      'Neue Liste: ' + state.items.length + ' Artikel – los geht’s mit ' +
        (first ? Warengruppen.nameOf(first.gruppe) : 'dem ersten Artikel')
    );
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
    else if (action === 'restart') restart();
    else if (action === 'reload-data') loadData();
  });

  // ---------- Start ----------

  updateListenUI();
  loadData();
})();
