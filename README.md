# heizlast-ha

Home-Assistant-Integration mit einer interaktiven digitalen Grundrisskarte.
Version **0.6.0** erzeugt einen kopierbaren Prompt für ein externes LLM ohne
Bild-Upload. Der importierte digitale Grundriss enthält Raumkonturen, Namen und
Zeichenfläche vollständig; der ursprüngliche Plan wird danach nicht benötigt.
Das Dashboard **Heizlast HA** steht automatisch in der HA-Seitenleiste bereit.
Mehrere Etagen, Korrekturmodus und zugeordnete Temperatursensoren sind enthalten.

Die Integration speichert Grundriss-JSON und Sensorzuordnungen in Home Assistant.
Temperaturwerte kommen direkt von den vorhandenen Sensoren. Eine
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
   zeigt direkt die Einrichtung zum Erstellen des LLM-Prompts, Importieren
   der JSON-Antwort und Zuordnen von Temperatursensoren. Es ist auch über den
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
starten und die Browserseite neu laden. Grundrisse und Sensorzuordnungen
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
Grundrisse und Sensorzuordnungen bleiben unverändert.

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

1. Als Administrator Etagen-ID und Etagenname festlegen und **LLM-Prompt
   anzeigen** öffnen. Ein Bild-Upload in die Integration ist nicht erforderlich.
2. **Prompt kopieren** verwenden. Ist die Zwischenablage nicht verfügbar, den
   Text im Dialog manuell kopieren. Prompt und ursprünglichen Grundriss direkt
   an das gewünschte LLM übergeben, etwa als Bild, Screenshot oder PDF.
   Die Integration selbst sendet keine LLM-Anfragen.
3. Die Antwort als JSON-Datei laden oder in das Importfeld einfügen. Das LLM
   liefert eine eigenständige Zeichenfläche und die Raumkonturen in deren
   Koordinaten. Der Import prüft Schema, eindeutige IDs, Koordinatengrenzen und
   Raumgeometrie. Ungültige Daten überschreiben die bisherige Konfiguration nicht.
4. Raumkonturen, Namen und Anordnung in der Vorschau prüfen und ausdrücklich
   übernehmen. Jede enthaltene Etage bleibt erhalten und ist auswählbar.
   Für mehrere Etagen die jeweiligen Etagenobjekte gemeinsam in `floors`
   aufnehmen und über alle Etagen eindeutige IDs verwenden.
5. Einen Raum anklicken. Im Korrekturmodus können Raumnamen und Eckpunkte
   geändert, Punkte hinzugefügt oder entfernt werden. Änderungen speichern.
   Anzeige und Korrekturen benötigen ausschließlich die importierten Daten.
6. Dem Raum einen oder mehrere Home-Assistant-Temperatursensoren zuordnen. Jeder
   Sensor wird mit seinem aktuellen Wert und seiner Einheit angezeigt. Es
   erfolgt keine ungeprüfte Mittelung unterschiedlicher Einheiten. Nicht
   verfügbare und entfernte Sensoren werden entsprechend gekennzeichnet.

**Beispiel laden** stellt einen handgeprüften digitalen Grundriss mit Wohnzimmer,
Küche, Flur und Bad als Importvorschau bereit. Das Beispiel funktioniert ohne
Bild und ist auch direkt aus [`examples/ground-floor.json`](examples/ground-floor.json)
importierbar.

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
Formatdefinition; eine bytegleiche Kopie liegt im Integrationspaket. Version
`1.1` enthält keine Bildreferenzen; das frühere bildbasierte Format `1.0` wird
nicht mehr verwendet und ist nicht importierbar. Das Format
erlaubt bis zu 32 Etagen, 500 Räume pro Etage und 500 Eckpunkte pro Raum.

Koordinaten beziehen sich auf die im JSON definierte Zeichenfläche: Ursprung
links oben, x nach rechts und y nach unten. Der Prompt lässt das LLM die längere
Seite auf 1000 Einheiten setzen und das Seitenverhältnis des Plans erhalten.
Raumflächen sind implizit geschlossene Polygone; den ersten Punkt nicht am Ende
wiederholen. Selbstüberschneidungen, Nullflächen, Koordinaten außerhalb der
Zeichenfläche und flächige Überschneidungen verschiedener Räume werden abgelehnt.
Die Koordinaten ergeben keinen metrischen Maßstab: `area_m2` bleibt ohne
bestätigte Flächenangabe `null`.

Der Projektzustand wird über Home Assistants Storage-Helfer im
Konfigurationsverzeichnis unter `.storage` gespeichert. Es werden keine
Grundrissbilder gespeichert oder nachgeladen. Das Konfigurationsverzeichnis
einschließlich `.storage` sichern; keine Browserdaten als Ersatz für die
Home-Assistant-Konfiguration betrachten.

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
