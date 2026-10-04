# heizlast-ha

Home-Assistant-Integration mit einer interaktiven Grundrisskarte. Version **0.2.0**
setzt den Prototyp aus [Issue #1](https://github.com/dr-dimitri/heizlast-ha/issues/1)
um: PNG-/JPEG-Grundrisse, JSON-Raumflächen, Korrekturmodus, mehrere Etagen,
zugeordnete Temperatursensoren und ein kopierbarer Prompt für ein externes LLM.

Die Integration speichert Bilder, Grundrisse und Sensorzuordnungen in Home
Assistant. Temperaturwerte kommen direkt von den vorhandenen Sensoren. Eine
Heizlastberechnung und Heizungssteuerung folgen in späteren Projektphasen.

## Installation in Home Assistant

Getestet mit Home Assistant **2026.9.4**. Die Installation dieser Custom
Integration erfolgt zunächst manuell; HACS-Veröffentlichung ist noch nicht
Teil des Prototyps.

1. Das ZIP-Artefakt eines erfolgreichen GitHub-Actions-Laufs herunterladen und
   entpacken. Falls der Download eine weitere ZIP-Datei enthält, auch diese
   entpacken.
2. `custom_components/heizlast_ha/` nach
   `/config/custom_components/heizlast_ha/` kopieren.
3. `www/heizlast-ha/` nach `/config/www/heizlast-ha/` kopieren.
4. Home Assistant neu starten. Unter **Einstellungen → Geräte & Dienste →
   Integration hinzufügen** nach **Heizlast HA** suchen und hinzufügen.
5. Im Dashboard unter **Ressourcen** die URL
   `/local/heizlast-ha/heizlast-ha-card.js?v=0.2.0` als **JavaScript-Modul**
   eintragen. Für die Ressourcenverwaltung gegebenenfalls den erweiterten Modus
   im Benutzerprofil aktivieren. Bei späteren Updates die Versionsangabe in der
   Ressourcen-URL ändern und das Dashboard neu laden.
6. Eine Karte mit folgender Konfiguration hinzufügen:

   ```yaml
   type: custom:heizlast-ha-card
   ```

Das Archiv enthält zusätzlich Quellcode, Tests und Beispiele. Diese werden für
die Installation nicht in das Home-Assistant-Konfigurationsverzeichnis kopiert.

## Vom Grundriss zur Temperaturanzeige

1. Als Administrator ein PNG oder JPEG über die Karte hochladen und Etagen-ID
   sowie Etagenname festlegen. Die Karte ermittelt die Bildgröße. Dateien dürfen
   höchstens **2 MiB**, **8192 Pixel je Dimension** und **24 Millionen Pixel**
   insgesamt enthalten. PDF-Seiten vorher unverändert als Bild exportieren.
2. **LLM-Prompt anzeigen** öffnen und **Prompt kopieren** verwenden. Ist die
   Zwischenablage nicht verfügbar, den Text im Dialog manuell kopieren. Prompt
   und das Bild über **Grundriss herunterladen** aus dem Dialog
   gemeinsam an das gewünschte LLM übergeben. Der Upload normalisiert die
   EXIF-Ausrichtung von Fotos; der Download entspricht daher genau den im Prompt
   angegebenen Bildkoordinaten.
   Die Integration selbst sendet keine LLM-Anfragen.
3. Die Antwort als JSON-Datei laden oder in das Importfeld einfügen. Der Import
   prüft das Schema, Bildreferenzen, Bildgrößen, eindeutige IDs und Raumgeometrie.
   Ungültige Daten überschreiben die bisherige Konfiguration nicht.
4. Die Vorschau über dem Originalplan prüfen und ausdrücklich übernehmen.
   Jede enthaltene Etage bleibt erhalten und ist auswählbar. Für mehrere Etagen
   vorher alle zugehörigen Bilder hochladen und die einzelnen Etagenobjekte
   gemeinsam in `floors` aufnehmen.
5. Einen Raum anklicken. Im Korrekturmodus können Raumnamen und Eckpunkte
   geändert, Punkte hinzugefügt oder entfernt werden. Änderungen speichern;
   eine visuell unpassende, aber formal gültige LLM-Antwort lässt sich so
   korrigieren.
6. Dem Raum einen oder mehrere Home-Assistant-Temperatursensoren zuordnen. Jeder
   Sensor wird mit seinem aktuellen Wert und seiner Einheit angezeigt. Es
   erfolgt keine ungeprüfte Mittelung unterschiedlicher Einheiten. Nicht
   verfügbare und entfernte Sensoren werden entsprechend gekennzeichnet.

**Beispiel laden** stellt einen handgeprüften Grundriss mit Wohnzimmer, Küche,
Flur und Bad als Importvorschau bereit. Die Beispieldateien liegen in
[`examples/`](examples/README.md); die Schaltfläche setzt die Bildreferenz passend
zum Upload ein. Beim manuellen Beispielimport `background` durch die nach dem
Upload angezeigte Bildreferenz ersetzen.

Sensorzuordnungen werden anhand stabiler Raum-IDs getrennt vom Grundriss
gespeichert. Ein Reimport mit gleichen IDs erhält sie. Entfernte Räume werden
vor der Übernahme zur Bestätigung angezeigt. Wenn ein anderer Browser die
Konfiguration inzwischen gespeichert hat, wird ein Versionskonflikt angezeigt;
zuerst neu laden und die Änderungen erneut prüfen. Normale Benutzer können die
gespeicherten Räume und Temperaturen ansehen; Konfigurationsänderungen erfordern
Administratorrechte.

## Datenformat und Speicherung

[`schemas/floorplan-v1.schema.json`](schemas/floorplan-v1.schema.json) ist der
verbindliche Vertrag. Dashboard-Import und LLM-Prompt verwenden dieselbe
Formatdefinition; eine bytegleiche Kopie liegt im Integrationspaket. Das Format
erlaubt bis zu 32 Etagen, 500 Räume pro Etage und 500 Eckpunkte pro Raum.

Koordinaten beziehen sich auf das gespeicherte, ausgerichtete Bild: Ursprung links
oben, x nach rechts und y nach unten. Raumflächen sind implizit geschlossene
Polygone; den ersten Punkt nicht am Ende wiederholen. Selbstüberschneidungen,
Nullflächen, Koordinaten außerhalb des Bildes und flächige Überschneidungen
verschiedener Räume werden abgelehnt. Bildkoordinaten ergeben keinen metrischen
Maßstab: `area_m2` bleibt ohne bestätigte Flächenangabe `null`.

Der Projektzustand wird über Home Assistants Storage-Helfer gespeichert,
Bilddateien liegen ebenfalls im Konfigurationsverzeichnis unter `.storage`.
Sie werden über einen authentifizierten Bildendpunkt mit signierten URLs
angezeigt. Das Konfigurationsverzeichnis einschließlich `.storage` sichern;
keine Browserdaten als Ersatz für die Home-Assistant-Konfiguration betrachten.

## Entwicklung und CI

Python **3.14.2 oder neuer innerhalb 3.14** und Node.js **24** verwenden. Die
Qualitätsprüfungen und der lokale Build lassen sich wie folgt ausführen:

```sh
python -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements-ci.txt
python -m ruff check .
python -m ruff format --check .
python -m pytest
cd frontend
npm ci
npm run lint
npm test -- --run
npm run build
cd ..
python scripts/build.py
```

Der Build erzeugt ein versioniertes Projektarchiv in `dist/`. Er nimmt nur mit
Git verwaltete Dateien auf; neue Dateien vor dem lokalen Build mit `git add`
vormerken. Kompilierte Dashboarddateien werden unter `www/heizlast-ha/`
mitgeliefert. Integrationsmanifest, Frontend und `VERSION` müssen die gleiche
Projektversion nennen.

Mit `npm run dev` im Ordner `frontend/` lässt sich die Karte gegen einen lokalen
Entwicklungsadapter ansehen. Dieser stellt Beispielsensoren und einen
simulierten Speicher bereit; die ausgelieferte Karte nutzt die echte
Home-Assistant-Verbindung und dessen persistenten Speicher.

Die GitHub-CI prüft Pull Requests nach `main` sowie Änderungen auf `main` und
kann manuell gestartet werden. Ihre verbindliche Beschreibung, die geplanten
Integrations-/Frontendpfade und die Pflicht zur synchronen Dokumentation stehen
in [AGENTS.md](AGENTS.md). Build-Archive stehen im jeweiligen Actions-Lauf für
14 Tage zum Download bereit.
