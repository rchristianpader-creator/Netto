/*
 * Barcode-Scanner mit der Kamera: EAN-13 / EAN-8 und Code 128 (z. B. auf Netto-Regaletiketten, dort steht
 * eine ladeninterne 13-stellige Nummer mit Prüfziffer drin). Was zählt, prüft der Aufrufer (gültige EAN).
 * Nutzt die eingebaute Barcode-Erkennung des Browsers (BarcodeDetector, z. B. Chrome auf Android).
 * Wo es die nicht gibt (Safari auf dem iPhone), wird zxing-cpp als WebAssembly nachgeladen
 * (js/vendor/zxing-wasm/, 3- bis 10-mal schneller als ZXing in JavaScript, erkennt auch gedrehte Codes);
 * lädt das nicht, dient ZXing in JavaScript als Ersatz (js/vendor/zxing.min.js).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CameraScanner = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const ZXING_URL = 'js/vendor/zxing.min.js';
  const WASM_DIR = 'js/vendor/zxing-wasm/';
  const INTERVAL_MS = 30; // Pause zwischen zwei Erkennungsversuchen (die Erkennung selbst dauert meist 10–60 ms)
  const WASM_FORMATS = ['EAN13', 'EAN8', 'Code128'];
  const MAX_SIDE = 1280; // Kamerabild für den schnellen Versuch auf höchstens diese Kantenlänge verkleinern
  const MARGIN = 0.08; // Suchbereich: sichtbarer Ausschnitt plus so viel Rand (Anteil des Kamerabilds) rundherum

  /**
   * Welcher Teil des Kamerabilds (vw × vh) im Vorschaufenster (bw × bh, object-fit: cover) zu sehen ist,
   * erweitert um `margin` – in Kamerabild-Pixeln { x, y, w, h }. Gilt für Quer- und Hochformat.
   */
  function searchRect(vw, vh, bw, bh, margin) {
    let w = vw;
    let h = vh;
    if (bw > 0 && bh > 0) {
      if (vw / vh > bw / bh) w = (vh * bw) / bh; // Bild breiter als das Fenster: links/rechts abgeschnitten
      else h = (vw * bh) / bw; // Bild höher: oben/unten abgeschnitten
    }
    const m = margin || 0;
    w = Math.min(vw, w + 2 * m * vw);
    h = Math.min(vh, h + 2 * m * vh);
    return { x: Math.round((vw - w) / 2), y: Math.round((vh - h) / 2), w: Math.round(w), h: Math.round(h) };
  }

  /** Graustufen aus RGBA-Pixeln (wie ImageData.data). */
  function luminance(rgba, width, height) {
    const lum = new Uint8ClampedArray(width * height);
    for (let i = 0, p = 0; i < lum.length; i++, p += 4) {
      lum[i] = (rgba[p] * 77 + rgba[p + 1] * 150 + rgba[p + 2] * 29) >> 8;
    }
    return lum;
  }

  /** ZXing-Leser für EAN-13, EAN-8 und Code 128. */
  function createZXingReader(ZXing) {
    const hints = new Map();
    hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [ZXing.BarcodeFormat.EAN_13, ZXing.BarcodeFormat.EAN_8, ZXing.BarcodeFormat.CODE_128]);
    hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
    const reader = new ZXing.MultiFormatReader();
    reader.setHints(hints);
    return reader;
  }

  /** Barcode lesen: { text, bar } (bar = { left, right, y } Lage auf der gelesenen Zeile, in Bildpixeln) oder null. */
  function decodeLuminanceResult(ZXing, reader, lum, width, height) {
    const source = new ZXing.RGBLuminanceSource(lum, width, height);
    try {
      const r = reader.decodeWithState(new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(source)));
      const pts = (r.getResultPoints() || []).filter(Boolean);
      const xs = pts.map((p) => p.getX());
      // ZXing liefert bei 1D-Codes die Mitten von Start- und Stoppzeichen, nicht die Außenkanten: um je 10 % der
      // gemessenen Breite nach außen erweitern (am Regaletikett gemessen: 482 px statt 576 px, 40 px zu weit rechts).
      const x1 = Math.min(...xs);
      const x2 = Math.max(...xs);
      const bar = pts.length >= 2 ? { left: x1 - 0.1 * (x2 - x1), right: x2 + 0.1 * (x2 - x1), y: pts[0].getY() } : null;
      return { text: r.getText(), bar };
    } catch (e) {
      return null; // NotFoundException u. ä.: in diesem Bild kein Barcode
    } finally {
      reader.reset();
    }
  }

  function decodeLuminance(ZXing, reader, lum, width, height) {
    const r = decodeLuminanceResult(ZXing, reader, lum, width, height);
    return r ? r.text : null;
  }

  /** Einen Barcode aus RGBA-Pixeln lesen (Inhalt als Text); null, wenn nichts erkannt wurde. */
  function decodeRGBA(ZXing, reader, rgba, width, height) {
    return decodeLuminance(ZXing, reader, luminance(rgba, width, height), width, height);
  }

  /**
   * Schwellen für den Kontrast-Versuch: knapp über den dunkelsten Stellen (den Strichen). Auf Regaletiketten
   * liegt der Code auf dunkelgrauem Grund direkt neben dem grauen Etikettrand; bei normalem Kontrast zählt der
   * Rand als Strich und die freie Fläche vor dem Code (Ruhezone) reicht nicht.
   */
  function darkThresholds(lum) {
    const hist = new Uint32Array(256);
    for (let i = 0; i < lum.length; i += 7) hist[lum[i]]++; // Stichprobe reicht
    const total = Math.ceil(lum.length / 7);
    let sum = 0;
    let dark = 0;
    for (; dark < 255; dark++) if ((sum += hist[dark]) >= total * 0.02) break;
    return [dark + 25, dark + 45].map((t) => Math.min(t, 250));
  }

  /** Wie decodeLuminanceResult, aber zusätzlich mit harter Schwelle (nur sehr dunkle Pixel sind Strich), wenn nötig. */
  function decodeRGBAHardResult(ZXing, reader, rgba, width, height) {
    const lum = luminance(rgba, width, height);
    const plain = decodeLuminanceResult(ZXing, reader, lum, width, height);
    if (plain) return plain;
    for (const t of darkThresholds(lum)) {
      const bw = new Uint8ClampedArray(lum.length);
      for (let i = 0; i < lum.length; i++) bw[i] = lum[i] < t ? 0 : 255;
      const hit = decodeLuminanceResult(ZXing, reader, bw, width, height);
      if (hit) return hit;
    }
    return null;
  }

  function decodeRGBAHard(ZXing, reader, rgba, width, height) {
    const r = decodeRGBAHardResult(ZXing, reader, rgba, width, height);
    return r ? r.text : null;
  }

  function loadScript(url) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = url;
      s.onload = resolve;
      s.onerror = () => reject(new Error('Barcode-Erkennung konnte nicht geladen werden.'));
      document.head.appendChild(s);
    });
  }

  async function nativeDecoder() {
    if (typeof BarcodeDetector === 'undefined') return null;
    try {
      const formats = await BarcodeDetector.getSupportedFormats();
      if (!formats.includes('ean_13') || !formats.includes('code_128')) return null;
      const detector = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'code_128'].filter((f) => formats.includes(f)) });
      return async (video) => {
        const found = await detector.detect(video);
        if (!found.length) return null;
        const b = found[0].boundingBox;
        return { text: found[0].rawValue, bar: b ? { left: b.x, right: b.x + b.width, y: b.y + b.height / 2 } : null };
      };
    } catch (e) {
      return null;
    }
  }

  /** Lage aus den vier Ecken, die zxing-cpp liefert: { left, right, y } (Außenkanten, y = Mitte). */
  function barFromPosition(pos, dx, dy) {
    if (!pos || !pos.topLeft) return null;
    const pts = [pos.topLeft, pos.topRight, pos.bottomRight, pos.bottomLeft];
    const xs = pts.map((p) => p.x);
    return { left: Math.min(...xs) + dx, right: Math.max(...xs) + dx, y: pts.reduce((a, p) => a + p.y, 0) / 4 + dy };
  }

  async function wasmDecoder() {
    if (typeof WebAssembly !== 'object') return null;
    try {
      const abs = (f) => new URL(WASM_DIR + f, document.baseURI).href;
      if (!self.ZXingWASM) await loadScript(abs('zxing-wasm-reader.js'));
      await self.ZXingWASM.prepareZXingModule({ overrides: { locateFile: (f) => abs(f) }, fireImmediately: true });
    } catch (e) {
      return null; // dann ZXing in JavaScript
    }
    const Z = self.ZXingWASM;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const grab = (sx, sy, w, h, video) => {
      canvas.width = w;
      canvas.height = h;
      ctx.drawImage(video, sx, sy, w, h, 0, 0, w, h);
      return ctx.getImageData(0, 0, w, h);
    };
    const first = (results, dx, dy) => {
      const r = results.find((x) => x.isValid !== false && x.text);
      return r ? { text: r.text, bar: barFromPosition(r.position, dx, dy) } : null;
    };
    // Meist das ganze Bild (zxing-cpp verkleinert und dreht selbst); jedes dritte Bild stattdessen der sichtbare
    // Bereich mit harter Schwelle für Regaletiketten (Code auf dunkelgrauem Grund dicht am Etikettrand).
    let pass = 0;
    let hardStep = 0;
    return async (video) => {
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (!vw || !vh) return null;
      pass = (pass + 1) % 3;
      if (pass !== 2) {
        const img = grab(0, 0, vw, vh, video);
        const res = await Z.readBarcodes(img, { formats: WASM_FORMATS, tryHarder: true, tryRotate: true, tryInvert: false, tryDownscale: true, maxNumberOfSymbols: 1 });
        return first(res, 0, 0);
      }
      const r = searchRect(vw, vh, video.clientWidth, video.clientHeight, MARGIN);
      const img = grab(r.x, r.y, r.w, r.h, video);
      const lum = luminance(img.data, r.w, r.h);
      const thresholds = darkThresholds(lum);
      const t = thresholds[hardStep++ % thresholds.length];
      const d = img.data;
      for (let i = 0; i < lum.length; i++) d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = lum[i] < t ? 0 : 255;
      const res = await Z.readBarcodes(img, { formats: WASM_FORMATS, tryHarder: true, tryRotate: false, tryDownscale: false, binarizer: 'BoolCast', maxNumberOfSymbols: 1 });
      return first(res, r.x, r.y);
    };
  }

  async function zxingDecoder() {
    if (!self.ZXing) await loadScript(ZXING_URL);
    const ZXing = self.ZXing;
    const reader = createZXingReader(ZXing);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    // Die Versuche wechseln sich Bild für Bild ab, damit jedes Bild schnell geht:
    // 0) ganzes Bild verkleinert, 1) sichtbarer Bereich in voller Auflösung (kleine Codes, mit Kontrast-Versuch),
    // 2) ganzes Bild um 90° gedreht (Strichcode hochkant gehalten).
    let pass = 0;
    const grab = (w, h, draw) => {
      canvas.width = w;
      canvas.height = h;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      draw();
      return ctx.getImageData(0, 0, w, h).data;
    };
    return async (video) => {
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (!vw || !vh) return null;
      const scale = Math.min(1, MAX_SIDE / Math.max(vw, vh));
      const sw = Math.round(vw * scale);
      const sh = Math.round(vh * scale);
      pass = (pass + 1) % 3;
      // Lage des Strichcodes zurück ins Kamerabild umrechnen (für die Texterkennung auf Regaletiketten)
      const map = (hit, fx, dx, dy) =>
        hit && { text: hit.text, bar: hit.bar && { left: hit.bar.left * fx + dx, right: hit.bar.right * fx + dx, y: hit.bar.y * fx + dy } };
      if (pass === 0) {
        const lum = luminance(grab(sw, sh, () => ctx.drawImage(video, 0, 0, sw, sh)), sw, sh);
        return map(decodeLuminanceResult(ZXing, reader, lum, sw, sh), 1 / scale, 0, 0);
      }
      if (pass === 1) {
        const r = searchRect(vw, vh, video.clientWidth, video.clientHeight, MARGIN);
        const data = grab(r.w, r.h, () => ctx.drawImage(video, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h));
        return map(decodeRGBAHardResult(ZXing, reader, data, r.w, r.h), 1, r.x, r.y);
      }
      const data = grab(sh, sw, () => {
        ctx.translate(sh, 0);
        ctx.rotate(Math.PI / 2);
        ctx.drawImage(video, 0, 0, sw, sh);
      });
      const hit = decodeLuminanceResult(ZXing, reader, luminance(data, sh, sw), sh, sw);
      return hit && { text: hit.text, bar: null }; // gedreht: keine Lage (Etikett-Text wäre ohnehin quer)
    };
  }

  class Scanner {
    /** handlers: { onRead(code|null, now, bar|null), onError(err) }; bar = Lage des Strichcodes im Kamerabild */
    constructor(video, handlers) {
      this.video = video;
      this.h = handlers;
      this.stream = null;
      this.decode = null;
      this.timer = null;
      this.running = false;
    }

    async start() {
      if (this.running) return;
      this.running = true;
      try {
        if (!window.isSecureContext) throw Object.assign(new Error(), { name: 'InsecureContext' });
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw Object.assign(new Error(), { name: 'NotSupported' });
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        });
        if (!this.running) return stream.getTracks().forEach((t) => t.stop());
        this.stream = stream;
        this.video.srcObject = stream;
        const track = stream.getVideoTracks()[0];
        // Dauer-Autofokus, wo das Gerät es anbietet (sonst ohne)
        if (track && track.applyConstraints) track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {});
        await this.video.play().catch(() => {});
        if (!this.decode) this.decode = (await nativeDecoder()) || (await wasmDecoder()) || (await zxingDecoder());
        if (this.running) this.loop();
      } catch (err) {
        this.stop();
        this.h.onError(err);
      }
    }

    loop() {
      if (!this.running) return;
      Promise.resolve()
        .then(() => (this.video.readyState >= 2 ? this.decode(this.video) : null))
        .catch(() => null)
        .then((hit) => {
          if (!this.running) return;
          const found = typeof hit === 'string' ? { text: hit, bar: null } : hit;
          this.h.onRead(found ? found.text : null, performance.now(), found && found.bar);
          this.timer = setTimeout(() => this.loop(), INTERVAL_MS);
        });
    }

    /** Ob das Gerät die Taschenlampe für die Kamera freigibt (Android meist ja, iPhone je nach iOS). */
    torchSupported() {
      const track = this.stream && this.stream.getVideoTracks()[0];
      const caps = track && track.getCapabilities ? track.getCapabilities() : {};
      return !!caps.torch;
    }

    /** Taschenlampe an/aus; liefert den neuen Zustand. */
    async setTorch(on) {
      const track = this.stream && this.stream.getVideoTracks()[0];
      if (!track) return false;
      try {
        await track.applyConstraints({ advanced: [{ torch: !!on }] });
        return !!on;
      } catch (e) {
        return false;
      }
    }

    /** Ausschnitt { x, y, w, h } des aktuellen Kamerabilds in voller Auflösung als Canvas (z. B. für Texterkennung). */
    grab(rect) {
      if (!rect || !this.video.videoWidth) return null;
      const c = document.createElement('canvas');
      c.width = rect.w;
      c.height = rect.h;
      c.getContext('2d').drawImage(this.video, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
      return c;
    }

    stop() {
      this.running = false;
      clearTimeout(this.timer);
      if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
      this.video.srcObject = null;
    }
  }

  return { Scanner, luminance, createZXingReader, decodeRGBA, decodeRGBAHard, decodeRGBAHardResult, darkThresholds, searchRect, barFromPosition };
});
