/*
 * EAN Scan-Liste – Bedienoberfläche.
 * Benötigt ean.js, sortiment.js, warengruppen.js, tagesliste.js, tone-detector.js, keyboard-scanner.js,
 * erfassung.js, camera-scanner.js, github-sync.js, produktinfo.js, etikett-ocr.js.
 */
(function () {
  'use strict';

  const DATA_URL = 'data/netto-sortiment.csv';
  const STORE_KEY = 'ean-scan-liste.v2';
  const CAPTURE_KEY = 'ean-scan-liste.erfasst'; // selbst per Kamera erfasste EANs
  const TOKEN_KEY = 'ean-scan-liste.github-token'; // Schlüssel zum Schreiben der Sortiment-Datei auf GitHub
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
    captureGruppe: '', // Erfassen: feste Warengruppe (id) für neue Scans, '' = automatisch
    eigeneGruppen: [], // selbst angelegte Warengruppen (Namen)
  };

  const $ = (sel) => document.querySelector(sel);
  const el = {
    summary: $('#list-summary'),
    viewLoading: $('#view-loading'),
    loadingTitle: $('#loading-title'),
    loadingText: $('#loading-text'),
    loadingActions: $('#loading-actions'),
    reloadBtn: $('#loading-actions [data-action="reload-data"]'),
    emptyCapture: $('#loading-actions [data-action="open-capture"]'),
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
    dlgCapture: $('#dlg-capture'),
    cam: $('#cam'),
    camVideo: $('#cam-video'),
    camMsg: $('#cam-msg'),
    camResult: $('#cam-result'),
    camTorch: $('#cam-torch'),
    captured: $('#captured'),
    captureCount: $('#capture-count'),
    captureGruppe: $('#capture-gruppe'),
    captureGruppeHint: $('#capture-gruppe-hint'),
    syncState: $('#sync-state'),
    syncBtn: $('#btn-capture-sync'),
    ghToken: $('#set-gh-token'),
    ghState: $('#gh-state'),
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
    all: [], // ganzes Sortiment: CSV + selbst erfasste Artikel
    csv: [], // Sortiment aus der CSV
    eigene: [], // selbst erfasste EANs: [{ code, at }]
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
  if (!Array.isArray(state.settings.eigeneGruppen)) state.settings.eigeneGruppen = [];
  state.settings.eigeneGruppen.forEach((name) => Warengruppen.register(name));
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
      state.csv = data.items;
      // Was inzwischen im festen Sortiment steht, muss nicht mehr als eigener Artikel geführt werden.
      state.eigene = Erfassung.normalizeList(loadCaptured(), new Set(data.items.map((it) => it.code)));
      saveCaptured();
      // Warengruppen, die auf einem anderen Gerät angelegt wurden (Spalte "warengruppe"), hier auch anlegen
      data.items.concat(state.eigene.map((e) => ({ warengruppe: e.gruppe }))).forEach((it) => {
        if (it.warengruppe && !Warengruppen.idOf(it.warengruppe)) Warengruppen.register(it.warengruppe);
      });
      state.settings.laufweg = Warengruppen.normalizeOrder(state.settings.laufweg);
      rebuildAll();
      state.items = arrangeDay();
      state.datenstand = data.datenstand;
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

  function loadCaptured() {
    try {
      return JSON.parse(localStorage.getItem(CAPTURE_KEY)) || [];
    } catch (e) {
      return [];
    }
  }

  function saveCaptured() {
    try {
      localStorage.setItem(CAPTURE_KEY, JSON.stringify(state.eigene));
    } catch (e) {
      /* privater Modus o. ä. */
    }
  }

  function rebuildAll() {
    state.all = state.csv.concat(Erfassung.toItems(state.eigene));
    state.all.forEach((it) => (it.gruppe = Warengruppen.classify(it)));
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
      // Leeres Sortiment ist kein Fehler: Es wird per Kamera-Scan gefüllt.
      const empty = !state.loading && !state.loadError;
      el.summary.textContent = state.loading ? 'Sortiment wird geladen …' : empty ? 'Sortiment ist leer' : 'Sortiment nicht verfügbar';
      el.loadingTitle.textContent = state.loading ? 'Sortiment wird geladen …' : empty ? 'Sortiment ist leer' : 'Fehler beim Laden';
      el.loadingText.textContent = empty
        ? 'Oben auf „Erfassen“ tippen und Artikel scannen. Vorher oben im Fenster eine eigene Warengruppe anlegen oder wählen.'
        : state.loadError;
      el.loadingActions.hidden = state.loading;
      el.reloadBtn.hidden = empty;
      el.emptyCapture.hidden = !empty;
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

  const dialogOpen = () => el.dlgList.open || el.dlgSettings.open || el.dlgCapture.open;

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
    if (el.dlgCapture.open && source === 'keyboard') {
      captureCode(scanned); // Scanner am Gerät erfasst genauso wie die Kamera
      return;
    }
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
      ' Artikeln aus dem per Kamera erfassten Sortiment' +
      (state.eigene.length ? ', davon ' + state.eigene.length + ' nur auf diesem Gerät' : '') +
      '. Bezeichnungen von Open Food Facts, ohne Gewähr.';
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

  // ---------- Erfassen: EANs per Kamera ins Sortiment aufnehmen ----------

  const readFilter = new Erfassung.ReadFilter();
  const camera = new CameraScanner.Scanner(el.camVideo, {
    onRead: (code, now, bar) => {
      if (code && bar && Erfassung.isInStore(code)) keepLabelShot(code, bar);
      const accepted = readFilter.push(code, now);
      if (accepted) captureCode(accepted);
    },
    onError: (err) => showCamMessage(cameraError(err), true),
  });
  let captureChanged = false; // Sortiment geändert → Tagesliste beim Schließen neu zusammenstellen
  let lastAddedCode = null;
  let resultTimer = null;
  let audio = null;

  function cameraError(err) {
    switch (err && err.name) {
      case 'InsecureContext':
        return 'Kamera geht nur über https:// (oder localhost).';
      case 'NotAllowedError':
      case 'SecurityError':
        return 'Kamera-Zugriff verweigert. Bitte in den Browser-Einstellungen für diese Seite erlauben.';
      case 'NotFoundError':
      case 'OverconstrainedError':
        return 'Keine Kamera gefunden.';
      case 'NotReadableError':
        return 'Die Kamera wird gerade von einer anderen App benutzt.';
      case 'NotSupported':
        return 'Dieser Browser kann nicht auf die Kamera zugreifen.';
      default:
        return (err && err.message) || 'Die Kamera konnte nicht gestartet werden.';
    }
  }

  function showCamMessage(text, isError) {
    el.camMsg.textContent = text;
    el.camMsg.classList.toggle('error', !!isError);
  }

  // Kurzer Ton als Rückmeldung (hoch = neu aufgenommen, tief = schon vorhanden) und Vibration, wo möglich.
  function beep(freq, ms) {
    try {
      if (!audio) return;
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      gain.gain.value = 0.15;
      osc.frequency.value = freq;
      osc.connect(gain).connect(audio.destination);
      osc.start();
      osc.stop(audio.currentTime + ms / 1000);
    } catch (e) {
      /* ohne Ton */
    }
  }

  function showResult(kind, text) {
    el.camResult.className = 'cam-result ' + kind;
    el.camResult.textContent = text;
    el.camResult.hidden = false;
    el.cam.classList.toggle('hit-added', kind === 'added');
    clearTimeout(resultTimer);
    resultTimer = setTimeout(() => {
      el.camResult.hidden = true;
      el.cam.classList.remove('hit-added');
    }, 2500);
  }

  function knownItem(code) {
    return state.all.find((it) => it.code === code) || null;
  }

  // Gescannten Code ohne Rückfrage übernehmen; was schon im Sortiment ist, nicht nochmal.
  function captureCode(raw) {
    const fest = captureGruppeId();
    const r = Erfassung.capture(state.eigene, raw, knownItem, Date.now(), fest ? Warengruppen.nameOf(fest) : '');
    if (r.status === 'invalid') return; // Fehllesung: stillschweigend ignorieren
    if (r.status === 'known') {
      const it = r.item;
      const what = it.name === Erfassung.NAME ? 'schon erfasst' : [it.name, it.marke].filter(Boolean).join(' · ');
      showResult('known', 'Schon im Sortiment: ' + (what || r.code));
      beep(440, 90);
      return;
    }
    state.eigene = r.list;
    saveCaptured();
    rebuildAll();
    captureChanged = true;
    lastAddedCode = r.code;
    showResult('added', '✓ Neu aufgenommen: ' + r.code + (fest ? ' → ' + Warengruppen.nameOf(fest) : ''));
    beep(1320, 120);
    if (navigator.vibrate) navigator.vibrate(80);
    lookupName(r.code);
    renderCaptured();
  }

  // Artikelbezeichnung im Hintergrund nachschlagen (Open Food Facts / Open Beauty Facts) und direkt eintragen.
  // Aus dem Namen ergibt sich auch die Warengruppe, danach wird automatisch sortiert.
  const lookups = new Map(); // EAN → laufende Abfrage
  const lookupState = new Map(); // EAN → 'notfound' oder Fehlermeldung des letzten Versuchs
  const retries = new Map(); // EAN → Zahl der automatischen Wiederholungen
  const RETRY_MS = [5000, 15000, 45000];

  // Liefert ein Promise, das fertig ist, wenn die Abfrage durch ist. force = auch nach "nicht gefunden" nochmal fragen.
  function lookupName(code, force) {
    if (lookups.has(code)) return lookups.get(code);
    if (Erfassung.isInStore(code)) return readLabel(code); // Netto-interne Nummer: keine Datenbank kennt sie
    if (!force && lookupState.get(code) === 'notfound') return Promise.resolve();
    const job = Produktinfo.lookupDetailed(code, (url, init) => fetch(url, init)).then((r) => {
      lookups.delete(code);
      if (r.info) {
        lookupState.delete(code);
        retries.delete(code);
        if (state.eigene.some((e) => e.code === code && !e.synced && !e.name)) {
          state.eigene = Erfassung.describe(state.eigene, code, r.info);
          saveCaptured();
          rebuildAll();
          captureChanged = true;
          const it = knownItem(code);
          if (code === lastAddedCode && !el.camResult.hidden) {
            const ziel = it.gruppe !== 'sonstiges' ? ' → ' + Warengruppen.nameOf(it.gruppe) : '';
            showResult('added', '✓ ' + [r.info.name, r.info.marke].filter(Boolean).join(' · ') + ziel);
          }
        }
      } else {
        lookupState.set(code, r.error || 'notfound');
        // Netzwerkfehler, Überlastung o. ä.: automatisch nochmal versuchen
        const n = retries.get(code) || 0;
        if (r.error && n < RETRY_MS.length) {
          retries.set(code, n + 1);
          setTimeout(() => lookupName(code, true), RETRY_MS[n]);
        }
      }
      if (el.dlgCapture.open) renderCaptured();
    });
    lookups.set(code, job);
    return job;
  }

  // Regaletikett: Bezeichnung per Texterkennung vom Schild lesen (Ausschnitt beim Scannen gesichert).
  const labelShots = new Map(); // EAN → { canvas, clipped } mit Name/Marke/Inhalt
  const needsLabel = (code) => {
    const it = knownItem(code);
    return !it || (it.eigen && it.name === Erfassung.NAME); // noch nicht erfasst oder noch ohne Bezeichnung
  };

  // Textausschnitt sichern, solange das Schild im Bild ist. Ein vollständiger Ausschnitt ersetzt einen am
  // Bildrand abgeschnittenen; war der Text schon einmal unlesbar, wird mit dem besseren Bild neu gelesen.
  function keepLabelShot(code, bar) {
    if (!needsLabel(code)) return;
    const v = el.camVideo;
    const rect = EtikettOCR.textRect(bar, v.videoWidth, v.videoHeight);
    const old = labelShots.get(code);
    if (!rect || (old && (rect.clipped || !old.clipped))) return;
    const canvas = camera.grab(rect);
    if (!canvas) return;
    labelShots.set(code, { canvas, clipped: rect.clipped });
    const st = lookupState.get(code);
    if (!rect.clipped && !lookups.has(code) && (st === 'ocrfail' || st === 'instore')) readLabel(code);
  }

  function readLabel(code) {
    if (lookups.has(code)) return lookups.get(code);
    const shot = labelShots.get(code);
    if (!shot) {
      lookupState.set(code, 'instore');
      return Promise.resolve();
    }
    const job = EtikettOCR.read(shot.canvas)
      .catch(() => null)
      .then((info) => {
        lookups.delete(code);
        if (!info) {
          lookupState.set(code, 'ocrfail');
        } else {
          lookupState.delete(code);
          if (state.eigene.some((e) => e.code === code && !e.synced && !e.name)) {
            state.eigene = Erfassung.describe(state.eigene, code, Object.assign(info, { quelle: 'Regaletikett' }));
            saveCaptured();
            rebuildAll();
            captureChanged = true;
            const it = knownItem(code);
            if (code === lastAddedCode && !el.camResult.hidden) {
              const ziel = it.gruppe !== 'sonstiges' ? ' → ' + Warengruppen.nameOf(it.gruppe) : '';
              showResult('added', '✓ ' + [info.name, info.marke].filter(Boolean).join(' · ') + ziel);
            }
          }
        }
        if (el.dlgCapture.open) renderCaptured();
      });
    lookups.set(code, job);
    return job;
  }

  function lookupText(code) {
    if (lookups.has(code)) return 'Bezeichnung wird gesucht …';
    const st = lookupState.get(code);
    if (st === 'ocrfail') return 'Netto-Regaletikett: Text nicht lesbar – ganzes Schild ins Bild nehmen';
    if (st === 'instore' || Erfassung.isInStore(code)) return 'Netto-Regaletikett: ganzes Schild ins Bild halten, dann wird der Name gelesen';
    if (st === 'notfound') return 'Bei Open Food Facts unbekannt (antippen: Namen eingeben)';
    if (st) return 'Keine Bezeichnung: ' + st + ' (antippen: Namen eingeben)';
    return 'Ohne Bezeichnung (antippen: Namen eingeben)';
  }

  function formatWhen(ms) {
    const d = new Date(ms);
    const pad = (n) => String(n).padStart(2, '0');
    const time = pad(d.getHours()) + ':' + pad(d.getMinutes());
    return d.toDateString() === new Date().toDateString() ? 'heute ' + time : pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '. ' + time;
  }

  // Liste der selbst erfassten Artikel, nach Warengruppe (Laufweg-Reihenfolge), darin die neuesten zuerst.
  function renderCaptured() {
    const n = state.eigene.length;
    el.captureCount.textContent = n + ' Artikel';
    const items = new Map(state.all.filter((it) => it.eigen).map((it) => [it.code, it]));
    const rank = new Map(state.settings.laufweg.map((id, i) => [id, i]));
    const groupOf = (e) => (items.get(e.code) || {}).gruppe || 'sonstiges';
    const sorted = state.eigene.slice().sort((a, b) => rank.get(groupOf(a)) - rank.get(groupOf(b)) || b.at - a.at);
    const rows = [];
    let lastGroup = null;
    sorted.forEach((e) => {
      const g = groupOf(e);
      if (g !== lastGroup) {
        lastGroup = g;
        const head = document.createElement('li');
        head.className = 'group-head';
        head.textContent = Warengruppen.nameOf(g);
        rows.push(head);
      }
      const li = document.createElement('li');
      if (e.code === lastAddedCode) li.className = 'is-new';
      li.innerHTML = '<span class="name"><span class="title"></span><span class="sub"></span></span><span class="state"></span>' +
        (e.synced ? '<span></span>' : '<button type="button" class="del" aria-label="Entfernen">✕</button>');
      const title = e.name || lookupText(e.code);
      li.dataset.edit = e.code; // antippen: Bezeichnung eingeben oder korrigieren
      if (!e.name) li.classList.add('unnamed');
      li.querySelector('.title').textContent = title;
      li.querySelector('.title').classList.toggle('unknown', !e.name);
      li.querySelector('.sub').textContent = [e.code, e.marke, e.inhalt, formatWhen(e.at)].filter(Boolean).join(' · ');
      const st = li.querySelector('.state');
      st.textContent = e.dirty ? 'geändert' : e.synced ? '✓ im Sortiment' : 'nur hier';
      st.classList.toggle('synced', !!e.synced);
      if (!e.synced) li.querySelector('.del').dataset.code = e.code;
      rows.push(li);
    });
    if (!rows.length) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = 'Noch nichts erfasst.';
      rows.push(li);
    }
    el.captured.replaceChildren(...rows);
    $('#btn-capture-export').disabled = !n;
    $('#btn-capture-clear').disabled = !state.eigene.some((e) => !e.synced);
    renderSyncState();
  }

  // ---------- Selbst erfasste Artikel ins feste Sortiment auf GitHub übernehmen ----------

  function getToken() {
    try {
      return localStorage.getItem(TOKEN_KEY) || '';
    } catch (e) {
      return '';
    }
  }

  function setToken(token) {
    try {
      if (token) localStorage.setItem(TOKEN_KEY, token);
      else localStorage.removeItem(TOKEN_KEY);
    } catch (e) {
      /* privater Modus o. ä. */
    }
  }

  const pendingSync = () => state.eigene.filter((e) => !e.synced || e.dirty);
  let syncing = false;
  let syncError = '';

  function renderSyncState() {
    const pending = pendingSync().length;
    let text;
    if (syncing) text = 'Wird ins Sortiment übernommen …';
    else if (syncError) text = syncError;
    else if (!getToken())
      text = pending ? 'Nur auf diesem Gerät. Für alle Geräte: in den Einstellungen einen GitHub-Schlüssel eintragen.' : '';
    else if (pending) text = pending + ' noch nicht im festen Sortiment. Wird beim Schließen automatisch übernommen.';
    else if (state.eigene.length) text = 'Alles übernommen. Andere Geräte sehen die Artikel nach 1–2 Minuten.';
    else text = '';
    el.syncState.textContent = text;
    el.syncState.classList.toggle('bad', !!syncError && !syncing);
    el.syncBtn.disabled = syncing || !pending;
    el.syncBtn.hidden = !getToken();
  }

  async function syncCaptured(auto) {
    // Erst die Bezeichnungen abwarten, dann mit Namen übernehmen; nach einem Fehler einmal nachfragen.
    await Promise.all(
      Array.from(lookups.values()).concat(
        state.eigene
          .filter((e) => !e.synced && !e.name && lookupState.get(e.code) !== 'notfound' && !Erfassung.isInStore(e.code))
          .map((e) => lookupName(e.code, true))
      )
    );
    const pending = pendingSync();
    const token = getToken();
    if (syncing || !pending.length) return;
    if (!token) {
      if (!auto) toast('Erst in den Einstellungen einen GitHub-Schlüssel eintragen.', 'warn', 4000);
      return;
    }
    syncing = true;
    syncError = '';
    renderSyncState();
    try {
      // Warengruppe mitschreiben, damit sie im Sortiment fest steht
      const withGroup = pending.map((e) => {
        const it = knownItem(e.code);
        return Object.assign({}, e, { gruppe: it && it.gruppe !== 'sonstiges' ? Warengruppen.nameOf(it.gruppe) : '' });
      });
      const r = await GitHubSync.push(token, withGroup, (url, init) => fetch(url, init));
      const done = new Set(r.added.concat(r.present));
      const fixed = new Set(r.updated || []);
      state.eigene = state.eigene.map((e) => {
        if (!done.has(e.code)) return e;
        const next = Object.assign({}, e, { synced: true });
        if (fixed.has(e.code) || !r.present.includes(e.code) || !e.dirty) delete next.dirty;
        return next;
      });
      saveCaptured();
      const n = r.added.length;
      const k = fixed.size;
      toast(
        n || k
          ? '✓ ' + [n ? n + ' Artikel ins Sortiment übernommen' : '', k ? k + ' korrigiert' : ''].filter(Boolean).join(', ') +
              ', in 1–2 Minuten auf allen Geräten'
          : 'Schon alles im Sortiment',
        'ok',
        4000
      );
    } catch (err) {
      syncError = 'Nicht übernommen: ' + ((err && err.message) || 'unbekannter Fehler');
      toast(syncError, 'warn', 6000);
    }
    syncing = false;
    if (el.dlgCapture.open) renderCaptured();
  }

  el.syncBtn.addEventListener('click', () => syncCaptured(false));

  function renderGhState(html) {
    const token = getToken();
    el.ghToken.value = token;
    el.ghState.innerHTML =
      html || (token ? 'Schlüssel gespeichert.' : 'Kein Schlüssel: selbst erfasste Artikel bleiben auf diesem Gerät.');
  }

  $('#btn-gh-save').addEventListener('click', async () => {
    const token = el.ghToken.value.trim();
    if (!token) {
      renderGhState('<span class="bad">Bitte zuerst den Schlüssel einfügen.</span>');
      return;
    }
    el.ghState.textContent = 'Wird geprüft …';
    try {
      await GitHubSync.check(token, (url, init) => fetch(url, init));
      setToken(token);
      syncError = '';
      renderGhState('<span class="ok">✓ Schlüssel funktioniert und ist gespeichert.</span>');
      syncCaptured(true);
    } catch (err) {
      renderGhState('<span class="bad"></span>');
      el.ghState.firstChild.textContent = 'Nicht gespeichert: ' + ((err && err.message) || 'unbekannter Fehler');
      el.ghToken.value = token;
    }
  });

  $('#btn-gh-remove').addEventListener('click', () => {
    setToken('');
    renderGhState();
  });

  // ---------- Warengruppe für neue Scans (automatisch, fest gewählt oder neu angelegt) ----------

  const NEW_GROUP = '__neu__';

  function captureGruppeId() {
    const id = state.settings.captureGruppe;
    return id && Warengruppen.idOf(id) ? id : '';
  }

  function renderGruppeSelect() {
    const current = captureGruppeId();
    const opts = [new Option('Ohne Warengruppe', '')];
    Warengruppen.normalizeOrder(state.settings.laufweg)
      .filter((id) => id !== 'sonstiges')
      .forEach((id) => opts.push(new Option(Warengruppen.nameOf(id), id)));
    opts.push(new Option('＋ Neue Warengruppe …', NEW_GROUP));
    el.captureGruppe.replaceChildren(...opts);
    el.captureGruppe.value = current;
    el.captureGruppeHint.textContent = current
      ? 'Alles, was du jetzt scannst, kommt nach „' + Warengruppen.nameOf(current) + '“.'
      : 'Scans kommen nach „Ohne Warengruppe“. Eigene Warengruppe wählen oder mit „＋ Neue Warengruppe …“ anlegen.';
  }

  el.captureGruppe.addEventListener('change', () => {
    let value = el.captureGruppe.value;
    if (value === NEW_GROUP) {
      const name = (window.prompt('Name der neuen Warengruppe (z. B. „Aktion“ oder „Gang 3“):') || '').trim();
      value = name ? Warengruppen.register(name) : captureGruppeId();
      if (name && value && !state.settings.eigeneGruppen.includes(Warengruppen.nameOf(value)) && value.startsWith('x-')) {
        state.settings.eigeneGruppen = state.settings.eigeneGruppen.concat(Warengruppen.nameOf(value));
      }
      state.settings.laufweg = Warengruppen.normalizeOrder(state.settings.laufweg);
    }
    changeSettings({ captureGruppe: value || '' });
    renderGruppeSelect();
  });

  function openCapture() {
    if (state.loading || state.loadError) {
      toast('Erst muss das Sortiment geladen sein.', 'warn');
      return;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!audio && AC) audio = new AC();
      if (audio && audio.state === 'suspended') audio.resume();
    } catch (e) {
      audio = null;
    }
    lastAddedCode = null;
    el.camResult.hidden = true;
    renderGruppeSelect();
    // Bezeichnungen, die beim letzten Mal nicht nachgeschlagen werden konnten (z. B. offline), nochmal suchen
    state.eigene.forEach((e) => {
      if (e.name || e.synced) return;
      retries.delete(e.code);
      lookupName(e.code, true);
    });
    renderCaptured();
    el.dlgCapture.showModal();
    showCamMessage('Kamera wird gestartet …');
    el.camTorch.hidden = true;
    el.camTorch.setAttribute('aria-pressed', 'false');
    camera.start().then(() => {
      if (!camera.running) return;
      showCamMessage('');
      el.camTorch.hidden = !camera.torchSupported();
    });
  }

  el.camTorch.addEventListener('click', async () => {
    const on = el.camTorch.getAttribute('aria-pressed') !== 'true';
    el.camTorch.setAttribute('aria-pressed', String(await camera.setTorch(on)));
  });

  el.dlgCapture.addEventListener('close', () => {
    camera.stop();
    syncCaptured(true);
    if (captureChanged) {
      captureChanged = false;
      rearrange();
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (!el.dlgCapture.open) return;
    if (document.hidden) camera.stop();
    else camera.start().then(() => camera.running && showCamMessage(''));
  });

  // Bezeichnung von Hand eingeben oder korrigieren (z. B. wenn die Texterkennung ein Wort falsch gelesen hat)
  function editName(code) {
    const e = state.eigene.find((x) => x.code === code);
    if (!e) return;
    const name = window.prompt('Bezeichnung für ' + code + ':', e.name || '');
    if (name === null || !name.trim()) return;
    const marke = window.prompt('Marke (leer lassen, wenn keine):', e.marke || '');
    state.eigene = Erfassung.rename(state.eigene, code, marke === null ? { name } : { name, marke });
    lookupState.delete(code);
    saveCaptured();
    rebuildAll();
    captureChanged = true;
    renderCaptured();
  }

  el.captured.addEventListener('click', (e) => {
    const b = e.target.closest('button.del');
    const row = !b && e.target.closest('li[data-edit]');
    if (row) {
      editName(row.dataset.edit);
      return;
    }
    if (!b) return;
    state.eigene = state.eigene.filter((x) => x.code !== b.dataset.code);
    saveCaptured();
    rebuildAll();
    captureChanged = true;
    renderCaptured();
  });

  $('#btn-capture-clear').addEventListener('click', () => {
    const n = pendingSync().length;
    if (!n || !confirm('Alle ' + n + ' noch nicht übernommenen Artikel entfernen?')) return;
    state.eigene = state.eigene.filter((e) => e.synced);
    saveCaptured();
    rebuildAll();
    captureChanged = true;
    renderCaptured();
  });

  $('#btn-capture-export').addEventListener('click', () => {
    const blob = new Blob([Erfassung.toCSV(state.eigene)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'selbst-erfasst-' + Tagesliste.dayKey() + '.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  });

  // ---------- Einstellungen ----------

  function openSettings() {
    fillSettings();
    renderGhState();
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
  $('#btn-capture').addEventListener('click', () => {
    try {
      openCapture();
    } catch (err) {
      toast('Erfassen konnte nicht geöffnet werden: ' + ((err && err.message) || err), 'warn', 6000);
    }
  });
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
    else if (action === 'open-capture') openCapture();
  });

  // ---------- Start ----------

  updateListenUI();
  loadData();
})();
