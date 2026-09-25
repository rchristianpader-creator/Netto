const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../js/etikett-ocr.js');

test('parse: Name, Marke, Inhalt aus dem erkannten Text eines Regaletiketts', () => {
  assert.deepEqual(E.parse('Linsen-Eintopf\nSonnen Bassermann\n800g\n'), { name: 'Linsen-Eintopf', marke: 'Sonnen Bassermann', inhalt: '800g' });
  // Störzeichen und Rauschen vom Rest des Schilds
  assert.deepEqual(E.parse('| Linsen-Eintopf ,\nSonnen Bassermann\n800 g\n\nU Be n I\n_ © | .\nNM 26291 Kg = 2.95'), {
    name: 'Linsen-Eintopf', marke: 'Sonnen Bassermann', inhalt: '800 g',
  });
  assert.deepEqual(E.parse('Joghurt nach griechischer Art\nGutes Land\n4 x 150 g'), { name: 'Joghurt nach griechischer Art', marke: 'Gutes Land', inhalt: '4 x 150 g' });
  assert.deepEqual(E.parse('Schoko Drink\nGutes Land\n500 ml\n1.29'), { name: 'Schoko Drink', marke: 'Gutes Land', inhalt: '500 ml' });
  // ohne Marke
  assert.deepEqual(E.parse('Speisekartoffeln\n2,5 kg'), { name: 'Speisekartoffeln', marke: '', inhalt: '2,5 kg' });
  // kein Name erkennbar
  assert.equal(E.parse('1.99\n| ; 4'), null);
  assert.equal(E.parse(''), null);
});

test('parse: typische Verwechslungen in der Inhaltszeile (Pixelschrift) werden korrigiert', () => {
  assert.equal(E.parse('Linsen-Eintopf\nSonnen Bassermann\n8009\n').inhalt, '800 g'); // g als 9 gelesen
  assert.equal(E.parse('Hirtenkäse\nGutes Land\n250 9').inhalt, '250 g');
  assert.equal(E.parse('Joghurt\nGutes Land\n4 x 150 9').inhalt, '4 x 150 g');
  assert.equal(E.parse('Kartoffeln\n2,5 k9').inhalt, '2,5 kg');
  assert.equal(E.parse('Milch\n500 m1').inhalt, '500 ml');
  // der Name selbst wird nicht verändert
  assert.equal(E.parse('Pils 0,5 l\nSchloss\n0,5 l').name, 'Pils 0,5 l');
});

test('textRect: Textbereich links über dem Strichcode, am Bildrand abgeschnitten markiert', () => {
  // Maße vom Foto eines Etiketts: Strichcode x 300–880 auf Höhe 1810, Text bei x 290–1000, y 1060–1300
  const r = E.textRect({ left: 300, right: 880, y: 1810 }, 1932, 2576);
  assert.ok(r.x <= 290 && r.x + r.w >= 1000 && r.y <= 1060 && r.y + r.h >= 1300, JSON.stringify(r));
  assert.ok(r.y + r.h < 1390, 'Unterkante über dem Preis');
  assert.equal(r.clipped, false);
  const oben = E.textRect({ left: 300, right: 880, y: 700 }, 1932, 2576); // Schild oben aus dem Bild
  assert.equal(oben.clipped, true);
  assert.equal(E.textRect({ left: 300, right: 330, y: 1810 }, 1932, 2576), null); // Strichcode zu klein
});

test('parse: weißes Schild mit Sorte und Menge in einer Zeile ("sortiert - 150 g")', () => {
  assert.deepEqual(E.parse('Mandeln\nClarkys\nsortiert - 150 g\n1 kg\n14.60\n2.19'), { name: 'Mandeln', marke: 'Clarkys', inhalt: 'sortiert - 150 g' });
  // wie auf dem Handy gelesen: g als 9
  assert.deepEqual(E.parse('Mandeln\nClarkys\nsortiert - 1509'), { name: 'Mandeln', marke: 'Clarkys', inhalt: 'sortiert - 150 g' });
  // Marke nicht erkannt: die Mengenzeile wird trotzdem nicht zur Marke
  assert.deepEqual(E.parse('Mandeln\nsortiert - 1509'), { name: 'Mandeln', marke: '', inhalt: 'sortiert - 150 g' });
  // Grundpreis und Preis danach zählen nicht
  assert.equal(E.parse('Linsen-Eintopf\nSonnen Bassermann\n800 g\n1 kg = 2.49').inhalt, '800 g');
});
