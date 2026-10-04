# heizlast-ha

Home-Assistant-Integration mit einer interaktiven Grundrisskarte. Version **0.5.0**
stellt das Dashboard **Heizlast HA** automatisch in der HA-Seitenleiste bereit.
Der Prototyp aus [Issue #1](https://github.com/dr-dimitri/heizlast-ha/issues/1)
enthält PNG-/JPEG-Grundrisse, JSON-Raumflächen, Korrekturmodus, mehrere Etagen,
zugeordnete Temperatursensoren und einen kopierbaren Prompt für ein externes LLM.

Die Integration speichert Bilder, Grundrisse und Sensorzuordnungen in Home
Assistant. Temperaturwerte kommen direkt von den vorhandenen Sensoren. Eine
Heizlastberechnung und Heizungssteuerung folgen in späteren Projektphasen.

## Installation über HACS

Voraussetzung: Home Assistant **2026.9.4 oder neuer** und eingerichtetes HACS.
Heizlast HA wird als **benutzerdefiniertes Repository** installiert:

1. In HACS das Menü **⋮ → Benutzerdefinierte Repositories** öffnen.
2. `https://github.com/dr-dimitri/heizlast-ha` hinzufügen und den Typ
   **Integration** auswählen.
3. **Heizlast HA** suchen und die neueste veröffentlichte Version herunterladen.
4. Home Assistant neu starten. Unter **Einstellungen → Geräte & Dienste →
   Integration hinzufügen** nach **Heizlast HA** suchen und hinzufügen.
5. Die Browserseite neu laden und links **Heizlast HA** öffnen. Das Dashboard
   zeigt direkt die Grundrisseinrichtung zum Hochladen eines Plans, Erstellen
   des LLM-Prompts und Zuordnen von Temperatursensoren. Es ist auch über den
   Öffnen-Link der Integration unter **Geräte & Dienste** erreichbar.

Das eigene Dashboard wird als Home-Assistant-Panel bereitgestellt und benötigt
keine manuelle Dashboard- oder Kartenkonfiguration. Es funktioniert auch bei
YAML-Dashboards. Beim Deaktivieren oder Entfernen der Integration wird der
Seitenleisteneintrag entfernt; gespeicherte Projektdaten bleiben erhalten.
Bestehende Dashboards bleiben unverändert. Ist `/heizlast-ha` bereits belegt,
verwendet die Integration den nächsten freien Pfad, etwa `/heizlast-ha-2`.

Die Karte kann zusätzlich in ein eigenes Dashboard eingebunden werden:

```yaml
type: custom:heizlast-ha-card
```

Dashboard und Karte sind im HACS-Paket enthalten und werden von der Integration
selbst geladen. Eine zusätzliche HACS-Dashboard-Installation und ein manuell
angelegter Ressourceneintrag sind nicht erforderlich. Dies funktioniert mit
über die Oberfläche verwalteten Dashboards und YAML-Dashboards.

Updates ebenfalls über HACS herunterladen, anschließend Home Assistant neu
starten und die Browserseite neu laden. Grundrisse, Bilder und Sensorzuordnungen
liegen weiterhin in `.storage` und bleiben beim Update erhalten.
Auch bei bereits eingerichteten Integrationen erscheint das eigene Dashboard
nach dem Update automatisch in der Seitenleiste. Normale Benutzer können die
gespeicherten Pläne ansehen; zum Einrichten sind Administratorrechte nötig.

### Reparaturmeldung nach Dashboard-Updates

Wenn sich die mitgelieferte Dashboard-Karte geändert hat, erscheint nach dem
Neustart unter **Einstellungen → System → Reparaturen** eine Heizlast-HA-Meldung
mit der neuen Version. Die Reparatur öffnen, alle geöffneten Dashboards im
Browser neu laden (**F5** oder die Schaltfläche zum Neuladen) und anschließend
die Reparatur bestätigen. In der Companion-App das Dashboard schließen und
erneut öffnen; bei einer weiterhin alten Karte den Frontend-Cache in den
App-Einstellungen zurücksetzen.

Die Meldung bleibt bis zur Bestätigung ausstehend und wird nach einem Neustart
erneut angezeigt. Die Bestätigung gilt für die konkrete Dashboard-Datei; bei
der nächsten Änderung erscheint eine neue Meldung. Eine Erstinstallation sowie
Updates mit unveränderter Karte erzeugen keine Reparatur. Beim ersten Wechsel
von einer älteren Version ohne diese Erkennung erscheint einmalig die Meldung.
Grundrisse, Bilder und Sensorzuordnungen bleiben unverändert.

Bei einem Wechsel von Version 0.2.0 zuerst den bisherigen Ressourceneintrag
`/local/heizlast-ha/heizlast-ha-card.js?...` aus den Dashboard-Ressourcen bzw.
der YAML-Konfiguration entfernen, damit keine alte Karte zusätzlich geladen
wird. Die bereits eingerichtete Integration und ihre gespeicherten Daten
bleiben erhalten.

Die offiziellen Schritte für benutzerdefinierte Repositories stehen in der
[HACS-Anleitung](https://www.hacs.xyz/docs/faq/custom_repositories/).

### Manuelle Installation

Das Asset **heizlast_ha.zip** aus einem
[GitHub-Release](https://github.com/dr-dimitri/heizlast-ha/releases) herunterladen
und seinen Inhalt nach `/config/custom_components/heizlast_ha/` entpacken.
`manifest.json` und `__init__.py` müssen direkt in diesem Ordner liegen,
die Dashboard-Datei unter `www/heizlast-ha-card.js` innerhalb desselben Ordners.
Danach mit Schritt 4 und 5 der HACS-Anleitung oben fortfahren.

Das größere Projektarchiv aus der CI enthält zusätzlich Quellcode, Tests und
Beispiele; daraus nur den Inhalt von `custom_components/heizlast_ha/` nach
`/config/custom_components/heizlast_ha/` kopieren.

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
vormerken. Kompilierte Dashboarddateien werden auch unter
`custom_components/heizlast_ha/www/` mitgeliefert. Der lokale Build erzeugt dort
die ignorierten Dateien für eine vollständige Installation aus dem Checkout.
Zusätzlich entsteht `dist/heizlast_ha.zip`, das nur die Integration samt Karte
enthält und von HACS direkt in den Integrationsordner entpackt wird.
Integrationsmanifest, Frontend und `VERSION` müssen die gleiche Projektversion
nennen.

Mit `npm run dev` im Ordner `frontend/` lässt sich die Karte gegen einen lokalen
Entwicklungsadapter ansehen. Dieser stellt Beispielsensoren und einen
simulierten Speicher bereit; die ausgelieferte Karte nutzt die echte
Home-Assistant-Verbindung und dessen persistenten Speicher.

Die GitHub-CI prüft Pull Requests nach `main` sowie Änderungen auf `main` und
kann manuell gestartet werden. Ihre verbindliche Beschreibung, die geplanten
Integrations-/Frontendpfade und die Pflicht zur synchronen Dokumentation stehen
in [AGENTS.md](AGENTS.md). Build-Archive stehen im jeweiligen Actions-Lauf für
14 Tage zum Download bereit. HACS installiert das dauerhafte Asset eines
GitHub-Releases, nicht das temporäre Actions-Artefakt.

## HACS-Release veröffentlichen

Nach Review, Versionsanhebung und Merge muss die CI auf `main` erfolgreich sein.
Danach unter **Actions → HACS release → Run workflow** den Branch **main**
auswählen. Der Release-Workflow lädt das CI-Artefakt desselben Commits, prüft
Version, Quellcommit und vollständigen Paketinhalt und veröffentlicht
`v<VERSION>` mit dem Asset `heizlast_ha.zip`. Bereits vorhandene Releases werden
nicht überschrieben; für Änderungen eine neue Projektversion verwenden.

`hacs.json` blendet die nicht gebauten Branchdateien bei der Installation aus.
Alle Laufzeitdateien einschließlich Karte und Icon liegen im Integrationspaket.
Die CI verwendet zusätzlich die offizielle HACS-Validierungsaktion.
