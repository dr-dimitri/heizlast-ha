# Projektvorgaben

Diese Vorgaben gelten für das gesamte Repository.

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
3. **Alte lokale Branches löschen.** Nach erfolgreichem Build nicht mehr
   benötigte, vollständig integrierte lokale Branches mit `git branch -d`
   löschen. `main` und den aktuell ausgecheckten Branch dabei erhalten.
   Branches mit nicht integrierten Änderungen nicht gewaltsam löschen.
4. **Auf `main` wechseln und aktualisieren.** Die eigene Arbeit zuvor sichern,
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
   Für Schema-, Bild- und Geometrieprüfungen
   werden `jsonschema==4.26.0`, `Pillow==12.3.0` und `shapely==2.1.2`
   installiert. Den Dokumentationsabgleich ausführen,
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
  aktuell `0.4.0`. Für eine neue Implementierung die Version nach SemVer
  erhöhen. CI-Builds erhalten zusätzlich eine eindeutige Buildkennung.
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
  `www/heizlast-ha-card.js`, gemeinsamer Schema-Datei und `brand/icon.png`.
  Der Build kopiert die Karte auch in den ignorierten lokalen Ordner
  `custom_components/heizlast_ha/www/`; dort dürfen keine Benutzerdaten liegen.
  Diese Ausgaben werden beim Build neu erzeugt. Die Integration registriert
  die gebündelte Karte automatisch als zusätzliches JavaScript-Modul und
  verwendet die Manifestversion in der URL für Updates. Bestehende manuelle
  Ressourceneinträge aus Version 0.2.0 müssen bei der Migration entfernt werden.
- Die Integration vergleicht den SHA-256-Fingerabdruck der gebündelten Karte
  mit der zuletzt bestätigten Dashboard-Datei im Konfigurationseintrag.
  Änderungen erzeugen eine Reparatur mit Anleitung zum Neuladen und manueller
  Bestätigung. Bei Erstinstallationen wird nur der Ausgangsstand gespeichert;
  bestehende Installationen ohne Fingerabdruck erhalten einmalig eine Meldung.
  Änderungen ausschließlich am Backend lösen bei identischer Karte keine
  Reparatur aus. `repairs.py` ist eine verpflichtende Laufzeitdatei und wird
  sowohl beim Build als auch vor der HACS-Veröffentlichung geprüft.
- Das Projekt enthält die Integration `custom_components/heizlast_ha/` und
  die Dashboard-Karte unter `frontend/`. Beide Komponenten sind damit in der
  CI verpflichtend; Hassfest und Frontend-Prüfungen dürfen für vorhandenen Code
  nicht übersprungen werden. Das Archiv enthält die Integration und die
  kompilierte Karte für die manuelle Home-Assistant-Installation.
- Die Tests unter `tests/` prüfen Archivinhalt, Versionsfehler,
  erforderliche Frontend-Ausgaben, Dokumentationsabgleich, Schemakonsistenz,
  Beispielgrundriss und die echte Home-Assistant-Integration einschließlich
  Speicherung, Bildzugriff, WebSocket-API und Konfigurationsfluss. Pytest nutzt
  `asyncio_mode = "auto"` und einen Funktions-Scope für asynchrone Fixtures.
- HACS-Tests prüfen das direkt installierbare ZIP, Paketvollständigkeit und
  Releaseherkunft. Frontend-Integrationstests prüfen statischen Modulzugriff,
  automatisches Laden, Entladen/Neuladen und einen fehlenden Kartenbuild.
  Reparaturtests prüfen Erstinstallation, Kartenänderungen, Bestätigung,
  Neustart, veraltete Dialoge, Bereinigung und deutsche/englische Übersetzungen
  mit Home Assistants echtem Reparaturmanager.
- Die Frontend-Prüfungen führen den TypeScript-Compiler ohne Ausgabe aus.
  Vitest prüft unter anderem Schema-/Geometrievalidierung, Prompt und
  Kartennutzung; Vite bündelt die Karte als eigenständiges JavaScript-Modul
  `frontend/dist/heizlast-ha-card.js`. Abhängigkeiten und Lockfile liegen im
  Frontendordner; der lokale Entwicklungsadapter wird nicht in die Karte
  gebündelt.

### Gemeinsamer Formatvertrag

- `schemas/floorplan-v1.schema.json` ist die verbindliche Formatdefinition für
  Import und LLM-Prompt. Ihre Kopie unter
  `custom_components/heizlast_ha/floorplan-v1.schema.json` muss bytegleich sein;
  der Schematest erzwingt dies. Änderungen immer gemeinsam durchführen und
  Schema-Version sowie bestehende Daten berücksichtigen.
- Die Integration speichert Grundriss, Sensorzuordnungen und Bilder in Home
  Assistant. Der Frontend-Entwicklungsadapter darf ausschließlich für lokale
  Vorschau und Tests verwendet werden. Administratorrechte sind für Uploads
  und Konfigurationsänderungen erforderlich.

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
  abgebrochen. Nach einer neuen Implementierung Review, Version, grünen Build
  und Merge durchführen, dann bei einer gewünschten HACS-Veröffentlichung den
  Release-Workflow auf `main` starten und das veröffentlichte Asset prüfen.
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
- Review, neue Version, Build, Branchbereinigung und Aktualisierung von `main`
  im Abschlussbericht knapp festhalten. Fehlende Voraussetzungen oder
  fehlgeschlagene Schritte ausdrücklich nennen; den Ablauf dann nicht als
  vollständig abgeschlossen darstellen.
