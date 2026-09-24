# EAN Scan-Liste

Eine Website, die EAN-Codes (z. B. von Netto-Marken-Discount-Artikeln) nacheinander groß als Barcode anzeigt.
Man scannt den Barcode mit dem Honeywell-Scanner vom Bildschirm ab. **Sobald der Scanner piept, schaltet die
Seite automatisch zum nächsten Code.** Dafür hört die Seite über das Mikrofon auf den Scan-Ton.

- Läuft komplett im Browser (Handy, Tablet oder PC), keine Installation, keine Bibliotheken von außen
- Barcodes pixelgenau gerendert (EAN-13, EAN-8, UPC-A), auch im Dunkelmodus schwarz auf weiß
- Scan-Ton-Erkennung mit Anlern-Funktion und Pegelanzeige, robust gegen Sprache, Musik und Klappern
- Hängt der Scanner per USB/Bluetooth am selben Gerät, geht es auch ohne Mikrofon (Tastatureingabe wird erkannt)
- Liste einfügen (z. B. aus Excel), als CSV/TXT importieren oder Netto-Produkte aus Open Food Facts laden
- Fortschritt mit ✓ je gescanntem Code, bleibt beim Neuladen erhalten; Bildschirm bleibt beim Scannen an

## Öffnen

Das Mikrofon funktioniert im Browser nur über **https://** (oder `localhost`). Am einfachsten über GitHub Pages:

1. Im Repository auf GitHub **Settings → Pages** öffnen.
2. Unter *Build and deployment* bei *Source* **Deploy from a branch** wählen, dann den Branch
   (z. B. `main`) und den Ordner **/ (root)** auswählen und speichern.
3. Nach ein bis zwei Minuten ist die Seite unter `https://rchristianpader-creator.github.io/Netto/` erreichbar.
   Die Adresse auf dem Handy öffnen und ggf. „Zum Startbildschirm hinzufügen“.

Die Seite selbst ist dann öffentlich, die EAN-Listen aber nicht: Sie werden nur lokal im Browser des jeweiligen Geräts gespeichert.

Lokal am PC: `npm start` und dann <http://localhost:8080> öffnen.

## So geht's

1. **Liste** öffnen und EAN-Codes einfügen – ein Code pro Zeile, optional mit Artikelname:
   ```
   4006381333931;Textmarker gelb
   96385074	Kleiner Artikel        ← direkt aus Excel kopiert (Tab-getrennt)
   Milch 1,5% 1L;4012345678901      ← Name vor dem Code geht auch
   ```
   Zeilen mit `#` werden ignoriert. Fehlende Prüfziffern werden ergänzt, falsche werden rot markiert
   (solche Codes liest kein Scanner). Alternativ: CSV/TXT-Datei importieren oder
   **Netto-Produkte laden** (siehe unten).
2. **Scan-Ton-Erkennung starten** antippen und das Mikrofon erlauben.
3. Barcode mit dem Scanner vom Bildschirm scannen, piep, nächster Code, und so weiter.
   Mit ‹ › (oder den Pfeiltasten) geht es auch von Hand vor und zurück.

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

### Netto-Produkte aus Open Food Facts

In der Liste unter *Netto-Produkte aus Open Food Facts laden* holt die Seite EAN-Codes von Produkten, die in der
freien Produktdatenbank [Open Food Facts](https://world.openfoodfacts.org/store/netto-marken-discount) dem Händler
„Netto Marken-Discount“ zugeordnet sind (nach Beliebtheit sortiert, 25–200 Stück). Das sind Community-Daten ohne
Gewähr auf Vollständigkeit oder Aktualität; es gilt die Open Database License (ODbL). Dafür wird eine Internetverbindung benötigt.

## Datenschutz

Das Mikrofonsignal wird nur im Browser analysiert (Frequenzspektrum), nichts wird aufgenommen, gespeichert
oder verschickt. Liste, Fortschritt und Einstellungen liegen im `localStorage` des Browsers. Nur der optionale
Open-Food-Facts-Import stellt eine Anfrage ins Internet.

## Technik

| Datei | Inhalt |
| --- | --- |
| `index.html`, `css/style.css` | Oberfläche |
| `js/ean.js` | Prüfziffer, Listen-Parser, EAN-8/EAN-13-Codierung und SVG-Rendering |
| `js/tone-detector.js` | Mikrofon-Analyse: Pieptöne erkennen, Scan-Ton anlernen |
| `js/keyboard-scanner.js` | Erkennt Scanner, die als Tastatur „tippen“ (USB/Bluetooth) |
| `js/off-import.js` | Import aus Open Food Facts |
| `js/app.js` | Ablauf, Speicherung, Dialoge |

**Wie die Ton-Erkennung funktioniert:** Die Seite berechnet ca. 65-mal pro Sekunde das Frequenzspektrum des
Mikrofons. Ein Scanner-Piepton ist ein fast reiner Ton, also *eine* schmale, hohe Spitze, die sich deutlich
vom Umgebungsrauschen abhebt. Sprache und Musik bestehen dagegen aus vielen ähnlich starken Obertönen, Klappern ist
breitbandig. Die Spitze muss laut genug sein, in mindestens zwei Messungen hintereinander auf derselben Frequenz
liegen und nach dem Auslösen erst wieder verstummen, bevor der nächste Piep zählt.

Tests: `npm test` (Node.js ≥ 18, keine Abhängigkeiten).
