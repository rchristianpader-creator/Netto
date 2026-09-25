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
  const MAX_WIDTH = 1280; // Kamerabild für ZXing höchstens so breit (schneller, reicht für EAN)
  const CROP = { w: 0.7, h: 0.45 }; // zweiter Versuch: Bildmitte in voller Auflösung (kleine Codes, z. B. Regaletiketten)

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
    return async (video) => {
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (!vw || !vh) return null;
      const scale = Math.min(1, MAX_WIDTH / vw);
      let w = (canvas.width = Math.round(vw * scale));
      let h = (canvas.height = Math.round(vh * scale));
      ctx.drawImage(video, 0, 0, w, h);
      const code = decodeRGBA(ZXing, reader, ctx.getImageData(0, 0, w, h).data, w, h);
      if (code) return code;
      // Bildmitte ohne Verkleinerung: kleine Strichcodes haben dann genug Pixel pro Strich
      const cw = Math.round(vw * CROP.w);
      const ch = Math.round(vh * CROP.h);
      w = canvas.width = cw;
      h = canvas.height = ch;
      ctx.drawImage(video, Math.round((vw - cw) / 2), Math.round((vh - ch) / 2), cw, ch, 0, 0, cw, ch);
      return decodeRGBAHard(ZXing, reader, ctx.getImageData(0, 0, w, h).data, w, h);
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

  return { Scanner, luminance, createZXingReader, decodeRGBA, decodeRGBAHard, darkThresholds };
});
