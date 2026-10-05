# Projektvorgaben

Diese Vorgaben gelten für das gesamte Repository.

## Festgelegte Dashboard-Darstellung

- Der ausgewählte Entwurf ist das **Grundrissmodell** mit getrennten Ansichten
  für Erdgeschoss und Obergeschoss sowie anklickbaren Räumen.
- Es gibt ausschließlich diesen einen fest implementierten Grundriss. Keine
  Neuanlage, kein Import und keine Geometriebearbeitung für eigene Grundrisse
  anbieten. Nur Sensorzuordnungen der elf festen Rechenzonen sind veränderbar.
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
  Solarfaktoren. Keine Messwerte erfinden. Für
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
  aktuell `0.12.0`. Für eine neue Implementierung die Version nach SemVer
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
  mit Erdgeschoss/Obergeschoss und elf festen Rechenzonen. Es enthält keine
  Navigation zu eigenen Grundrissen, keinen Import, LLM-Prompt oder Editor.
  Die frühere Lovelace-Kennung `heizlast-ha-card` ist ein Alias für denselben
  festen Grundriss. Das Frontend bündelt keine Import-/Editor-Module oder
  zugehörige Bibliotheken mehr.
- Der authentifizierte Leseendpunkt `heizlast_ha/get_project` liefert nur
  `revision` und `planning_bindings`. `heizlast_ha/save_planning_bindings`
  erfordert Administratorrechte und eine aktuelle optimistische Projekt-Revision.
  Änderungen sind auf Sensorzuordnungen der elf festen Rechenzonen begrenzt.
  Neue Zuordnungen müssen echte Temperatursensoren sein; historische
  Zuordnungen bleiben lesbar. `heizlast_ha/save_project` wird nicht registriert;
  eigene Raumgeometrie lässt sich auch über die API nicht mehr hinzufügen.
- Sensorzuordnungen werden dauerhaft in Home Assistant gespeichert. Vorhandene
  eigene Pläne und deren alte Sensorzuordnungen bleiben bei Updates intern
  unverändert als ungenutzte Altdaten erhalten, werden aber nicht an das
  Dashboard geliefert. Die Integration schreibt keine neuen Benutzerpläne.
  Normheizlasten und Auslegungstemperaturen sind ausschließlich Planungsdaten;
  aktuelle Temperatur-/Strahlungswerte werden aus Home Assistants Zustand
  gelesen. Die aktuelle Heizlast ist ausdrücklich eine temperaturbasierte
  Schätzung: Normheizlast × max(0, Raumtemperatur − Außentemperatur) /
  (Auslegung innen − Auslegung außen), mit Umrechnung von °C/°F/K.
  Der belegte Außen-Auslegungswert −12,2 °C stammt aus Heizlastberechnung,
  Seite 2 / G1. Genau ein Raumfühler und ein rollenmarkierter Außensensor sind
  erforderlich; fehlende/ungültige/mehrdeutige Werte ergeben ?, Ergebnisse ≈.
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
  Die Raumlabels verwenden dieselbe Schriftfamilie und Namensgröße ohne
  raumweise Streckung; die Wertezeile hat die halbe Namensschriftgröße.
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
  Frontendordner; der lokale Entwicklungsadapter wird nicht in die Karte
  gebündelt.

### Fester Grundriss und Quelldaten

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
