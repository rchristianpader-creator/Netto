/*
 * Erkennt den Piepton eines Barcode-Scanners über das Mikrofon.
 *
 * Idee: Ein Scanner-Piepton ist ein (fast) reiner Sinuston. Im Spektrum ergibt das eine
 * schmale, hohe Spitze, die sich deutlich von den Nachbarfrequenzen abhebt ("Prominenz").
 * Sprache, Klappern und Rauschen sind dagegen breitbandig. Ausgelöst wird, wenn
 *   - die Spitze laut genug ist (minLevelDb),
 *   - sie sich deutlich vom Umgebungsrauschen abhebt (minProminenceDb),
 *   - sie in mindestens minFrames Messungen hintereinander auf derselben Frequenz liegt.
 * Nach einem Auslösen muss der Ton erst wieder verstummen (releaseMs), bevor der nächste zählt.
 *
 * analyzeSpectrum / ToneTrigger / Calibrator sind reine Funktionen (in Node testbar),
 * ToneListener verbindet sie mit Mikrofon und Web-Audio-API.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ToneDetector = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const FLOOR_DB = -160;
  const FFT_SIZE = 2048; // ~23 Hz Auflösung bei 48 kHz, ~43 ms Fenster
  const TICK_MS = 15;
  // Honeywell-Scanner piepen je nach Modell/Einstellung z. B. mit 1600, 2700, 3250 oder 4200 Hz.
  const AUTO_BAND = [1000, 5000];
  const CALIB_BAND = [400, 8000];
  const CALIB_MIN_PROMINENCE = 24;
  const RIVAL_BAND = [300, 8000];
  const RIVAL_DB = 12;
  // Ein Rechteck-Piepton (Piezo) hat eine 3. Harmonische bei −9,5 dB → eine Konkurrenzspitze ist erlaubt.
  const MAX_RIVALS = 1;

  const DEFAULTS = {
    freq: null, // angelernte Frequenz in Hz, null = automatisch im AUTO_BAND suchen
    toleranceHz: 90,
    minLevelDb: -75,
    minProminenceDb: 20, // ohne angelernte Frequenz wird 5 dB strenger geprüft
    minFrames: 2,
    releaseMs: 70,
  };

  // -Infinity (digitale Stille) und NaN auf einen festen Boden setzen.
  const db = (v) => (v > FLOOR_DB ? v : FLOOR_DB);

  /**
   * Sucht die stärkste Spitze zwischen lowHz und highHz.
   * spec: dB-Werte je Frequenz-Bin (AnalyserNode.getFloatFrequencyData), binHz: Breite eines Bins.
   */
  function analyzeSpectrum(spec, binHz, lowHz, highHz) {
    const n = spec.length;
    const k0 = Math.max(2, Math.floor(lowHz / binHz));
    const k1 = Math.min(n - 3, Math.ceil(highHz / binHz));
    let kPeak = -1;
    let peak = FLOOR_DB;
    for (let k = k0; k <= k1; k++) {
      const v = db(spec[k]);
      if (v > peak) {
        peak = v;
        kPeak = k;
      }
    }
    if (kPeak < 0) return { level: FLOOR_DB, noise: FLOOR_DB, prominence: 0, freq: 0, bin: -1, rivals: 0 };

    // Liegt die eigentliche Spitze außerhalb des Suchbereichs (nur ihre Flanke ragt hinein), zählt sie nicht.
    let top = kPeak;
    while (top > 1 && db(spec[top - 1]) > db(spec[top])) top--;
    while (top < n - 2 && db(spec[top + 1]) > db(spec[top])) top++;
    if (top < k0 || top > k1) return { level: peak, noise: peak, prominence: 0, freq: top * binHz, bin: top, rivals: 0 };

    // Umgebungsrauschen: Median der Bins mit 5–40 Bins Abstand (Hauptkeule des Blackman-Fensters ausgenommen).
    const ref = [];
    for (let d = 5; d <= 40; d++) {
      if (kPeak - d >= 1) ref.push(db(spec[kPeak - d]));
      if (kPeak + d < n) ref.push(db(spec[kPeak + d]));
    }
    ref.sort((a, b) => a - b);
    const noise = ref.length ? ref[ref.length >> 1] : FLOOR_DB;

    // Parabolische Interpolation für eine Frequenz genauer als ein Bin.
    const a = db(spec[kPeak - 1]);
    const c = db(spec[kPeak + 1]);
    const denom = a - 2 * peak + c;
    const offset = denom < 0 ? (0.5 * (a - c)) / denom : 0;
    return {
      level: peak,
      noise,
      prominence: peak - noise,
      freq: (kPeak + offset) * binHz,
      bin: kPeak,
      rivals: countRivals(spec, binHz, kPeak, peak),
    };
  }

  /**
   * Zählt andere Spektralspitzen (300 Hz – 8 kHz), die höchstens RIVAL_DB leiser sind als die Hauptspitze.
   * Ein Piepton hat (fast) keine; Musik und Sprache bestehen aus vielen ähnlich starken Obertönen.
   */
  function countRivals(spec, binHz, kPeak, peak) {
    const lo = Math.max(2, Math.floor(RIVAL_BAND[0] / binHz));
    const hi = Math.min(spec.length - 2, Math.ceil(RIVAL_BAND[1] / binHz));
    const limit = peak - RIVAL_DB;
    let rivals = 0;
    for (let k = lo; k <= hi; k++) {
      if (Math.abs(k - kPeak) <= 4) continue;
      const v = db(spec[k]);
      if (v >= limit && v > db(spec[k - 1]) && v >= db(spec[k + 1])) rivals++;
    }
    return rivals;
  }

  /** Suchbereich in Hz für die aktuellen Einstellungen. */
  function bandFor(opts, binHz) {
    if (!opts.freq) return AUTO_BAND;
    const tol = Math.max(opts.toleranceHz, 3 * binHz);
    return [opts.freq - tol, opts.freq + tol];
  }

  /** Zustandsautomat: macht aus Einzelmessungen genau ein Ereignis pro Piepton. */
  class ToneTrigger {
    constructor(opts) {
      this.o = Object.assign({}, DEFAULTS, opts);
      this.reset();
    }

    set(opts) {
      Object.assign(this.o, opts);
      this.reset();
    }

    reset() {
      this.hits = 0;
      this.bin = -1;
      this.armed = true;
      this.firedBin = -1;
      this.lastOn = -Infinity;
    }

    isOn(a) {
      if (this.o.freq) return a.level >= this.o.minLevelDb && a.prominence >= this.o.minProminenceDb;
      // Automatisch (breites Suchband): strenger, und Klänge mit vielen Obertönen (Musik, Sprache) ausschließen.
      return a.level >= this.o.minLevelDb && a.prominence >= this.o.minProminenceDb + 5 && a.rivals <= MAX_RIVALS;
    }

    /** Liefert true genau in der Messung, in der ein neuer Piepton erkannt wurde. */
    update(a, now) {
      const on = this.isOn(a);
      if (!this.armed) {
        // Erst wieder scharf, wenn genau der auslösende Ton verklungen ist (andere Töne zählen nicht).
        if (on && Math.abs(a.bin - this.firedBin) <= 2) this.lastOn = now;
        else if (now - this.lastOn >= this.o.releaseMs) this.armed = true;
      }
      if (on) {
        if (this.hits > 0 && Math.abs(a.bin - this.bin) > 2) this.hits = 0;
        this.hits++;
        this.bin = a.bin;
      } else {
        this.hits = 0;
      }
      if (this.armed && this.hits >= this.o.minFrames) {
        this.armed = false;
        this.firedBin = a.bin;
        this.lastOn = now;
        return true;
      }
      return false;
    }
  }

  /**
   * Lernt den Piepton: wartet auf das erste deutliche Tonereignis (≥ 2 Messungen, gleiche Frequenz)
   * und liefert dessen Frequenz, Lautstärke und einen passenden Schwellwert.
   */
  class Calibrator {
    constructor() {
      this.history = []; // { t, spec } für den Hintergrundpegel
      this.event = null;
    }

    /** Neue Messung; liefert das Ergebnis, sobald ein Ton erkannt wurde und wieder verklungen ist. */
    add(spec, binHz, now) {
      this.binHz = binHz;
      this.history.push({ t: now, spec: Float32Array.from(spec) });
      if (this.history.length > 800) this.history.shift();

      const a = analyzeSpectrum(spec, binHz, CALIB_BAND[0], CALIB_BAND[1]);
      const on = a.prominence >= CALIB_MIN_PROMINENCE && a.level > -100 && a.rivals <= MAX_RIVALS;
      const ev = this.event;
      if (on && ev && Math.abs(a.bin - ev.bin) <= 2) {
        ev.frames.push(a);
        ev.last = now;
        ev.bin = a.bin;
      } else if (on) {
        if (ev && ev.frames.length >= 2) return this.finish();
        this.event = { bin: a.bin, frames: [a], start: now, last: now };
      } else if (ev && now - ev.last > 150) {
        if (ev.frames.length >= 2) return this.finish();
        this.event = null;
      }
      return a;
    }

    /** Ergebnis des erkannten Tons oder null. */
    finish() {
      const ev = this.event;
      if (!ev || ev.frames.length < 2) return null;
      const freqs = ev.frames.map((f) => f.freq).sort((x, y) => x - y);
      const freq = freqs[freqs.length >> 1];
      const level = Math.max(...ev.frames.map((f) => f.level));
      const prominence = Math.max(...ev.frames.map((f) => f.prominence));

      // Hintergrundpegel an dieser Frequenz aus den Messungen vor/nach dem Ton.
      const band = bandFor({ freq, toleranceHz: DEFAULTS.toleranceHz }, this.binHz);
      const quiet = this.history
        .filter((h) => h.t < ev.start - 50 || h.t > ev.last + 100)
        .map((h) => analyzeSpectrum(h.spec, this.binHz, band[0], band[1]).level)
        .sort((x, y) => x - y);
      const background = quiet.length ? quiet[quiet.length >> 1] : level - 40;

      const minLevelDb = Math.round(Math.min(level - 6, Math.max(background + 12, level - 20)));
      return { done: true, freq: Math.round(freq), level, prominence, background, minLevelDb };
    }
  }

  /** Mikrofon + Web Audio. handlers: onFrame(analysis, isOn), onTone(analysis), onEnded() */
  class ToneListener {
    constructor(handlers, opts) {
      this.h = handlers || {};
      this.trigger = new ToneTrigger(opts);
      this.calib = null;
      this.timer = null;
    }

    get active() {
      return !!this.timer;
    }

    /** Muss aus einem Klick heraus aufgerufen werden (Autoplay-Regeln der Browser). */
    async start() {
      if (this.stream) return this.resume();
      if (!window.isSecureContext) throw Object.assign(new Error('insecure'), { name: 'InsecureContext' });
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw Object.assign(new Error('unsupported'), { name: 'NotSupportedError' });
      }
      const Ctx = window.AudioContext || window.webkitAudioContext;
      const ctx = new Ctx(); // vor dem await erzeugen, solange der Klick noch "zählt"
      let stream;
      try {
        // Rauschunterdrückung & Co. aus: die würden gerade reine Töne wegfiltern oder verfälschen.
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        });
      } catch (err) {
        ctx.close();
        throw err;
      }
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = FFT_SIZE;
      analyser.smoothingTimeConstant = 0;
      source.connect(analyser);
      // Stumm an den Ausgang hängen, damit der Graph überall zuverlässig verarbeitet wird.
      const mute = ctx.createGain();
      mute.gain.value = 0;
      analyser.connect(mute);
      mute.connect(ctx.destination);

      this.ctx = ctx;
      this.stream = stream;
      this.analyser = analyser;
      this.spec = new Float32Array(analyser.frequencyBinCount);
      this.binHz = ctx.sampleRate / FFT_SIZE;
      stream.getAudioTracks().forEach((t) =>
        t.addEventListener('ended', () => {
          this.stop();
          if (this.h.onEnded) this.h.onEnded();
        })
      );
      return this.resume();
    }

    async resume() {
      if (this.ctx.state !== 'running') await this.ctx.resume();
      this.trigger.reset();
      if (!this.timer) this.timer = setInterval(() => this.tick(), TICK_MS);
    }

    pause() {
      clearInterval(this.timer);
      this.timer = null;
      this.cancelCalibration();
      if (this.ctx && this.ctx.state === 'running') this.ctx.suspend();
    }

    stop() {
      this.pause();
      if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
      if (this.ctx) this.ctx.close();
      this.stream = this.ctx = this.analyser = null;
    }

    configure(opts) {
      this.trigger.set(opts);
    }

    tick() {
      if (!this.analyser) return;
      this.analyser.getFloatFrequencyData(this.spec);
      const now = performance.now();

      if (this.calib) {
        const r = this.calib.add(this.spec, this.binHz, now);
        if (r && r.done) this.endCalibration(r);
        else if (r && this.h.onFrame) this.h.onFrame(r, r.prominence >= CALIB_MIN_PROMINENCE);
        return;
      }

      const band = bandFor(this.trigger.o, this.binHz);
      const a = analyzeSpectrum(this.spec, this.binHz, band[0], band[1]);
      const fired = this.trigger.update(a, now);
      if (this.h.onFrame) this.h.onFrame(a, this.trigger.isOn(a));
      if (fired && this.h.onTone) this.h.onTone(a);
    }

    /** Lauscht bis zu timeoutMs auf einen Piepton; liefert das Ergebnis oder null. */
    calibrate(timeoutMs) {
      this.cancelCalibration();
      return new Promise((resolve) => {
        this.calib = new Calibrator();
        this.calibResolve = resolve;
        this.calibTimer = setTimeout(() => this.endCalibration(this.calib && this.calib.finish()), timeoutMs || 8000);
      });
    }

    cancelCalibration() {
      if (this.calibResolve) this.endCalibration(null);
    }

    endCalibration(result) {
      const resolve = this.calibResolve;
      clearTimeout(this.calibTimer);
      this.calib = null;
      this.calibResolve = null;
      this.trigger.reset();
      if (resolve) resolve(result || null);
    }
  }

  return { analyzeSpectrum, bandFor, ToneTrigger, Calibrator, ToneListener, DEFAULTS, AUTO_BAND, FLOOR_DB };
});
