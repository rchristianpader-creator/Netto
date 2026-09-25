# EAN Scan-Liste

Eine Website, die das **Sortiment von Netto Marken-Discount (Deutschland)** Artikel für Artikel groß als Barcode
anzeigt. Man scannt den Barcode mit dem Honeywell-Scanner vom Bildschirm ab. **Sobald der Scanner piept, schaltet die
Seite automatisch zum nächsten Artikel.** Dafür hört die Seite über das Mikrofon auf den Scan-Ton.

**Online:** <https://rchristianpader-creator.github.io/Netto/>

- Das Sortiment wird selbst per Kamera erfasst (anfangs leer): Barcode scannen, die Bezeichnung kommt automatisch aus
  Open Food Facts, die Warengruppe legst du selbst fest; gespeichert in [`data/netto-sortiment.csv`](data/netto-sortiment.csv)
- **Jeden Tag eine neue Liste:** 50 bis 80 zufällig ausgewählte Artikel, auch die Anzahl ist zufällig
- Reihenfolge wie beim Gang durch den Laden: Warengruppe für Warengruppe, innerhalb jeder Gruppe zufällig gemischt
- Immer schwarzes Design; Barcodes pixelgenau gerendert (EAN-13 und EAN-8), schwarz auf weiß
- Scan-Ton-Erkennung mit Anlern-Funktion und Pegelanzeige, robust gegen Sprache, Musik und Klappern
- Hängt der Scanner per USB/Bluetooth am selben Gerät, geht es auch ohne Mikrofon (Tastatureingabe wird erkannt)
- Fortschritt mit ✓ je gescanntem Artikel, bleibt beim Neuladen erhalten; Bildschirm bleibt beim Scannen an

## So geht's

1. Seite öffnen (Handy/Tablet, Adresse oben). Der erste Artikel der heutigen Liste wird sofort angezeigt.
2. **Scan-Ton-Erkennung starten** antippen und das Mikrofon erlauben.
3. Barcode mit dem Scanner vom Bildschirm scannen, piep, nächster Artikel, und so weiter.
   Mit ‹ › geht es auch von Hand vor und zurück (übersprungene Artikel werden mit ↷ markiert).

### Tagesliste: jeden Tag 50 bis 80 zufällige Artikel

Jeden Tag wird aus dem Sortiment eine neue Liste ausgelost: 50 bis 80 Artikel, auch die Anzahl ist jeden Tag
zufällig. Jeder Artikel hat jeden Tag dieselbe Chance, dranzukommen. Die Auslosung hängt nur vom Datum ab: Die Liste
bleibt den ganzen Tag gleich (auch nach dem Neuladen und auf jedem Gerät), um Mitternacht kommt die nächste. Bleibt
die Seite über Nacht offen, wechselt sie zur neuen Liste, sobald zehn Minuten lang nichts gescannt wurde. Die
Häkchen (✓, ↷) gelten jeweils für den Tag.

- **Anzahl ändern:** Einstellungen → *Tagesliste* → *Artikel pro Tag* von … bis … (Standard 50 bis 80). Die heutige
  Liste wird sofort angepasst, schon gescannte Artikel behalten ihr ✓.
- **Von vorne beginnen:** setzt die Häkchen der heutigen Liste zurück, gleiche Artikel in gleicher Reihenfolge.
- **Neue Liste auslosen:** ersetzt die heutige Liste sofort durch eine andere Zufallsauswahl (neue Anzahl, neue Artikel).

### Reihenfolge: Laufweg durch den Laden

Die Artikel der Tagesliste kommen nach Warengruppen sortiert, in der Reihenfolge eines Rundgangs durch die Filiale.
Vorgegebene Warengruppen gibt es nicht: Du legst deine eigenen beim Erfassen an (siehe unten). Artikel ohne
Warengruppe kommen zuletzt unter „Ohne Warengruppe“.

Innerhalb jeder Warengruppe ist die Reihenfolge zufällig (gehört zur Tagesliste, bleibt also beim Neuladen gleich).
Die Warengruppe steht über dem Produktnamen; beim Wechsel in die nächste Gruppe kommt ein kurzer Hinweis
(„Weiter mit: Kühlregal“).

- **Laufweg anpassen:** Einstellungen → *Laufweg durch den Laden* → Gruppen mit ↑ ↓ verschieben (z. B. passend zur
  eigenen Filiale). Neu angelegte Gruppen kommen ans Ende. „Standard-Reihenfolge“ sortiert nach Anlegedatum.

Die Warengruppe eines Artikels steht in der Spalte `warengruppe` der Sortimentsliste.

Über **Tagesliste** oben rechts: Übersicht der heutigen Artikel mit Stand (✓ gescannt, ↷ übersprungen, offen) und
Suche nach Name, Marke oder EAN. Antippen springt direkt zu diesem Artikel.

### Scan-Ton anlernen (empfohlen)

Ohne Anlernen reagiert die Seite auf jeden deutlichen Piepton zwischen 1 und 5 kHz. Zuverlässiger wird es so:
**Einstellungen → Scan-Ton anlernen**, dann innerhalb von 8 Sekunden mit dem Scanner einen beliebigen
Barcode (z. B. von einem Produkt) scannen, damit er nah am Gerät piept. Danach reagiert die Seite nur noch auf
genau diese Tonhöhe, ungefähr in dieser Lautstärke. Andere Pieptöne (Kasse, weiter entfernte Scanner) werden ignoriert.

- **Mindestlautstärke:** Der Balken zeigt die aktuelle Lautstärke, die rote Linie die Schwelle. Schaltet es
  durch fremde Geräusche weiter, die Linie nach rechts schieben; reagiert es nicht, nach links.
- **Sperrzeit nach einem Scan** (Standard 0,4 s): verhindert, dass ein Doppelpiep zweimal weiterschaltet.

Solange ein Einstellungs- oder Listenfenster offen ist, wird nicht weitergeschaltet.

### Tipps zum Scannen vom Bildschirm

- Bildschirmhelligkeit auf Maximum, Spiegelungen vermeiden, Scanner leicht schräg halten.
- Flächenbild-Scanner (Imager, z. B. Honeywell Xenon, Voyager 14xx, Mobilcomputer wie CT40/CT60/EDA51) lesen
  Displays problemlos. Reine **Laserscanner können meist nicht vom Bildschirm lesen.**
- Ist der Barcode zu groß oder zu klein für den Leseabstand: **Einstellungen → Barcode-Größe**.
- Der Scanner muss hörbar piepen (Piep-Lautstärke am Scanner nicht auf „aus“).

## EANs mit der Kamera erfassen

Über **Erfassen** oben rechts öffnet sich die Handy-Kamera. Barcode in den Rahmen halten, sonst nichts:

- **Neue EAN:** kommt sofort ins Sortiment, ohne Nachfrage. Die Artikelbezeichnung (Name, Marke, Inhalt) wird im
  Hintergrund bei [Open Food Facts](https://world.openfoodfacts.org) bzw. Open Beauty Facts nachgeschlagen und
  direkt eingetragen. Nicht gefundene Artikel heißen „Selbst gescannter Artikel“. Ein hoher Ton, auf Android
  zusätzlich eine kurze Vibration, und die Meldung „✓ Neu aufgenommen“.
- **EAN schon im Sortiment** (aus der CSV oder schon selbst erfasst): wird nicht nochmal aufgenommen. Ein tiefer Ton
  und die Meldung „Schon im Sortiment“ mit dem Produktnamen.
- Ein Code zählt erst, wenn er zweimal gleich gelesen wurde und die Prüfziffer stimmt. Das schützt vor Fehllesungen.
  Solange derselbe Barcode im Bild bleibt, wird er nur einmal gemeldet.
- Gesucht wird im ganzen sichtbaren Kamerabild (und etwas darüber hinaus), nicht nur in der Mitte; auch hochkant
  gehaltene Strichcodes werden erkannt. Man muss also nicht genau zielen.
- Ein per USB/Bluetooth verbundener Scanner erfasst in diesem Fenster genauso.
- **Warengruppe für neue Scans:** Oben im Fenster wählbar, nur eigene Warengruppen (keine vorgegebenen, keine
  automatische Zuordnung). Mit *＋ Neue Warengruppe …* legst du eine an (z. B. „Kühlregal“ oder „Aktion“). Alles
  danach Gescannte landet ohne Rückfrage in der gewählten Gruppe; ohne Wahl unter „Ohne Warengruppe“. Die Gruppe
  kommt mit der Übernahme in die Spalte `warengruppe` der Sortimentsliste, so kennen sie auch andere Geräte.
- **Netto-Regaletiketten:** Der kleine Strichcode auf den elektronischen Preisschildern (Code 128) wird ebenfalls
  gelesen. Er enthält eine ladeninterne 13-stellige Nummer mit Prüfziffer (z. B. `2707338130000` mit der
  Artikelnummer 733813), die wie eine EAN-13 aufgenommen und angezeigt wird. Open Food Facts kennt solche Nummern
  (Präfix 2) nicht; stattdessen wird **die Bezeichnung vom Schild gelesen** (Texterkennung mit
  [Tesseract](https://github.com/naptha/tesseract.js), `js/etikett-ocr.js`, `js/vendor/tesseract/`): Aus der Lage
  des Strichcodes ergibt sich, wo Name, Marke und Inhalt stehen, nur dieser Ausschnitt wird gelesen. Dafür muss das
  ganze Schild im Bild sein. Die Texterkennung (etwa 6 MB) wird erst beim ersten Regaletikett geladen und läuft
  komplett im Browser.
- **Bezeichnung korrigieren:** Zeile in der Liste antippen, Name (und Marke) eingeben. Das geht auch, wenn der Artikel
  schon ins Sortiment übernommen wurde; die Zeile in `data/netto-sortiment.csv` wird dann beim nächsten Übernehmen
  nachgezogen.

Die Liste im Fenster ist nach Warengruppen in Laufweg-Reihenfolge gegliedert. Selbst erfasste Artikel liegen zunächst
nur auf diesem Gerät (`localStorage`) und lassen sich einzeln (✕) oder alle entfernen.

**Für alle Geräte übernehmen:** In den Einstellungen unter *Sortiment auf GitHub* einmalig einen GitHub-Schlüssel
eintragen (Fine-grained token, nur Repository „Netto“, *Contents: Read and write*). Dann schreibt die Seite selbst
erfasste Artikel direkt in `data/netto-sortiment.csv`, per Knopf *Ins Sortiment übernehmen* und automatisch beim
Schließen des Fensters. Nach 1–2 Minuten sind sie auf allen Geräten da. Der Schlüssel bleibt nur im Browser. **Als CSV speichern** liefert sie im Format
von `data/netto-sortiment.csv`, damit sie ins feste Sortiment übernommen werden können. Steht eine EAN später in der
CSV, wird sie dort geführt und nicht mehr als selbst erfasst.

Die Kamera nutzt die eingebaute Barcode-Erkennung des Browsers (z. B. Chrome auf Android). Wo es die nicht gibt
(Safari auf dem iPhone), wird [ZXing](https://github.com/zxing-js/library) (`js/vendor/zxing.min.js`, Apache-2.0)
nachgeladen. Das Kamerabild wird nur im Browser ausgewertet.

## Sortiment ändern

Die Artikel stehen in [`data/netto-sortiment.csv`](data/netto-sortiment.csv) (Semikolon-getrennt, UTF-8):

```
ean;produktname;marke;inhalt;kategorie;status;quelle;datenstand
4316268687140;Bergkäse Kräuter italienische Art;BioBio;200 g;;…;…;2026-09
```

Pflicht ist nur die Spalte `ean`; `produktname`, `marke` und `inhalt` werden angezeigt, `kategorie` bzw. `warengruppe`
bestimmen die Einsortierung, weitere Spalten werden ignoriert. Zum Aktualisieren die Datei auf GitHub ersetzen (im Ordner `data` → *Add file → Upload files*, gleicher
Dateiname). Ein bis zwei Minuten später wird aus dem neuen Sortiment ausgelost; die heutige Liste bleibt dabei weitgehend
gleich, der Fortschritt bleibt je EAN erhalten.

Die Liste ist anfangs leer und wird über **Erfassen** gefüllt (siehe oben). Die frühere, recherchierte Liste mit
571 Artikeln liegt als Testdaten in `tests/fixtures/sortiment-beispiel.csv`. Angaben ohne Gewähr.

## Veröffentlichung

Die Seite läuft über GitHub Pages (Settings → Pages → *Deploy from a branch*, `main`, `/ (root)`); jede Änderung
an `main` ist nach ein bis zwei Minuten online. Nach Änderungen an CSS oder JavaScript in `index.html` die
Versionsnummer `?v=…` hinter allen Dateien hochsetzen (überall dieselbe), sonst mischt der Browser eventuell neue und
alte Dateien aus seinem Zwischenspeicher. Das Mikrofon funktioniert im Browser nur über **https://**
(oder `localhost`). Lokal am PC: `npm start` und dann <http://localhost:8080> öffnen.

## Datenschutz

Das Mikrofonsignal wird nur im Browser analysiert (Frequenzspektrum), nichts wird aufgenommen, gespeichert
oder verschickt. Das gilt genauso für das Kamerabild beim Erfassen. Fortschritt, Einstellungen und selbst erfasste
EANs liegen im `localStorage` des Browsers.

## Technik

| Datei | Inhalt |
| --- | --- |
| `index.html`, `css/style.css` | Oberfläche |
| `data/netto-sortiment.csv` | Sortiment (EAN, Name, Marke, Inhalt, Kategorie) |
| `js/sortiment.js` | Liest die CSV-Datei |
| `js/warengruppen.js` | Warengruppen, Laufweg und Mischen innerhalb der Gruppen |
| `js/tagesliste.js` | Tagesliste: Auslosung von Anzahl und Artikeln je Tag |
| `js/ean.js` | Prüfziffer, EAN-8/EAN-13-Codierung und SVG-Rendering |
| `js/tone-detector.js` | Mikrofon-Analyse: Pieptöne erkennen, Scan-Ton anlernen |
| `js/keyboard-scanner.js` | Erkennt Scanner, die als Tastatur „tippen“ (USB/Bluetooth) |
| `js/erfassung.js` | Erfassen: gescannte EANs aufnehmen, Dubletten erkennen, CSV-Export |
| `js/camera-scanner.js` | Kamera-Scanner: BarcodeDetector oder ZXing (`js/vendor/zxing.min.js`) |
| `js/produktinfo.js` | Artikelbezeichnung zur EAN bei Open Food Facts / Open Beauty Facts nachschlagen |
| `js/github-sync.js` | Selbst erfasste Artikel über die GitHub-API in die Sortiment-Datei schreiben |
| `js/app.js` | Ablauf, Speicherung, Dialoge |

**Wie die Ton-Erkennung funktioniert:** Die Seite berechnet ca. 65-mal pro Sekunde das Frequenzspektrum des
Mikrofons. Ein Scanner-Piepton ist ein fast reiner Ton, also *eine* schmale, hohe Spitze, die sich deutlich
vom Umgebungsrauschen abhebt. Sprache und Musik bestehen dagegen aus vielen ähnlich starken Obertönen, Klappern ist
breitbandig. Die Spitze muss laut genug sein, in mindestens zwei Messungen hintereinander auf derselben Frequenz
liegen und nach dem Auslösen erst wieder verstummen, bevor der nächste Piep zählt.

Tests: `npm test` (Node.js ≥ 18, keine Abhängigkeiten); prüft u. a., dass alle EANs im Sortiment gültig sind.
