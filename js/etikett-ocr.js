/*
 * Bezeichnung vom Netto-Regaletikett lesen (Texterkennung mit Tesseract, js/vendor/tesseract/).
 * Auf den elektronischen Preisschildern steht links oben Name, Marke und Inhalt, darunter groß der Preis und
 * ganz unten links der Strichcode. Aus der Lage des Strichcodes im Kamerabild ergibt sich, wo der Text steht;
 * nur dieser Ausschnitt wird gelesen (schnell und ohne Preis/Aktion-Schriftzug).
 * Tesseract (etwa 6 MB) wird erst beim ersten Regaletikett geladen.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EtikettOCR = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const BASE = 'js/vendor/tesseract/';

  /**
   * Ausschnitt mit Name/Marke/Inhalt aus der Lage des Strichcodes ({ left, right, y } in Bildpixeln, y = Mitte)
   * bestimmen. Maße am Foto eines Etiketts abgelesen (Strichcode 580 px breit, Text 260–1300 px darüber) und
   * großzügig erweitert. Ergebnis { x, y, w, h, clipped } im Bild (vw × vh) oder null, wenn zu klein/außerhalb;
   * clipped = der Bereich ragt über den Bildrand (Schild nicht ganz im Bild).
   */
  function textRect(bar, vw, vh) {
    const bw = bar.right - bar.left;
    if (!(bw >= 60)) return null;
    let x = bar.left - 0.08 * bw;
    let y = bar.y - 1.45 * bw;
    let x2 = x + 1.6 * bw;
    let y2 = bar.y - 0.8 * bw; // Unterkante: über dem großen Preis
    const clipped = x < 0 || y < 0 || x2 > vw || y2 > vh;
    x = Math.max(0, x);
    y = Math.max(0, y);
    x2 = Math.min(vw, x2);
    y2 = Math.min(vh, y2);
    if (x2 - x < 40 || y2 - y < 20) return null;
    return { x: Math.round(x), y: Math.round(y), w: Math.round(x2 - x), h: Math.round(y2 - y), clipped };
  }

  const UNIT = '(?:kg|g|mg|ml|cl|l|liter|stück|stk\\.?|st\\.?|blatt|rollen|tabs|wl|m)';
  // Menge am Zeilenende, z. B. "800g", "500 ml", "4 x 150 g", "sortiert - 150 g"
  const SIZE_END = new RegExp('(\\d+(?:[.,]\\d+)?\\s?(?:x\\s?\\d+(?:[.,]\\d+)?\\s?)?' + UNIT + ')\\.?$', 'i');
  const letters = (s) => (s.match(/[A-Za-zÄÖÜäöüß]/g) || []).length;
  const textLike = (l) => letters(l) >= 3 && letters(l) / l.replace(/\s/g, '').length >= 0.6;

  /**
   * Typische Verwechslungen der Texterkennung am Ende der Mengenzeile korrigieren (Pixelschrift der Schilder):
   * g als 9 ("8009" → "800 g", "sortiert - 1509" → "sortiert - 150 g", "250 9" → "250 g"),
   * "k9" → "kg", "m1" → "ml".
   */
  function fixInhalt(line) {
    let l = line.replace(/\s+/g, ' ').trim();
    l = l.replace(/(\d) ?k9$/i, '$1 kg').replace(/(\d) ?m[1Il|]$/, '$1 ml');
    if (!SIZE_END.test(l)) l = l.replace(/(\d) 9$/, '$1 g').replace(/(\d{2,})9$/, '$1 g');
    return l;
  }

  /**
   * Erkannten Text in { name, marke, inhalt } zerlegen; null, wenn kein brauchbarer Name dabei ist.
   * Aufbau der Schilder: 1. Zeile Name, 2. Zeile Marke (fehlt manchmal), dann die Mengenzeile – entweder nur die
   * Menge ("800 g") oder mit Sorte davor ("sortiert - 150 g"). Was danach kommt (Grundpreis, Preis), zählt nicht.
   */
  function parse(text) {
    const lines = String(text || '')
      .split(/\r?\n/)
      .map((l) => l.replace(/[|_©®“”"‚‘'`~^]+/g, ' ').replace(/\s+/g, ' ').trim())
      .map((l) => l.replace(/^[^0-9A-Za-zÄÖÜäöüß]+|[^0-9A-Za-zÄÖÜäöüß%.)]+$/g, ''))
      .filter(Boolean);
    let name = '';
    let marke = '';
    let inhalt = '';
    for (const raw of lines) {
      if (!name) {
        if (textLike(raw)) name = raw; // Störzeilen davor überspringen
        continue;
      }
      const l = fixInhalt(raw);
      const m = l.match(SIZE_END);
      if (m) {
        // nur Menge → "150 g"; Sorte und Menge → ganze Zeile ("sortiert - 150 g")
        inhalt = letters(l.slice(0, m.index)) >= 3 ? l.replace(/\s*[-–]\s*/g, ' - ') : m[1].replace(/\s+/g, ' ');
        break;
      }
      if (!marke && textLike(l)) marke = l;
    }
    if (name.length < 3) return null;
    return { name, marke, inhalt };
  }

  let workerPromise = null;

  function loadScript(url) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = url;
      s.onload = resolve;
      s.onerror = () => reject(new Error('Texterkennung konnte nicht geladen werden.'));
      document.head.appendChild(s);
    });
  }

  function getWorker() {
    if (!workerPromise) {
      workerPromise = (async () => {
        const abs = (p) => new URL(BASE + p, document.baseURI).href; // der Worker löst Pfade selbst auf
        if (!self.Tesseract) await loadScript(abs('tesseract.min.js'));
        return self.Tesseract.createWorker('deu', 1 /* nur LSTM */, {
          workerPath: abs('worker.min.js'),
          corePath: abs('tesseract-core-lstm.wasm.js'),
          langPath: abs('').replace(/\/$/, ''),
          gzip: false,
        });
      })();
      workerPromise.catch(() => (workerPromise = null)); // nach einem Fehler beim nächsten Mal neu versuchen
    }
    return workerPromise;
  }

  /** Ausschnitt (Canvas) lesen: { name, marke, inhalt } oder null. */
  async function read(canvas) {
    const worker = await getWorker();
    const { data } = await worker.recognize(canvas);
    return parse(data && data.text);
  }

  return { textRect, parse, read };
});
