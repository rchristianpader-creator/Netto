# EAN Scan-Liste

Eine Website, die das **Sortiment von Netto Marken-Discount (Deutschland)** Artikel für Artikel groß als Barcode
anzeigt. Man scannt den Barcode mit dem Honeywell-Scanner vom Bildschirm ab. **Sobald der Scanner piept, schaltet die
Seite automatisch zum nächsten Artikel.** Dafür hört die Seite über das Mikrofon auf den Scan-Ton.

**Online:** <https://rchristianpader-creator.github.io/Netto/>

- 245 Netto-Eigenmarken-Lebensmittel (BioBio, Gutes Land, Gut Ponholz, Lieblings, Mondo Italiano, Clarky's, …)
  aus [`data/netto-sortiment.csv`](data/netto-sortiment.csv), alle EANs geprüft
- Reihenfolge wie beim Gang durch den Laden: Warengruppe für Warengruppe, innerhalb jeder Gruppe zufällig gemischt
- Barcodes pixelgenau gerendert (EAN-13 und EAN-8), auch im Dunkelmodus schwarz auf weiß
- Scan-Ton-Erkennung mit Anlern-Funktion und Pegelanzeige, robust gegen Sprache, Musik und Klappern
- Hängt der Scanner per USB/Bluetooth am selben Gerät, geht es auch ohne Mikrofon (Tastatureingabe wird erkannt)
- Fortschritt mit ✓ je gescanntem Artikel, bleibt beim Neuladen erhalten; Bildschirm bleibt beim Scannen an

## So geht's

1. Seite öffnen (Handy/Tablet, Adresse oben). Der erste Artikel wird sofort angezeigt.
2. **Scan-Ton-Erkennung starten** antippen und das Mikrofon erlauben.
3. Barcode mit dem Scanner vom Bildschirm scannen, piep, nächster Artikel, und so weiter.
   Mit ‹ › geht es auch von Hand vor und zurück (übersprungene Artikel werden mit ↷ markiert).

### Reihenfolge: Laufweg durch den Laden

Die Artikel kommen nach Warengruppen sortiert, in der Reihenfolge eines Rundgangs durch die Filiale:

Milch & Milchgetränke → Joghurt → Quark & Desserts → Butter, Sahne & Margarine → Käse → Wurst & Aufschnitt →
Feinkost & Salate → Fleisch & Geflügel → H-Milch & Kondensmilch → Konserven & Fertiggerichte →
Nudeln, Reis & Backzutaten → Saucen, Fonds & Gewürze → Frühstück & Brotaufstrich → Snacks & Nüsse → Getränke → Tiefkühl

Innerhalb jeder Warengruppe ist die Reihenfolge zufällig. Die Warengruppe steht über dem Produktnamen; beim Wechsel
in die nächste Gruppe kommt ein kurzer Hinweis („Weiter mit: Käse“).

- **Laufweg anpassen:** Einstellungen → *Laufweg durch den Laden* → Gruppen mit ↑ ↓ verschieben (z. B. passend zur
  eigenen Filiale). „Standard-Reihenfolge“ stellt den Ausgangszustand wieder her.
- **Neu mischen:** „Von vorne beginnen“ (am Ende) bzw. Einstellungen → *Neu starten (neu gemischt)* setzt den
  Fortschritt zurück und mischt die Artikel innerhalb der Gruppen neu. Beim Neuladen der Seite bleibt die Mischung gleich.

Die Warengruppe wird aus Kategorie, Produktname und Marke bestimmt (z. B. „Feiner Leberkäse“ → Wurst & Aufschnitt,
„Butterkäse“ → Käse). Soll ein Artikel woanders einsortiert werden, in der CSV eine Spalte `warengruppe` mit dem
Gruppennamen ergänzen – sie hat Vorrang.

Über **Sortiment** oben rechts: Übersicht aller Artikel mit Stand (✓ gescannt, ↷ übersprungen, offen) und
Suche nach Name, Marke oder EAN. Antippen springt direkt zu diesem Artikel.

### Scan-Ton anlernen (empfohlen)

Ohne Anlernen reagiert die Seite auf jeden deutlichen Piepton zwischen 1 und 5 kHz. Zuverlässiger wird es so:
**Einstellungen → Scan-Ton anlernen**, dann innerhalb von 8 Sekunden mit dem Scanner einen beliebigen
Barcode (z. B. von einem Produkt) scannen, damit er nah am Gerät piept. Danach reagiert die Seite nur noch auf
genau diese Tonhöhe, ungefähr in dieser Lautstärke. Andere Pieptöne (Kasse, weiter entfernte Scanner) werden ignoriert.

- **Mindestlautstärke:** Der Balken zeigt die aktuelle Lautstärke, die rote Linie die Schwelle. Schaltet es
  durch fremde Geräusche weiter, die Linie nach rechts schieben; reagiert es nicht, nach links.
- **Sperrzeit nach einem Scan** (Standard 0,4 s): verhindert, dass ein Doppelpiep zweimal weiterschaltet.

Solange ein Einstellungs- oder Sortimentsfenster offen ist, wird nicht weitergeschaltet.

### Tipps zum Scannen vom Bildschirm

- Bildschirmhelligkeit auf Maximum, Spiegelungen vermeiden, Scanner leicht schräg halten.
- Flächenbild-Scanner (Imager, z. B. Honeywell Xenon, Voyager 14xx, Mobilcomputer wie CT40/CT60/EDA51) lesen
  Displays problemlos. Reine **Laserscanner können meist nicht vom Bildschirm lesen.**
- Ist der Barcode zu groß oder zu klein für den Leseabstand: **Einstellungen → Barcode-Größe**.
- Der Scanner muss hörbar piepen (Piep-Lautstärke am Scanner nicht auf „aus“).

## Sortiment ändern

Die Artikel stehen in [`data/netto-sortiment.csv`](data/netto-sortiment.csv) (Semikolon-getrennt, UTF-8):

```
ean;produktname;marke;inhalt;kategorie;status;quelle;datenstand
4316268687140;Bergkäse Kräuter italienische Art;BioBio;200 g;;…;…;2026-09
```

Pflicht ist nur die Spalte `ean`; `produktname`, `marke` und `inhalt` werden angezeigt, `kategorie` bzw. `warengruppe`
bestimmen die Einsortierung, weitere Spalten werden ignoriert. Zum Aktualisieren die Datei auf GitHub ersetzen (im Ordner `data` → *Add file → Upload files*, gleicher
Dateiname). Ein bis zwei Minuten später zeigt die Seite die neue Liste; der Fortschritt bleibt je EAN erhalten.

Datenstand der mitgelieferten Liste: 24.09.2026, eigene Recherche (Open Food Facts, identitaetskennzeichen.de,
Netto-Produktseiten). Angaben ohne Gewähr.

## Veröffentlichung

Die Seite läuft über GitHub Pages (Settings → Pages → *Deploy from a branch*, `main`, `/ (root)`); jede Änderung
an `main` ist nach ein bis zwei Minuten online. Das Mikrofon funktioniert im Browser nur über **https://**
(oder `localhost`). Lokal am PC: `npm start` und dann <http://localhost:8080> öffnen.

## Datenschutz

Das Mikrofonsignal wird nur im Browser analysiert (Frequenzspektrum), nichts wird aufgenommen, gespeichert
oder verschickt. Fortschritt und Einstellungen liegen im `localStorage` des Browsers.

## Technik

| Datei | Inhalt |
| --- | --- |
| `index.html`, `css/style.css` | Oberfläche |
| `data/netto-sortiment.csv` | Sortiment (EAN, Name, Marke, Inhalt, Kategorie) |
| `js/sortiment.js` | Liest die CSV-Datei |
| `js/warengruppen.js` | Warengruppen, Laufweg und Mischen innerhalb der Gruppen |
| `js/ean.js` | Prüfziffer, EAN-8/EAN-13-Codierung und SVG-Rendering |
| `js/tone-detector.js` | Mikrofon-Analyse: Pieptöne erkennen, Scan-Ton anlernen |
| `js/keyboard-scanner.js` | Erkennt Scanner, die als Tastatur „tippen“ (USB/Bluetooth) |
| `js/app.js` | Ablauf, Speicherung, Dialoge |

**Wie die Ton-Erkennung funktioniert:** Die Seite berechnet ca. 65-mal pro Sekunde das Frequenzspektrum des
Mikrofons. Ein Scanner-Piepton ist ein fast reiner Ton, also *eine* schmale, hohe Spitze, die sich deutlich
vom Umgebungsrauschen abhebt. Sprache und Musik bestehen dagegen aus vielen ähnlich starken Obertönen, Klappern ist
breitbandig. Die Spitze muss laut genug sein, in mindestens zwei Messungen hintereinander auf derselben Frequenz
liegen und nach dem Auslösen erst wieder verstummen, bevor der nächste Piep zählt.

Tests: `npm test` (Node.js ≥ 18, keine Abhängigkeiten); prüft u. a., dass alle EANs im Sortiment gültig sind.
