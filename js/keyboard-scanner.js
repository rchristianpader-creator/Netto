/*
 * Erkennt einen Barcode-Scanner im Tastatur-Modus ("Keyboard Wedge", Standard bei USB/Bluetooth):
 * Der Scanner "tippt" den Code in sehr kurzen Abständen und schickt meist Enter oder Tab hinterher.
 * Menschliches Tippen ist dafür zu langsam und wird ignoriert.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.KeyboardScanner = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DEFAULTS = {
    maxGapMs: 80, // größter Abstand zwischen zwei Zeichen eines Scans
    minLength: 6, // Mindestlänge mit Enter/Tab am Ende
    minLengthNoSuffix: 8, // Mindestlänge, wenn der Scanner nichts hinterherschickt
    idleMs: 150, // danach gilt ein Scan ohne Enter/Tab als beendet
  };

  class KeyboardScanner {
    constructor(onScan, opts) {
      this.onScan = onScan;
      this.o = Object.assign({}, DEFAULTS, opts);
      this.buf = '';
      this.last = -Infinity;
      this.timer = null;
    }

    /**
     * Verarbeitet einen Tastendruck (KeyboardEvent.key).
     * Liefert true, wenn die Taste zu einem Scan gehört (dann Standardaktion unterdrücken).
     */
    key(key, now) {
      if (key === 'Enter' || key === 'Tab') {
        const complete = this.buf.length >= this.o.minLength && now - this.last <= this.o.maxGapMs * 2;
        const code = this.buf;
        this.clear();
        if (complete) this.onScan(code);
        return complete;
      }
      if (key.length !== 1 || !/[0-9A-Za-z\]]/.test(key)) return false;

      if (now - this.last > this.o.maxGapMs) this.buf = '';
      this.buf += key;
      this.last = now;
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.idle(), this.o.idleMs);
      // Ab dem zweiten schnellen Zeichen ist es sehr wahrscheinlich der Scanner.
      return this.buf.length > 1;
    }

    idle() {
      const code = this.buf;
      this.clear();
      if (code.length >= this.o.minLengthNoSuffix) this.onScan(code);
    }

    clear() {
      clearTimeout(this.timer);
      this.timer = null;
      this.buf = '';
    }
  }

  return KeyboardScanner;
});
