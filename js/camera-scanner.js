/*
 * Barcode-Scanner mit der Kamera: EAN-13 / EAN-8 und Code 128 (z. B. auf Netto-Regaletiketten, dort steht
 * eine ladeninterne 13-stellige Nummer mit Prüfziffer drin). Was zählt, prüft der Aufrufer (gültige EAN).
 * Nutzt die eingebaute Barcode-Erkennung des Browsers (BarcodeDetector, z. B. Chrome auf Android).
 * Wo es die nicht gibt (Safari auf dem iPhone), wird ZXing nachgeladen (js/vendor/zxing.min.js).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CameraScanner = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const ZXING_URL = 'js/vendor/zxing.min.js';
  const INTERVAL_MS = 100; // Pause zwischen zwei Erkennungsversuchen
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

  function decodeLuminance(ZXing, reader, lum, width, height) {
    const source = new ZXing.RGBLuminanceSource(lum, width, height);
    try {
      return reader.decodeWithState(new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(source))).getText();
    } catch (e) {
      return null; // NotFoundException u. ä.: in diesem Bild kein Barcode
    } finally {
      reader.reset();
    }
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

  /** Wie decodeRGBA, aber zusätzlich mit harter Schwelle (nur sehr dunkle Pixel sind Strich), wenn nötig. */
  function decodeRGBAHard(ZXing, reader, rgba, width, height) {
    const lum = luminance(rgba, width, height);
    const plain = decodeLuminance(ZXing, reader, lum, width, height);
    if (plain) return plain;
    for (const t of darkThresholds(lum)) {
      const bw = new Uint8ClampedArray(lum.length);
      for (let i = 0; i < lum.length; i++) bw[i] = lum[i] < t ? 0 : 255;
      const code = decodeLuminance(ZXing, reader, bw, width, height);
      if (code) return code;
    }
    return null;
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
        return found.length ? found[0].rawValue : null;
      };
    } catch (e) {
      return null;
    }
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
      if (pass === 0) {
        return decodeRGBA(ZXing, reader, grab(sw, sh, () => ctx.drawImage(video, 0, 0, sw, sh)), sw, sh);
      }
      if (pass === 1) {
        const r = searchRect(vw, vh, video.clientWidth, video.clientHeight, MARGIN);
        const data = grab(r.w, r.h, () => ctx.drawImage(video, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h));
        return decodeRGBAHard(ZXing, reader, data, r.w, r.h);
      }
      const data = grab(sh, sw, () => {
        ctx.translate(sh, 0);
        ctx.rotate(Math.PI / 2);
        ctx.drawImage(video, 0, 0, sw, sh);
      });
      return decodeRGBA(ZXing, reader, data, sh, sw);
    };
  }

  class Scanner {
    /** handlers: { onRead(code|null, now), onError(err) } */
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
        await this.video.play().catch(() => {});
        if (!this.decode) this.decode = (await nativeDecoder()) || (await zxingDecoder());
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
        .then((code) => {
          if (!this.running) return;
          this.h.onRead(code, performance.now());
          this.timer = setTimeout(() => this.loop(), INTERVAL_MS);
        });
    }

    stop() {
      this.running = false;
      clearTimeout(this.timer);
      if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
      this.video.srcObject = null;
    }
  }

  return { Scanner, luminance, createZXingReader, decodeRGBA, decodeRGBAHard, darkThresholds, searchRect };
});
