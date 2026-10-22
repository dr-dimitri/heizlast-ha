# Projektvorgaben

Diese Vorgaben gelten für das gesamte Repository.

## Zentraler Modellkontext für LLMs

- Vor Arbeiten an Berechnung, Simulation oder Grundriss die zentrale
  [Modellbeschreibung in README.md](README.md#simulation-der-fußbodenheizung)
  sowie die Abschnitte zu Normheizlasten und Daten/Speicherung lesen.
  Dort stehen Modellumfang, Annahmen, Grenzen und die Verwendung des Rechenkerns.
- Belegte Gebäudewerte und Quellen ausschließlich aus
  [planning-data.json](custom_components/heizlast_ha/planning-data.json) lesen.
  Diese Datei ist die einzige maßgebliche Datenquelle für Live und Simulation.
  Keine Tabelle mit Raumlasten, Fensterflächen oder Konturen in Dokumentation,
  Modellkontext oder Simulationscode kopieren.
- Die ausführbaren Modellannahmen und Berechnungen stehen in
  [simulation-core.ts](frontend/src/simulation-core.ts) und
  [thermal-model.ts](frontend/src/thermal-model.ts). Dokumentierte Startannahmen
  müssen mit diesen Modulen übereinstimmen. Änderungen am Modell im selben
  Änderungssatz in README.md und diesem Modellkontext nachführen; unbekannte
  Anlagenwerte weiterhin als Annahmen kennzeichnen.

## Festgelegte Dashboard-Darstellung

- Der ausgewählte Entwurf ist das **Grundrissmodell** mit getrennten Ansichten
  für Erdgeschoss und Obergeschoss sowie anklickbaren Räumen.
- Es gibt ausschließlich diesen einen fest implementierten Grundriss. Keine
  Neuanlage, kein Import und keine Geometriebearbeitung für eigene Grundrisse
  anbieten. Am festen Plan sind nur Sensorzuordnungen und feste Raumtemperaturen
  der elf Rechenzonen veränderbar. Der zusätzliche Simulationstab bietet die
  Auswahl von Tag und Stunde sowie separat gespeicherte Gaspreis- und Energieeinstellungen für
  den Vergleich von Gas, Bosch-Wärmepumpe, Netzstrom, PV und angenommenem
  Stromspeicher; der Planungsdatensatz wird dadurch nicht verändert.
- Dargestellt wird ausschließlich das beheizte Wohnhaus. Spitzboden,
  Technikraum, Gerätelager und Garage bleiben außerhalb des Dashboards.

## Datenschutz bei Quelldokumenten und Quellcode

- **Keine personenbezogenen oder identifizierenden Angaben aus den
  Quelldokumenten in den Quellcode übernehmen.** Dazu gehören insbesondere
  Personen- und Eigentümernamen, Anschriften, Orte, Postleitzahlen,
  Kontaktdaten sowie Angaben zu Bauherren und Dokumentverfassern.
- Diese Vorgabe gilt auch für Kommentare, Konfigurationen, Testdaten,
  Beispieldaten, Dokumentation, Grafiken, Metadaten und Buildartefakte.
  Persönliche Bezeichnungen für das Gebäude, Originaldateinamen mit Namen
  und lokale Dateipfade mit Benutzer- oder Ortsangaben ebenfalls nicht
  übernehmen. Neutrale Bezeichnungen und Platzhalter verwenden.
- Nur die für das Dashboard erforderlichen fachlichen Daten übernehmen:
  Geschosse, neutrale Raumbezeichnungen ohne Personenbezug, Raumkonturen,
  Flächen, belegte Heizlastwerte und die erforderlichen belegten Fenster-/
  Solarfaktoren sowie die belegten FBH-Auslegungstemperaturen. Keine Messwerte erfinden. Für
  nachvollziehbare Quellenbelege neutrale Dokumentkennungen wie
  `Plan EG`, `Plan OG`, `Heizlastberechnung` und `EnEV-Nachweis` mit Seiten- oder
  Blattnummern verwenden.
- Original-PDFs, daraus erzeugte Planbilder und ungefilterte Text- oder
  OCR-Ausgaben ausschließlich lokal außerhalb des Repositorys aufbewahren.
  Nicht mit Git erfassen, in Pakete aufnehmen oder an externe Dienste
  übertragen. Private Zuordnungen zwischen neutralen Kennungen und
  Originaldokumenten bleiben ebenfalls außerhalb des Repositorys.
- Vor jedem Commit und Build die geänderten beziehungsweise vorgemerkten
  Dateien sowie einzupackende Grafiken und Metadaten auf solche Angaben
  prüfen. Gefundene persönliche Angaben entfernen oder anonymisieren;
  anschließend erneut prüfen. Der Implementierungsreview muss die
  Einhaltung dieser Datenschutzvorgaben ausdrücklich einschließen.

## Verbindlicher Ablauf nach jeder Implementierung

1. **Review durchführen.** Jede Implementierung muss vor dem Build auf
   Korrektheit, mögliche Regressionen und die Einhaltung der Projektvorgaben
   geprüft werden. Gefundene Probleme beheben und die Änderungen erneut prüfen.
2. **Eine neue Version bauen.** Nach erfolgreichem Review eine neue
   Projektversion erstellen und bauen. Dabei die vorhandenen Versions- und
   Buildkonventionen verwenden und relevante Prüfungen ausführen. Ein
   fehlgeschlagener Build muss behoben und wiederholt werden, bevor der Ablauf
   fortgesetzt wird. Fehlt ein definierter Versions- oder Buildprozess, diese
   Voraussetzung ausdrücklich melden und den Build nicht als erledigt ausgeben.
3. **Mergen und ein neues HACS-Release veröffentlichen.** Nach erfolgreichem
   Review und Build die Änderung in `main` mergen. Nach jedem Merge ist ein
   neues HACS-Release verpflichtend, auch bei reinen Dokumentationsänderungen.
   Den erfolgreichen CI-Build für exakt den neuen `main`-Commit abwarten,
   anschließend den Release-Workflow auf `main` starten und das veröffentlichte
   Asset `heizlast_ha.zip` auf Version, Quellcommit und vollständigen Paketinhalt
   prüfen. Das Release verwendet das geprüfte CI-Artefakt; kein abweichendes
   Paket erneut bauen. Der Ablauf ist erst nach erfolgreicher Veröffentlichung
   und Asset-Prüfung abgeschlossen.
4. **Alte lokale Branches löschen.** Nach erfolgreichem Build nicht mehr
   benötigte, vollständig integrierte lokale Branches mit `git branch -d`
   löschen. `main` und den aktuell ausgecheckten Branch dabei erhalten.
   Branches mit nicht integrierten Änderungen nicht gewaltsam löschen.
5. **Auf `main` wechseln und aktualisieren.** Die eigene Arbeit zuvor sichern,
   dann mit `git switch main` auf `main` wechseln und mit
   `git pull --ff-only origin main` aktualisieren. Falls der bisher aktive
   Entwicklungsbranch ebenfalls vollständig integriert und nicht mehr nötig
   ist, ihn anschließend mit `git branch -d` löschen.

## Issues mit dem Merge schließen

- Vollständig umgesetzte Issues müssen beim Merge des zugehörigen Pull Requests
  in den Standardbranch automatisch geschlossen werden.
- Dafür in der Pull-Request-Beschreibung für jedes vollständig umgesetzte Issue
  eine eigene Zeile mit `Closes #<Issue-Nummer>` aufnehmen, zum Beispiel
  `Closes #1`.
- Issues nicht vor dem Merge schließen. Nur teilweise umgesetzte Issues bleiben
  offen und dürfen nicht mit einem schließenden Schlüsselwort verknüpft werden.
- Nach dem Merge prüfen, dass die zugehörigen Issues tatsächlich geschlossen
  wurden, und das Ergebnis im Abschlussbericht festhalten.

## GitHub-CI und Buildkonvention

Die Pipeline steht in `.github/workflows/ci.yml`. Sie läuft bei Pull Requests
nach `main`, bei Pushes auf `main` und über `workflow_dispatch` manuell.
Gleichzeitig gestartete Läufe für denselben Git-Ref ersetzen den älteren Lauf.
Die Jobs verwenden `ubuntu-latest`, maximal 10 beziehungsweise 15 Minuten
Laufzeit und nur lesende Repositoryberechtigungen. Actions sind auf Commit-SHAs
festgelegt; Versionskommentare bei Aktualisierungen ebenfalls anpassen.

### Prüfungen und Reihenfolge

1. **`quality`:** Python 3.14 gemäß `.python-version` einrichten und die fest
   versionierten Werkzeuge aus `requirements-ci.txt` installieren
   (`ruff==0.16.10`, `pytest==9.0.3`). Die Home-Assistant-Testfixtures kommen aus
   `pytest-homeassistant-custom-component==0.13.367` und verwenden die stabile
   Home-Assistant-Version `2026.9.4`. `home-assistant-frontend==20260826.7`
   stellt deren echte Oberfläche für die Kartenregistrierungstests bereit.
   Die Fixtures verlangen selbst exakt `pytest==9.0.3`; das in der ursprünglichen
   CI-Grundlage genannte `9.1.1` ist mit dieser Abhängigkeitskombination nicht
   gemeinsam installierbar. Deshalb bleibt die vorhandene kompatible Version
   verbindlich, bis die Home-Assistant-Testfixtures gemeinsam aktualisiert werden.
   Für die fachlichen Tests der festen Raumkonturen wird
   `shapely==2.1.2` installiert. `jsonschema` und `Pillow` werden nicht mehr
   als eigene CI-Werkzeuge benötigt; Import- und Beispielbildprüfungen entfallen. Den Dokumentationsabgleich ausführen,
   Workflows mit Actionlint 1.7.12 validieren, `python -m ruff check .`,
   `python -m ruff format --check .` und `python -m pytest` ausführen.
   Ruff und Pytest werden über `pyproject.toml` konfiguriert.
2. **`hassfest`:** Sobald `custom_components/` existiert, nach erfolgreichem
   `quality` die offizielle Home-Assistant-Hassfest-Action ausführen. Diese
   prüft die Integrationsmetadaten und verwendet das offizielle Hassfest-Image.
   Fehlt der Integrationsordner noch, wird der Job ausdrücklich übersprungen.
3. **`hacs`:** Nach `quality` zusätzlich die offizielle, auf Commit-SHA
   festgelegte `hacs/action` mit `category: integration` ausführen. Die Prüfung
   kontrolliert Repositorystruktur, `hacs.json`, Integrationsmanifest,
   lokale Branddateien und GitHub-Metadaten. `comment: false` unterbindet
   automatische PR-Kommentare; keine Prüfungen werden ignoriert. Dieser Job
   läuft parallel zu Hassfest mit maximal 15 Minuten Laufzeit.
4. **`build`:** Erst nach erfolgreichen Qualitätsprüfungen, HACS-Validierung
   und erfolgreichem beziehungsweise mangels Integration übersprungenem
   Hassfest starten.
   Sobald `frontend/` existiert, Node.js 24 einrichten und in diesem Ordner
   `npm ci`, `npm run lint`, `npm test -- --run` und `npm run build` ausführen.
   `frontend/package-lock.json`, die genannten Skripte und ein nichtleerer
   Buildordner `frontend/dist/` sind dann verpflichtend. Ohne Frontend werden
   nur diese Frontend-Schritte ausdrücklich übersprungen.
5. **Artefakt:** `python scripts/build.py --build-id ci.<Lauf>.<Versuch>`
   erstellt `dist/heizlast-ha-<Version>+ci.<Lauf>.<Versuch>.zip` und
   `dist/heizlast_ha.zip`. Beide Archive werden
   als Actions-Artefakt `heizlast-ha-<Lauf>-<Versuch>` für 14 Tage gespeichert.
   Fehlende Archive gelten als Fehler. Die CI veröffentlicht keine Releases
   und führt keine Merges aus; der vorgeschriebene Review bleibt erforderlich.

### Versionierung und Paketinhalt

- `VERSION` ist die zentrale Projektversion im Format `MAJOR.MINOR.PATCH`,
  aktuell `0.22.0`. Für eine neue Implementierung die Version nach SemVer
  erhöhen. Jeder Merge benötigt eine bisher unveröffentlichte Version für das
  verpflichtende HACS-Release; reine Dokumentationsänderungen erhöhen mindestens
  die Patch-Version. CI-Builds erhalten zusätzlich eine eindeutige Buildkennung.
- Sobald Integrationen vorhanden sind, liegen sie unter
  `custom_components/<domain>/`. Jeder Integrationsordner benötigt
  `__init__.py` und `manifest.json`; dessen `version` muss zu `VERSION` passen.
  Die Version in `frontend/package.json` muss ebenfalls übereinstimmen.
- Der Build enthält Git-verwaltete Projektdateien und `build-info.json` mit
  Buildversion und Quellcommit. Neue Dateien vor lokalen Builds mit `git add`
  vormerken. Nicht versionierte lokale Dateien werden nicht eingepackt.
- Erzeugte Frontenddateien aus `frontend/dist/` werden zusätzlich unter
  `www/heizlast-ha/` aufgenommen. Leere oder fehlende Frontend-Buildausgaben,
  inkonsistente Versionen und symbolische Links führen zu einem Buildfehler.
- Für HACS muss die einzige Integration `heizlast_ha` sein. `hacs.json`
  verwendet `zip_release: true`, `filename: heizlast_ha.zip`,
  `hide_default_branch: true` und die Mindestversion Home Assistant `2026.9.4`.
  Die HACS-Konfigurationsdatei muss versioniert sein; der Build prüft dies.
  Das ZIP enthält direkt die Dateien des Integrationsordners, einschließlich
  `www/heizlast-ha-card.js`, `planning-data.json` und `brand/icon.png`.
  Die Integration hat keine externen Python-Laufzeitabhängigkeiten;
  Geometrievalidierung mit Shapely erfolgt ausschließlich in fachlichen Tests.
  Der Build kopiert die Karte auch in den ignorierten lokalen Ordner
  `custom_components/heizlast_ha/www/`; dort dürfen keine Benutzerdaten liegen.
  Diese Ausgaben werden beim Build neu erzeugt. Die Integration registriert
  die gebündelte Karte automatisch als zusätzliches JavaScript-Modul und
  verwendet die Manifestversion in der URL für Updates. Bestehende manuelle
  Ressourceneinträge aus Version 0.2.0 müssen bei der Migration entfernt werden.
- Die Integration registriert zusätzlich ein eigenes Dashboard als Custom-Panel
  **Heizlast HA** in der HA-Seitenleiste und verknüpft es mit der Integrationsseite.
  `panel_custom` ist eine verpflichtende Abhängigkeit. Das Panel verwendet die
  Karte aus demselben JavaScript-Modul mit Home Assistants authentifiziertem
  Zustand und mobilem Menüknopf. Es benötigt keine manuelle Kartenkonfiguration
  und funktioniert auch mit YAML-Dashboards und bei bestehenden Installationen.
  Belegte URL-Pfade werden durch nummerierte Ausweichpfade erhalten. Beim
  Entladen wird nur das eigene Panel entfernt, die Projektdaten bleiben erhalten.
- Die Integration vergleicht den SHA-256-Fingerabdruck der gebündelten Karte
  mit der zuletzt bestätigten Dashboard-Datei im Konfigurationseintrag.
  Änderungen erzeugen eine Reparatur mit Anleitung zum Neuladen und manueller
  Bestätigung. Bei Erstinstallationen wird nur der Ausgangsstand gespeichert;
  bestehende Installationen ohne Fingerabdruck erhalten einmalig eine Meldung.
  Änderungen ausschließlich am Backend lösen bei identischer Karte keine
  Reparatur aus. `repairs.py` ist eine verpflichtende Laufzeitdatei und wird
  sowohl beim Build als auch vor der HACS-Veröffentlichung geprüft.
- `planning.py` und `planning-data.json` sind ebenfalls verpflichtende,
  Git-verwaltete Laufzeitdateien. Build und Releaseprüfung lehnen fehlende
  Dateien ab. Der Datensatz enthält ausschließlich anonymisierte fachliche
  Planungswerte, Konturen und neutrale Quellenbelege; er wird in das
  Integrationsarchiv aufgenommen und vom Frontend im Kartenmodul gebündelt.
- `sensor.py` ist eine verpflichtende Laufzeitdatei für die Wetterwerte;
  Build und Releaseprüfung lehnen ein Paket ohne diese Datei ab. Die Integration
  verwendet `cloud_polling`: Beim Laden und anschließend alle 30 Minuten werden
  in einem gemeinsamen Open-Meteo-HTTPS-Abruf die aktuellen Felder
  `temperature_2m`, `shortwave_radiation`, `direct_normal_irradiance` und
  `diffuse_radiation` abgefragt. Koordinaten kommen
  bei jeder Abfrage aus Home Assistants Standortkonfiguration und werden weder
  im Repository noch in Entitätsattributen oder Fehlermeldungen gespeichert.
  Felder werden unabhängig geprüft und nach Fehlern bleiben die jeweiligen
  letzten gültigen Werte bestehen; der nächste Versuch erfolgt nach weiteren
  30 Minuten. Die vier Sensoren stellen Temperatur bzw. W/m², Gültigkeitszeit
  und gegebenenfalls Mittelungsintervall bereit und stellen Werte nach einem
  Neustart wieder her. Ohne erfolgreichen Abruf bleibt das jeweilige Feld
  unbekannt. Entladen beendet Timer und laufende Anfrage. Die bestehende
  Temperaturidentität und Sensorzuordnungen bleiben erhalten. Die
  Globalstrahlungsentität berechnet vier numerische Fassadenattribute aus
  kohärenten frischen DNI-/DHI-/GHI-Werten desselben Abrufs. Sonnenstand wird
  mit Home Assistants vorhandener Astral-Abhängigkeit am Intervallmittelpunkt
  bestimmt; das Modell nutzt isotropen Himmel und 20 % Bodenreflexion.
  API-Zeit maximal 60 Minuten alt / 5 Minuten zukünftig und Intervall maximal
  3600 Sekunden. Fehlerhafte oder unvollständige Angaben entfernen diese
  Attribute. Ein zusätzlicher Verfallstimer entfernt Fassadenattribute genau
  beim Erreichen der 60-Minuten-Grenze, ohne zusätzliche HTTP-Abfrage. Timer
  werden beim Entladen beendet. Alte Fassadenattribute werden beim Neustart
  nicht wiederhergestellt.
  Koordinaten und Sonnenstand werden nicht in Entitätsattributen gespeichert.
- Das Seitenleisten-Panel zeigt ausschließlich `heizlast-grundriss-card`
  mit den Tabs Live/Simulation, Erdgeschoss/Obergeschoss und elf festen
  Rechenzonen. Beide Ansichten verwenden denselben Planrenderer und denselben
  Planungsdatensatz. Es enthält keine
  Navigation zu eigenen Grundrissen, keinen Import, LLM-Prompt oder Editor.
  Die frühere Lovelace-Kennung `heizlast-ha-card` ist ein Alias für denselben
  festen Grundriss. Das Frontend bündelt keine Import-/Editor-Module oder
  zugehörige Bibliotheken mehr.
- Der authentifizierte Leseendpunkt `heizlast_ha/get_project` liefert nur
  `revision`, `planning_bindings`, `planning_temperatures` und bei hinterlegtem
  Gaspreis zusätzlich `gas_price_ct_per_kwh` sowie optional `energy_settings`.
  `heizlast_ha/save_planning_bindings`
  erfordert Administratorrechte und eine aktuelle optimistische Projekt-Revision.
  Änderungen sind auf Sensorzuordnungen und feste Raumtemperaturen der elf
  festen Rechenzonen begrenzt. Das optionale Feld `temperatures` enthält die
  vollständige Temperaturzuordnung in °C; ohne dieses Feld bleiben bisherige
  feste Werte erhalten. Sensorzuordnungen löschen den festen Wert ihrer Zone
  immer, auch bei fehlenden/ungültigen Sensorwerten. Ein späteres Entfernen
  des Sensors stellt keinen festen Wert wieder her. Nur endliche Zahlen ab
  −273,15 °C sind gültig; fehlende Schlüssel bedeuten nicht vorhanden. Alte
  Speicherstände bleiben ohne Umschreiben lesbar.
  Neue Zuordnungen müssen echte Temperatursensoren sein; historische
  Zuordnungen bleiben lesbar. `heizlast_ha/save_project` wird nicht registriert;
  eigene Raumgeometrie lässt sich auch über die API nicht mehr hinzufügen.
- `heizlast_ha/save_gas_price` speichert unabhängig von Raumänderungen einen
  optionalen Brutto-Arbeitspreis in ct/kWh. Administratorrechte und aktuelle
  gemeinsame Projekt-Revision sind erforderlich; endliche Zahlen ab null sind
  gültig, `null` löscht den Preis. Speicherung, Konflikte und Speicherfehler
  verwenden denselben dauerhaften Speichermechanismus wie Raumeinstellungen.
  Raumänderungen erhalten den Preis, Preisänderungen Raumkonfiguration und
  ungenutzte Altdaten. Alte Speicherstände ohne Preis bleiben ohne Umschreiben
  lesbar. Normale Benutzer sehen den hinterlegten Preis und die Tageskosten.
- Sensorzuordnungen und feste Raumtemperaturen werden dauerhaft in
  Home Assistant gespeichert. Vorhandene
  eigene Pläne und deren alte Sensorzuordnungen bleiben bei Updates intern
  unverändert als ungenutzte Altdaten erhalten, werden aber nicht an das
  Dashboard geliefert. Die Integration schreibt keine neuen Benutzerpläne.
  Normheizlasten und Auslegungstemperaturen sind ausschließlich Planungsdaten;
  aktuelle Sensor-/Strahlungswerte werden aus Home Assistants Zustand
  gelesen. Ohne Raumfühler kann ein expliziter fester Temperaturwert verwendet
  werden; er ist kein Messwert und wird nicht im Planungsdatensatz gespeichert.
  Die aktuelle Heizlast ist ausdrücklich eine temperaturbasierte
  Schätzung: Normheizlast × max(0, Raumtemperatur − Außentemperatur) /
  (Auslegung innen − Auslegung außen), mit Umrechnung von °C/°F/K.
  Der belegte Außen-Auslegungswert −12,2 °C stammt aus Heizlastberechnung,
  Seite 2 / G1. Genau ein Raumfühler oder ohne Sensor eine feste Raumtemperatur
  sowie ein rollenmarkierter Außensensor sind erforderlich; fehlende/ungültige/
  mehrdeutige Werte ergeben ?, Ergebnisse ≈.
  Verfügbare solare Gewinne werden mit belegten Raumfensterflächen und den
  EnEV-Faktoren aus Abschnitt 5.3 / Seiten 5–6 abgezogen, mindestens bis 0 W:
  g-Wert 0,50, Rahmenfaktor 0,70, Verschattung 0,90, Sonnenschutz 1,00 und
  Einfallsfaktor 0,90. Die Raumsummen stimmen mit den vier EnEV-Fassadensummen
  innerhalb der Quellenrundung überein. Die südlichen verglasten Außentüren
  gehören zu Wohnen/Essen; die Eingangstür bleibt ausgeschlossen. Die letzte
  westliche Wohnen/Essen-Fensterfläche wird mit Außenwandabzug und Summenabgleich
  neutral belegt. Rohwerte bleiben bei Fehlern erhalten, Fassadenattribute
  für die Solarkorrektur werden dann entfernt. Ohne aktuelle Solardaten wird
  ausdrücklich die temperaturbasierte Schätzung angezeigt. Interne Gewinne,
  wechselnde Lüftung, Nachbarraumtemperaturen, tatsächlicher Rollladenstatus
  und Wärmespeicherung bleiben unberücksichtigt. Tests prüfen Normbedingungen,
  Skalierung, Einheiten, solare Gewinne/Nullbedarf, ungültige Daten,
  unabhängige Wetterfelder und einen gemeinsamen Abruf.
- Das Projekt enthält die Integration `custom_components/heizlast_ha/` und
  die Dashboard-Karte unter `frontend/`. Hassfest und Frontend-Prüfungen sind
  für den vorhandenen Code verpflichtend. Das Archiv enthält die Integration
  und die kompilierte Karte für die manuelle Home-Assistant-Installation.
- Tests prüfen Paketvollständigkeit, Versionen, Buildherkunft,
  Dokumentationsabgleich sowie Home Assistants echte Konfigurations-,
  WebSocket-, Speicher-, Panel- und Reparaturfunktionen. Python-Tests nutzen
  `asyncio_mode = "auto"` und einen Funktions-Scope für asynchrone Fixtures.
  Import-, Editor-, Prompt-, Raumteilungs- und Raumverbindungstests entfallen
  gemeinsam mit den entfernten Funktionen.
- Fachliche Tests prüfen gemeinsame Rechenzonen, Flächen-/Lastsummen,
  gültige Konturen, bestätigte Bad-Zuordnung mit unbekannter Planfläche,
  vollständig innerhalb der Räume liegende Beschriftungsfelder und den Ausschluss
  unbeheizter Gebäudeteile. Backendtests prüfen separate Sensorzuordnungen,
  Benutzerrechte, dauerhafte Speicherung, Wiederladen, Konflikte, Speicherfehler,
  nicht verfügbare Sensoren und den unveränderten Erhalt ungenutzter Altdaten.
  Die frühere Geometrie-Speicheranfrage muss als unbekannter Befehl scheitern.
- Außentemperaturtests prüfen den Home-Assistant-Standort mit neutralen
  Testkoordinaten, den ersten Abruf, das 30-Minuten-Intervall, fehlerhafte
  Antworten, Werterhalt, Wiederholung und Entladen. HTTP-Antworten werden in
  sämtlichen Integrationstests lokal simuliert; reale Standortabfragen entfallen.
- Frontendtests prüfen Geschoss-/Raumauswahl, gemeinsame Lasten, bestätigtes Bad,
  echte Sensorzustände, fehlende Messwerte, Lesezugriff, Speicherfehler,
  Konfliktbehandlung, Außentemperatur und mobile Navigation. Raumlabels zeigen
  aktuelle Temperatur / berechnete Heizlast / aktuelle Heizlast; fehlende Werte
  stehen als `?`. Mehrere Sensoren bleiben einzeln sichtbar; ohne eindeutigen
  Einzelwert wird keine Raumtemperatur für das kompakte Label abgeleitet.
  Die aktuelle Heizlast wird temperaturbasiert und bei verfügbaren frischen
  Wetterdaten mit solaren Gewinnen nach EnEV-Annahmen geschätzt; fehlende
  Temperaturen ergeben `?`, fehlende Solarwerte die gekennzeichnete Basisrechnung.
  Unter der Sensorauswahl steht eine feste Raumtemperatur (°C), die nur
  Administratoren speichern können. Sensorwahl leert und deaktiviert das Feld;
  Leserechte zeigen gespeicherte Eingaben an. Entwürfe, Verwerfen, Konflikte und
  Speicherfehler betreffen beide Einstellungen gemeinsam. Pro Geschoss steht
  zusätzlich die Summe ungerundeter aktueller Raumheizlasten einschließlich
  verfügbarer Solargewinne. Bei einer fehlenden Raumheizlast steht ? mit der
  Anzahl berechenbarer Rechenzonen; fehlende Werte werden nicht als null summiert.
  Tests prüfen Speicherung, Sensorvorrang, Löschung, Nullwerte, ungültige Eingaben,
  Leserechte und Geschosssummen mit gemischten Temperaturquellen.
  Die Raumlabels verwenden dieselbe Schriftfamilie und Namensgröße ohne
  raumweise Streckung; die Wertezeile hat die halbe Namensschriftgröße.
  Der Simulationstab verwendet dieselben Labels und Konturen. Tag und Stunde
  sind auch mit Leserechten auswählbar. Manuelle FBH-/Wetterannahmen, Monat,
  Standort und Vorlauf sind in der Oberfläche nicht mehr einstellbar.
  Stündliche Wetterdaten kommen über `heizlast_ha/get_weather` aus dem gemeinsamen
  Open-Meteo-Cache. Raumtemperaturen folgen genau den Live-Regeln einschließlich
  Sensorvorrang, Einheitenumrechnung und unbekannten Werten. Die Simulation
  verändert keine Sensoren, Zuordnungen oder Planungsdaten. Das Diagramm zeigt
  je Stunde Gebäudeheizlast auf der linken Achse sowie nötigen gemeinsamen
  Vorlauf und Außentemperatur auf derselben rechten Celsiusachse, die auch
  negative Werte umfasst. Eine Stundenwertliste gibt es nicht. Auswahl im
  Diagramm oder Stundenfeld zeigt Vorlauf, Außentemperatur und Raumwerte der
  gewählten Stunde. Fehlende Daten bleiben ?, Heizbedarf null
  zeigt Heizung aus, nicht erreichbarer Vorlauf bleibt ausdrücklich unbekannt.
  Tagesenergie wird nur bei vollständigen Stundenwerten summiert. Datum und
  Stunde bleiben beim Tab-/Geschosswechsel erhalten. Tests prüfen Quellen-
  gleichheit mit Live, unterschiedliche Raumtemperaturen, Datenlücken,
  Wetterfehler, Wiederholung, Rechte, Zeitumstellung und aktualisierte Sensoren.
  Der Tagesgasbedarf ist Tageswärmebedarf / 0,95 mit fester Annahme 95 %
  Nutzungsgrad einer modernen Brennwerttherme bezogen auf den Brennwert.
  Tageskosten sind ungerundeter Gasbedarf × Brutto-Arbeitspreis in ct/kWh / 100
  in Euro. Dies ist nur eine Modellschätzung für Raumheizung, keine Prognose
  des tatsächlichen Gaszählers. Warmwasser, Grundpreis, Hilfsstrom sowie
  zusätzliche Verteil-/Speicherverluste fehlen. Bei nicht erreichbarem Vorlauf
  bleibt es ein rechnerischer Brennstoffbedarf, keine Betriebsprognose.
  Ohne vollständigen Tageswärmebedarf sind Verbrauch und Kosten unbekannt;
  ohne Preis nur die Kosten. Nullbedarf und Nullpreis bleiben gültige Nullen.
  Tests prüfen Umrechnung, Lücken, Nullwerte, ungültige Eingaben, Speicherung,
  Leserechte, Verwerfen, Konflikte, Speicherfehler und Erhalt der Raumdaten.
  Panel und alte Kartenkennung
  dürfen ausschließlich den festen Grundriss anzeigen und keine Möglichkeit
  zum Hinzufügen oder Importieren eines anderen Plans bieten.
- Integrationstests prüfen automatisches Laden und Entladen der gebündelten
  Karte, die Seitenleiste, Verknüpfung mit der Integration und Pfadkonflikte.
  Reparaturtests prüfen Erstinstallation, Kartenänderungen, Bestätigung,
  Neustart, veraltete Dialoge, Bereinigung und deutsche/englische Übersetzungen
  mit Home Assistants echtem Reparaturmanager.
- Die Frontend-Prüfungen führen den TypeScript-Compiler ohne Ausgabe aus.
  Vitest prüft den festen Grundriss, Sensorzuordnung und
  Kartennutzung; Vite bündelt die Karte als eigenständiges JavaScript-Modul
  `frontend/dist/heizlast-ha-card.js`. Abhängigkeiten und Lockfile liegen im
  Frontendordner; Vite ist auf die korrigierte Patchversion 8.3.5 festgelegt.
  Der lokale Entwicklungsadapter wird nicht in die Karte gebündelt.

### Wärmeerzeuger und Energievergleich

- `heat-pump.ts` ergänzt die vorhandene stündliche FBH-Rechnung um ausschließlich
  Bosch Compress 5800i AW 5 OR-S (5-kW-Modellklasse). Herstellerdaten stammen aus
  Bosch-Planungsunterlage 6721891866 (2025/04), S. 81 Tabelle 29 und S. 4:
  https://bosch-de-de.boschhc-documents.com/download/pdf/file/6721891866 .
  Zusammengehörige maximale W35-Leistung/COP bei A−7/A2/A7 werden linear
  interpoliert. Lineare Vorlaufverhältnisse A7/W35 zu A7/W55 gelten angenähert
  für alle Außenpunkte und werden auf W20..60 extrapoliert. Unter W35 keine
  Kapazitätserhöhung, oberhalb A7 konstante A7-Werte bis A45. Unter A−7 kein
  belegter Modellpunkt. Das ist kein vollständiges Kennfeld; nominale Teillast-
  COPs und SCOP werden nicht als stündlicher COP eingesetzt. Bei Leistungsdefizit,
  nicht erreichbarer FBH oder fehlenden Punkten bleiben Tagesstrom/-kosten
  unbekannt. Kein impliziter Heizstab oder Gas-Backup. Nullbedarf ist gültig.
- `energy-comparison.ts` bilanziert zeitgleichen Netz-/PV-Strom ohne Übertrag
  zwischen Stunden. PV-Erzeugung ist vereinfachend vollständig für die WP
  verfügbar, keine Haushaltslast. Die PV-Nutzung
  ist eine Obergrenze; gleichmäßige Leistung im Intervall ist eine Annahme.
  Kosten = Netzstrom zum Intervalltarif + PV-Strom zur entgangenen
  Einspeisevergütung + Strom aus dem unten beschriebenen Speicher zu 18 ct/kWh.
  Daneben stets Netzreferenz ohne PV und Speicher sowie Gas nach bisheriger
  95-%-Annahme. Lücken/Überlappungen bleiben unbekannt; Nullbedarf bleibt null.
- Der Stromspeicher ist eine feste Benutzerannahme mit 6 kWh nutzbarer
  elektrischer Energie, die am Ende des Niedrigtarifs vollständig bereitsteht.
  Entnahme kostet insgesamt 18 ct/kWh, ohne doppelte Ladekosten oder einen
  erfundenen Wirkungsgrad. Ausschließlich vom letzten belegten Niedrigtarifende
  bis zum Beginn des ersten positiven PV-Prognoseintervalls desselben
  HA-lokalen Tages wird chronologisch bis 6 kWh entnommen; Mehrbedarf bleibt
  Netzbezug zum Intervalltarif. Niedrigtarif nur aus SAX-`time_of_use`-Fenstern
  unter `base_price_eur_kwh` ableiten. Tarifkontext einschließlich der Stunde
  vor Tagesbeginn erhält ein Ende um Mitternacht. Unterstündliche Grenzen und
  Zeitumstellung berücksichtigen. Ohne belegtes Ende oder positiven PV-Beginn
  keine Speicheranrechnung, auch bei vollständig PV-freiem Tag; Datenlücken
  bleiben unbekannt. Keine zweite Ladung, Abendnutzung, PV-Verschiebung zwischen
  Stunden, Haushaltslast, SOC-, Leistungs- oder Steuerungsprognose. Speicherenergie
  und Speicherkosten separat anzeigen. Nur der Vergleich Netz/PV/Speicher wird
  ergänzt; reine Netzreferenz, Wärmebedarf und FBH bleiben unverändert. Kein
  thermischer Speicher und keine Änderung an `planning-data.json` oder den
  gespeicherten Energieeinstellungen.
- Adminspeicherung `heizlast_ha/save_energy_settings` mit gemeinsamer Revision
  und vollständigem `settings`-Objekt: `heat_generator` (`gas` oder
  `bosch_aw5800_5`), `pv_forecast_entity_id`, `electricity_price_entity_id`,
  `feed_in_tariff_entity_id` (je Sensor-ID oder null). Alte Speicherstände bleiben
  lesbar; Gas-/Raumdaten und ungenutzte Altdaten bleiben erhalten. Neue IDs werden
  gegen die Integrations-/Rollenidentität in der HA-Registry geprüft. Keine
  zusätzlichen Pflichtabhängigkeiten. Standard ohne Auswahl ist Gas.
- `get_energy_sources` liefert nur lesbare, nicht deaktivierte passende
  Registry-Quellen mit Entitäts-/Konfigurationseintrags-ID. `get_energy_forecast`
  prüft Leserechte und absolute Zeitgrenzen bis 26 h, liest den lokalen
  `pv_forecast.get_forecast`-Cache mit 60-Minuten-Fenster und liefert ausschließlich
  bereinigte Intervalle, Status und Frische. Keine Stundenwerte aus Tageszahlen
  erfinden. Nur vollständige Prognosen unter 60 Minuten alt sind nutzbar;
  Ablaufzeit invalidiert die UI auch zwischen Minutenabfragen. Keine Rohantworten,
  Standorte, Prognosen oder Tarifreihen speichern oder an externe Dienste senden.
- SAX-Import-/Vergütungssensoren werden über `sax_power` und Unique-ID-Rolle
  erkannt. Zustände ct/kWh, Attribute `base_price_eur_kwh` und
  `windows[].price_eur_kwh` EUR/kWh. Feste/tägliche Tarife in HA-Zeitzone mit
  Mitternacht, Zeitumstellung und gebrochenem Offset behandeln; Tarifwechsel
  teilen Intervalle. Dynamische Cache-Reihen über
  `sax_power/dashboard/tariff/series` nur heute/morgen, keine Preisfortschreibung
  für spätere Tage; negative Preise zulassen. Einspeisewert aus dem Sensor für
  den ausgewählten Tag als konstant annehmen. Leserechte für Vergleich, Admin
  für gespeicherte Auswahl. Die UI liest Quellen jede Minute, steuert nichts.
- Tests prüfen Herstellerpunkte, Vorlauf-/Außeneinfluss, Leistungslimit,
  unbekannte/Nullwerte, Tarifgrenzen, Zeitumstellung, PV-Zeitgleichheit,
  Speicherfenster, 6-kWh-Grenze, 18-ct-Kosten, Restnetzbezug, fehlende Grenzen,
  ausbleibende Mehrfachladung und unveränderte Netzreferenz,
  Opportunitätskosten, getrennte Datenlücken, Immutabilität, Quellidentität,
  Leserechte, Speichern, Konflikte, Speicherfehler und Erhalt bisheriger Daten.
  README und Modellkontext im selben Änderungssatz nachführen.

### Fester Grundriss und Quelldaten

- `thermal-model.ts` enthält die gemeinsame Verlust-/Solarbilanz für Live und
  Simulation; `simulation-core.ts` ergänzt die Heizkreise und die stündliche
  Vorlaufinversion. Der Kern importiert weder JSON noch HA-/DOM-APIs, ruft kein
  Netz ab und verändert seine Eingaben nicht. `heat-load.ts` bleibt Einheitenadapter.
  Gebäudedaten, Konturen, Lasten, Flächen, Fenster, Solarfaktoren, belegter
  Vorlauf/Rücklauf und bestätigte Installation werden ausschließlich aus der
  bestehenden `planning-data.json` gelesen. Keine Kopie für die Simulation anlegen.
- Die Tagesenergie, Diagramm-Gebäudeheizlast und Gas-/WP-/Kostenvergleiche
  verwenden eine getrennte Gebäudebilanz: je Zone
  `(transmission + 0,5 × ventilation) × Rundungsfaktor`, mit
  `Rundungsfaktor = building.heat_load_w / Summe(transmission + 0,5 × ventilation)`.
  Die hälftige Lüftung folgt der belegten Gebäudeheizlastberechnung; der Faktor
  gleicht ausschließlich Quellenrundung aus und ist keine Verbrauchskalibrierung.
  Jeden Beitrag mit der jeweiligen Live-Raumtemperatur und Normdifferenz
  skalieren, unveränderte solare Gewinne dieser Zone abziehen, auf null
  begrenzen und erst danach summieren. Keine pauschale Skalierung der bereits
  solarbereinigten Raumlastsumme und kein Solarübertrag zwischen Räumen/Stunden.
  Am solarfreien Normpunkt muss die Bilanz exakt die belegte Gebäudenormlast
  ergeben. Fehlende/ungültige Gebäudeanteile bleiben unbekannt, ohne Ersatz
  durch Raumlasten. `HeatingHour.heatDemandW` ist der Gebäudebedarf;
  `roomHeatDemandW`, Zonenwerte und Vorlaufsuche behalten die konservative
  Raumrechnung mit voller Lüftung. Die UI kennzeichnet beide Bezugsgrößen.
  Gebäude-Nullbedarf ergibt null Gas-/WP-Energie auch bei positivem
  Raumprüfbedarf. Die COP-Schätzung nutzt weiterhin den konservativen Vorlauf;
  sonstige Datenlücken und nicht erreichbarer Vorlauf bleiben unbekannt.
  Interne Gewinne, Wärmespeicherung und tatsächliche Lüftung werden nicht
  erfunden. Das Ergebnis bleibt eine stationäre Raumheizungsschätzung ohne
  Warmwasser und Verbrauchskalibrierung. Tests prüfen Normpunkt, individuelle
  Temperaturen, Lüftungsanteile, Quellenrundung, lokale Solarbegrenzung,
  Lücken/Nullbedarf und die Gebäudebasis von Gas-/WP-Energie und Kosten.
- `simulateHeatingDay` berechnet vollständige Wettertage in Stundenschritten.
  `get_weather` liefert den gemeinsamen bereinigten Arbeitsspeicher-Cache über
  einen authentifizierten Leseendpunkt, auch mit Leserechten und ohne zusätzliche
  HTTP-Abfrage. Der 30-Minuten-Abruf enthält aktuelle und stündliche Temperatur,
  GHI, DNI und DHI; UTC-Zeitstempel, ein vergangener und acht Vorhersagetage
  decken die lokalen Tagesgrenzen ab. Heute und die folgenden sechs Tage sind
  auswählbar. Die Karte liest den Cache beim Öffnen und jede Minute; ungültige,
  fehlende oder über 60 Minuten alte Wetterdaten liefern Lücken. Ein Standort-
  wechsel invalidiert die Vorhersage. Kein Persistieren oder Wiederherstellen
  von Vorhersagen, Koordinaten oder Rohantworten; keine Standortdaten im Frontend.
  Stündliche Strahlung gilt für die vorangegangene Stunde; die Temperatur ist
  das Mittel ihrer beiden Randwerte. Dieselbe Fassadenprojektion wie Live nutzt
  Astral am Intervallmittelpunkt, isotropen Himmel und 20 % Bodenreflexion.
  HA-Zeitzone und UTC-Zeitachse erhalten 23/25 Stunden an Zeitumstellungstagen;
  doppelte Uhrzeiten werden mit Offset angezeigt. Bei gebrochenem UTC-Offset
  werden überlappende Stunden gewichtet; fehlende Nachbarwerte bleiben Lücken.
  Fehlende Stunden nie null setzen.
- Jede Zone hält ihre Live-Raumtemperatur für den gewählten Tag konstant:
  eindeutiger Raumfühler oder ohne Sensor eine feste Eingabe. Keine erfundene
  Ersatztemperatur bei fehlenden Werten. Last und nutzbare solare Gewinne werden
  pro Stunde mit denselben Funktionen wie Live berechnet; Solarüberschüsse
  werden nicht auf andere Räume oder Stunden übertragen. Numerische Intervall-
  suche bestimmt den kleinsten gemeinsamen Vorlauf, der jeden Raum versorgt,
  konservativ auf 0,1 °C aufgerundet. Nullbedarf zeigt Heizung aus. Ist der
  Bedarf bis zur numerischen Suchgrenze 60 °C nicht deckbar, bleibt der Vorlauf
  unbekannt und Raumdefizite werden bei dieser Grenze gezeigt. Dies ist keine
  Betriebsempfehlung. Eine positive Gebäudebilanz gleicht kein Raumdefizit aus.
- Die FBH verwendet die bisherigen gemeinsamen festen Annahmen: 80 % aktive
  Fläche, Exponent 1,1, maximal 29 °C Oberfläche, 1,5 l/min je offenem Kreis,
  insgesamt 6 m zusätzliche Anbindung (je 3 m hin/zurück) und 0,15 m wirksame
  Heizstreifenbreite. Keine manuellen Überschreibungen im Dashboard.
  Die Referenzkennlinie wird weiterhin aus dem höchsten Bedarf je aktiver
  Raumfläche am angenommenen solarfreien Kalibrierpunkt −9 °C außen / 22 °C
  innen und dem belegten Vorlauf/Rücklauf hergeleitet, auf ganze W/m² aufgerundet.
  Dies ist eine Annahme, keine Messung; Stundenwerte kalibrieren nicht neu.
  Bestätigte Raumrohrlängen, Rohrdimension und Verteiler-/Zuleitungszonen kommen
  aus `installation` mit neutralem Beleg Benutzerangabe. Geschätzte Leitungswege,
  Durchfluss und Breiten bleiben im Rechenkern, nicht im Planungsdatensatz.
  Kreise werden als Hinleitung → Raum → Rückleitung gerechnet, mit der jeweiligen
  Live-Temperatur der durchlaufenen Zone. Kreise im Verteilerraum bleiben dort,
  übrige Anbindungen liegen vereinfachend in der Geschossdiele. Die OG-Diele hat
  keinen eigenen Kreis; ihre Fläche folgt Zuleitungslänge × Heizstreifenbreite,
  gedeckelt auf Planfläche × aktiven Anteil. Mehrere Abschnitte teilen Flächen
  proportional zur Rohrlänge. Flächen und Leitungswärme nie doppelt bilanzieren.
  Wasserannahmen: 1 kg/l, 1,163 Wh/(kg K). Leistung und Ausgangstemperatur werden
  gemeinsam aus logarithmischer Kennlinie und Wasserbilanz gelöst. Der folgende
  Abschnitt erhält die Ausgangstemperatur. Die Oberfläche folgt zusätzlich
  q = 8,92 × positiver Oberflächenübertemperatur^1,1 und darf im Heizbetrieb
  die logarithmische Heizmitteltemperatur nicht überschreiten. Die Raumoberfläche
  ist der höchste Segmentwert, Wärmestromdichte das Flächenmittel, Rücklauf das
  Mittel beteiligter Kreise. Ohne positive Übertemperatur keine Heizleistung.
  Rohrinhalt liefert kein Speichermodell; Rohrlänge bestimmt keinen Durchfluss.
  Bodenaufbau/Belag, tatsächlicher Verlegeabstand, Wärmeverluste nach unten,
  hydraulischer Abgleich, Thermostatregelung, Speicher, interne Gewinne und
  wechselnde Lüftung bleiben unberücksichtigt. Keine Aufheizzeit-, Raumtemperatur-
  oder reale Steuerungsprognose behaupten. Der isolierte alte Szenariokern bleibt
  für fachliche Regressionstests verfügbar, wird aber nicht vom Dashboard benutzt.
  Tests prüfen Energie-, Längen- und Volumenerhalt, physikalische Grenzen,
  unterschiedlichen Raumbedarf, Sensorvorrang, Wetterzeitbezug, stündliche
  Inversion, Nicht-Erreichbarkeit, Nullbedarf, Lücken, Immutabilität und
  unveränderte feste Planungsdaten.
- `planning-data.json` enthält den einzigen implementierten Grundriss.
  Vereinfachte Konturen sind keine Vermessung; Flächen und Lasten stammen
  ausschließlich aus den neutral belegten Quelldokumenten. Gemeinsame
  Rechenzonen bleiben gemeinsam. Zone 4 hat eine einzelne Beschriftung „Diele“
  im freien Bereich; Zone 6 eine zusammenhängende Kontur „Schlafzimmer“.
  Zone 5 besitzt ein einzelnes Label „Wohnen und Essen“ für den gesamten
  bisherigen Wohn-/Ess-/Küchenbereich. Kontur, Fläche, Heizlast und
  Sensorzuordnung dieser gemeinsamen Rechenzone bleiben erhalten.
  Die Bad-Zuordnung ist vom Benutzer bestätigt, ihre unbeschriftete Planfläche
  bleibt unbekannt. Benutzerseitig ausdrücklich vorgegebene neue Anzeigenamen
  werden nur als Raumlabel übernommen; persönliche Angaben aus Quelldokumenten
  bleiben ausgeschlossen. Änderungen an Namen und Konturen erhalten Zonen-IDs,
  dokumentierte Lasten und bestehende Sensorzuordnungen.
- Originaldokumente und persönliche Angaben bleiben außerhalb des Repositorys.
  Es gibt keine Bild-Uploads, externen LLM-Anfragen oder Bildspeicherung.
  `examples/`, das frühere Import-Schema und generische Geometrie-Werkzeuge
  werden nicht mehr ausgeliefert. Der lokale Entwicklungsadapter dient nur
  zur Vorschau des festen Plans ohne simulierte Sensorwerte.

### HACS-Releases

- `.github/workflows/release.yml` wird ausschließlich manuell über
  `workflow_dispatch` gestartet. Veröffentlichungen sind auf `main`
  beschränkt; der Job läuft maximal 10 Minuten. Er verwendet `actions: read`
  zum Laden des CI-Artefakts und `contents: write` für Tag und GitHub-Release.
  Die gewöhnliche CI behält nur lesende Berechtigungen.
- Voraussetzung ist ein erfolgreicher Lauf von `ci.yml` für exakt denselben
  `main`-Commit. Der Workflow lädt dessen Artefakt statt erneut zu bauen.
  `scripts/prepare_release.py` prüft Quellcommit, zentrale Version,
  Integrationsmanifest, Archivpfade und notwendige Laufzeitdateien.
- Danach wird `v<VERSION>` mit dem Asset `heizlast_ha.zip` und automatisch
  erzeugten Releasehinweisen veröffentlicht. Bestehende Releases werden nicht
  überschrieben. Parallele Veröffentlichungen werden serialisiert, nicht
  abgebrochen. Nach Review, Versionsanhebung, grünem Build und jedem Merge den
  erfolgreichen CI-Lauf des neuen `main`-Commits abwarten, den Release-Workflow
  auf `main` starten und das veröffentlichte Asset prüfen. Die Veröffentlichung
  ist verpflichtend und benötigt keine zusätzliche Aufforderung des Benutzers.
  Dies gilt auch für reine Dokumentationsänderungen. Fehlgeschlagene Builds
  oder Veröffentlichungen beheben und erneut ausführen; den Abschluss bis dahin
  ausdrücklich als unvollständig melden.
- Die Installation erfolgt zunächst als benutzerdefiniertes HACS-Repository
  vom Typ Integration. Eine Aufnahme in den zentralen HACS-Katalog benötigt
  einen separaten Antrag und ist nicht Teil der Installationsfunktion.

### CI-Änderungen immer mitdokumentieren

- **Jede Änderung an der CI-Pipeline muss im selben Commit beziehungsweise
  Pull Request auch diese Beschreibung in `AGENTS.md` aktualisieren.** Das gilt
  insbesondere für Trigger, Jobs, Werkzeuge, Versionen, Befehle, Bedingungen,
  Buildausgaben, Berechtigungen und die Aufbewahrung von Artefakten.
- `scripts/check_ci_docs.py` erzwingt eine Änderung an `AGENTS.md`, wenn sich
  `.github/workflows/`, `.python-version`, `requirements-ci.txt`,
  `pyproject.toml`, `scripts/build.py`, `scripts/prepare_release.py`,
  `scripts/check_ci_docs.py`, `hacs.json`,
  `frontend/package.json` oder `frontend/package-lock.json` ändern.
  Bei Pull Requests wird die Differenz zwischen gemeinsamer Merge-Basis und
  Head-Commit geprüft, bei Pushes zwischen vorherigem und neuem Commit.
  Beim ersten Push wird mit einem leeren Git-Baum verglichen.
  Manuelle Läufe ohne Vergleichsbasis
  überspringen ausschließlich diesen Dokumentationsabgleich.
- Die automatische Prüfung erkennt, ob die Datei geändert wurde. Im Review
  zusätzlich prüfen, dass ihre Beschreibung die neue Pipeline korrekt wiedergibt.

## Abschluss

- Änderungen anderer Personen und nicht integrierte Commits niemals verwerfen.
- Review, neue Version, Build, Merge, veröffentlichtes HACS-Release samt
  Asset-Prüfung, Branchbereinigung und Aktualisierung von `main` im
  Abschlussbericht knapp festhalten. Fehlende Voraussetzungen oder
  fehlgeschlagene Schritte ausdrücklich nennen; den Ablauf dann nicht als
  vollständig abgeschlossen darstellen.
