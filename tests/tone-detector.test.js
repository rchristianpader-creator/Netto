const test = require('node:test');
const assert = require('node:assert/strict');
const { analyzeSpectrum, bandFor, ToneTrigger, Calibrator } = require('../js/tone-detector.js');

// Nachbau von AnalyserNode.getFloatFrequencyData: Blackman-Fenster, FFT, 20·log10(|X|/N).
const SR = 48000;
const N = 2048;
const BIN_HZ = SR / N;

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const cr = Math.cos(ang * k);
        const ci = Math.sin(ang * k);
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
      }
    }
  }
}

function spectrumOf(signal) {
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const w = 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / N) + 0.08 * Math.cos((4 * Math.PI * i) / N);
    re[i] = signal(i / SR) * w;
  }
  fft(re, im);
  const out = new Float32Array(N / 2);
  for (let k = 0; k < N / 2; k++) out[k] = 20 * Math.log10(Math.hypot(re[k], im[k]) / N);
  return out;
}

let seed = 1;
const noise = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff - 0.5) * 0.004;
const sine = (f, amp) => (t) => amp * Math.sin(2 * Math.PI * f * t) + noise();
const silence = () => noise();
const sawtooth = (f, amp) => (t) => {
  let v = 0;
  for (let k = 1; k * f < 8000; k++) v += Math.sin(2 * Math.PI * k * f * t) / k;
  return amp * v + noise();
};
const auto = (spec) => analyzeSpectrum(spec, BIN_HZ, 1000, 5000);

test('analyzeSpectrum findet einen Sinuston mit Frequenz, Pegel und Prominenz', () => {
  const a = auto(spectrumOf(sine(3250, 0.3)));
  assert.ok(Math.abs(a.freq - 3250) < 5, 'freq ' + a.freq);
  assert.ok(a.prominence > 40, 'prominence ' + a.prominence);
  assert.ok(a.level > -30 && a.level < -20, 'level ' + a.level);
  assert.equal(a.rivals, 0);
});

test('Klang mit vielen Obertönen (Musik) hat Konkurrenzspitzen und löst automatisch nicht aus', () => {
  const trig = new ToneTrigger();
  const a = auto(spectrumOf(sawtooth(523, 0.1)));
  assert.ok(a.rivals > 1, 'rivals ' + a.rivals);
  assert.equal(trig.isOn(a), false);
});

test('Ton knapp außerhalb des Suchbands zählt nicht (nur seine Flanke ragt hinein)', () => {
  const a = auto(spectrumOf(sine(950, 0.3)));
  assert.equal(a.prominence, 0);
});

test('ToneTrigger: ein Ereignis pro Piepton, kurze Störer ignoriert', () => {
  const trig = new ToneTrigger();
  const on = auto(spectrumOf(sine(3250, 0.3)));
  const off = auto(spectrumOf(silence));
  let t = 0;
  const feed = (a, frames) => {
    let fired = 0;
    for (let i = 0; i < frames; i++) fired += trig.update(a, (t += 15)) ? 1 : 0;
    return fired;
  };
  assert.equal(feed(off, 10), 0);
  assert.equal(feed(on, 1), 0, 'eine einzelne Messung reicht nicht');
  assert.equal(feed(off, 10), 0);
  assert.equal(feed(on, 20), 1, 'langer Ton löst genau einmal aus');
  assert.equal(feed(off, 2), 0, 'noch nicht wieder scharf');
  assert.equal(feed(on, 5), 0, 'Ton kam vor Ablauf der Freigabezeit zurück');
  assert.equal(feed(off, 10), 0);
  assert.equal(feed(on, 5), 1, 'neuer Piepton nach Pause');
});

test('ToneTrigger: angelernte Frequenz und Mindestlautstärke', () => {
  const trig = new ToneTrigger({ freq: 2700, minLevelDb: -45 });
  const band = bandFor(trig.o, BIN_HZ);
  const at = (signal) => analyzeSpectrum(spectrumOf(signal), BIN_HZ, band[0], band[1]);
  assert.equal(trig.isOn(at(sine(2700, 0.3))), true);
  assert.equal(trig.isOn(at(sine(3250, 0.3))), false, 'anderer Ton');
  assert.equal(trig.isOn(at(sine(2700, 0.003))), false, 'zu leise (weit weg)');
});

test('Calibrator lernt Frequenz und Schwellwert eines Pieptons', () => {
  const c = new Calibrator();
  let t = 0;
  let result = null;
  const frames = [...Array(20).fill(silence), ...Array(6).fill(sine(2700, 0.25)), ...Array(20).fill(silence)];
  for (const f of frames) {
    const r = c.add(spectrumOf(f), BIN_HZ, (t += 15));
    if (r && r.done) {
      result = r;
      break;
    }
  }
  assert.ok(result, 'Ton wurde erkannt');
  assert.ok(Math.abs(result.freq - 2700) <= 10, 'freq ' + result.freq);
  assert.ok(result.minLevelDb < result.level - 5 && result.minLevelDb > result.background, 'minLevel ' + result.minLevelDb);
});
