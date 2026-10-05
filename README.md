# heizlast-ha

Home-Assistant-Integration mit einer interaktiven digitalen Grundrisskarte.
Version **0.10.0** öffnet den fest implementierten Grundriss direkt in der
HA-Seitenleiste. Erdgeschoss und Obergeschoss zeigen die aus den Werkplänen
übernommenen Raumkonturen und die belegten Normheizlasten von elf Rechenzonen.
Räume lassen sich anklicken; rechts stehen Fläche, Auslegungstemperatur,
Wärmeverluste, Quellenbelege und vorhandene Temperatursensoren.
Spitzboden und Nebengebäude gehören nicht zur Darstellung.

Die Integration speichert die Sensorzuordnungen in Home Assistant.
Temperaturwerte kommen direkt von den vorhandenen Sensoren. Dokumentierte
Normheizlasten sind Planungsdaten, keine aktuellen Messwerte. Ohne Sensorzuordnung
werden keine Raumtemperaturen vorgetäuscht. Eine Berechnung des aktuellen
Wärmebedarfs und eine Heizungssteuerung sind nicht enthalten.

Die Integration stellt ausschließlich diesen EG-/OG-Grundriss bereit.
Raumkonturen und Rechenzonen sind fest hinterlegt. Das Hinzufügen, Importieren
oder Bearbeiten eigener Grundrisse ist nicht vorgesehen.

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
   zeigt direkt den festen Grundriss mit Geschossauswahl. Es ist auch über den
   Öffnen-Link der Integration unter **Geräte & Dienste** erreichbar.

Das eigene Dashboard wird als Home-Assistant-Panel bereitgestellt und benötigt
keine manuelle Dashboard- oder Kartenkonfiguration. Es funktioniert auch bei
YAML-Dashboards. Beim Deaktivieren oder Entfernen der Integration wird der
Seitenleisteneintrag entfernt; gespeicherte Projektdaten bleiben erhalten.
Bestehende Dashboards bleiben unverändert. Ist `/heizlast-ha` bereits belegt,
verwendet die Integration den nächsten freien Pfad, etwa `/heizlast-ha-2`.

Die Karte kann zusätzlich in ein eigenes Dashboard eingebunden werden:

```yaml
type: custom:heizlast-grundriss-card
```

Dashboard und Karte sind im HACS-Paket enthalten und werden von der Integration
selbst geladen. Eine zusätzliche HACS-Dashboard-Installation und ein manuell
angelegter Ressourceneintrag sind nicht erforderlich. Dies funktioniert mit
über die Oberfläche verwalteten Dashboards und YAML-Dashboards.
Die frühere Kartenkennung `custom:heizlast-ha-card` zeigt als kompatibler Alias
ebenfalls diesen festen Grundriss.

Updates ebenfalls über HACS herunterladen, anschließend Home Assistant neu
starten und die Browserseite neu laden. Sensorzuordnungen liegen in `.storage`
und bleiben beim Update erhalten. Früher gespeicherte Benutzerpläne bleiben
als ungenutzte Altdaten gespeichert; sie werden weder angezeigt noch verändert.
Auch bei bereits eingerichteten Integrationen erscheint das eigene Dashboard
nach dem Update automatisch in der Seitenleiste. Normale Benutzer können den
festen Grundriss und Sensorwerte ansehen; zum Zuordnen sind Administratorrechte nötig.

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
Sensorzuordnungen und ungenutzte Altdaten bleiben unverändert.

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

Das größere Projektarchiv aus der CI enthält zusätzlich Quellcode und Tests;
daraus nur den Inhalt von `custom_components/heizlast_ha/` nach
`/config/custom_components/heizlast_ha/` kopieren.

## Normheizlasten und Sensoren im Grundriss

**Erdgeschoss** und **Obergeschoss** wechseln die Ansicht. Die Raumkonturen
und die beschrifteten Schaltflächen wählen eine Rechenzone aus. Die Konturen
sind vereinfacht nachgezeichnet; ihre Zeichenkoordinaten sind kein Aufmaß.
Flächen stammen ausschließlich aus den Dokumentangaben.

- Wohnen/Essen/Küche bilden einen offenen Bereich mit einer gemeinsamen
  Heizlast. Gard./Diele bilden ebenfalls eine Rechenzone. Schlafen und Ankleide
  besitzen getrennte Konturen und einen gemeinsamen Heizlastwert.
- Das Bad ist mit **?** gekennzeichnet: Im OG-Plan ist der Sanitärraum
  unbeschriftet. Seine Zuordnung zur berechneten Zone 7 bleibt zu bestätigen;
  12,74 m² und 641,59 W sind belegte Berechnungswerte, keine aus der Kontur
  abgeleiteten Zahlen.
- Die Gebäude-Normheizlast beträgt **5.989 W**, die Raumheizlastsumme
  **7.354,5 W**. Die Berechnung berücksichtigt Lüftungsverluste auf Gebäudeebene
  nur hälftig. Beide Werte werden entsprechend getrennt beschriftet.
- Auslegungstemperaturen von 22 °C beziehungsweise 24 °C sind
  Berechnungsannahmen. Aktuelle Raumtemperaturen stammen ausschließlich aus
  tatsächlich zugeordneten Home-Assistant-Temperatursensoren.

Administratoren können in der Raumauswahl vorhandene Temperatursensoren
zuordnen und die Auswahl ausdrücklich speichern. Die Zuordnung gilt für die
gesamte Rechenzone; mehrere Sensorwerte erscheinen einzeln. Entfernte oder
nicht verfügbare Sensoren bleiben erkennbar. Normale Benutzer können die
gespeicherten Zuordnungen und Werte ansehen. Die Zuordnungen werden zentral in
Home Assistant gespeichert und nutzen eine gemeinsame Projekt-Revision, um
gleichzeitige Änderungen nicht zu überschreiben.

Der mitgelieferte Datensatz
[`planning-data.json`](custom_components/heizlast_ha/planning-data.json)
enthält ausschließlich benötigte fachliche Daten und neutrale Quellenbelege
wie **Plan EG**, **Plan OG** und **Heizlastberechnung** mit Blatt-/Seitennummern.
Namen, Ort, Postleitzahl, persönliche Originaldateinamen, Benutzerpfade und
Original-PDFs werden nicht ausgeliefert.

## Daten und Speicherung

Der feste Grundriss liegt mit seinen belegten Heizlasten und neutralen
Quellenbelegen in `custom_components/heizlast_ha/planning-data.json`.
Die Integration liefert keinen Zeicheneditor, JSON-Import, LLM-Prompt oder
Speicherendpunkt für eigene Raumgeometrie aus. Über die authentifizierte API
können ausschließlich Sensorzuordnungen der elf festen Rechenzonen verändert
werden. Normale Benutzer erhalten nur Lesezugriff.

Die Sensorzuordnungen werden über Home Assistants Storage-Helfer im
Konfigurationsverzeichnis unter `.storage` gespeichert. Das
Konfigurationsverzeichnis einschließlich `.storage` sichern. Aus Versionen bis
0.9.0 vorhandene eigene Pläne werden beim Update intern unverändert aufbewahrt,
aber nicht mehr an das Dashboard geliefert. Die Planungszuordnungen des festen
Grundrisses bleiben davon unabhängig erhalten.

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
Entwicklungsadapter ansehen. Dieser zeigt die dokumentierten Planungswerte ohne
simulierte Raumtemperaturen und nutzt lokalen Browser-Speicher. Die
ausgelieferte Karte nutzt die echte Home-Assistant-Verbindung und dessen
persistenten Speicher.

Die GitHub-CI prüft Pull Requests nach `main` sowie Änderungen auf `main` und
kann manuell gestartet werden. Ihre verbindliche Beschreibung, die geplanten
Integrations-/Frontendpfade und die Pflicht zur synchronen Dokumentation stehen
in [AGENTS.md](AGENTS.md). Build-Archive stehen im jeweiligen Actions-Lauf für
14 Tage zum Download bereit. HACS installiert das dauerhafte Asset eines
GitHub-Releases, nicht das temporäre Actions-Artefakt.

## HACS-Release veröffentlichen

Nach jedem Merge ist ein neues HACS-Release verpflichtend, auch bei reinen
Dokumentationsänderungen. Vor dem Merge eine bisher unveröffentlichte Version
vorbereiten; reine Dokumentationsänderungen erhöhen mindestens die Patch-Version.
Nach Review, Versionsanhebung und Merge muss die CI auf `main` erfolgreich sein.
Danach unter **Actions → HACS release → Run workflow** den Branch **main**
auswählen. Der Release-Workflow lädt das CI-Artefakt desselben Commits, prüft
Version, Quellcommit und vollständigen Paketinhalt und veröffentlicht
`v<VERSION>` mit dem Asset `heizlast_ha.zip`. Anschließend Version, Quellcommit
und Paketinhalt des veröffentlichten Assets prüfen. Der Projektabschluss setzt
eine erfolgreiche Veröffentlichung und Asset-Prüfung voraus. Bereits vorhandene
Releases werden nicht überschrieben; für Änderungen eine neue Projektversion
verwenden.

`hacs.json` blendet die nicht gebauten Branchdateien bei der Installation aus.
Alle Laufzeitdateien einschließlich Karte und Icon liegen im Integrationspaket.
Die CI verwendet zusätzlich die offizielle HACS-Validierungsaktion.
