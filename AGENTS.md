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
   (`ruff==0.16.10`, `pytest==9.1.1`). Den Dokumentationsabgleich ausführen,
   Workflows mit Actionlint 1.7.12 validieren, `python -m ruff check .`,
   `python -m ruff format --check .` und `python -m pytest` ausführen.
   Ruff und Pytest werden über `pyproject.toml` konfiguriert.
2. **`hassfest`:** Sobald `custom_components/` existiert, nach erfolgreichem
   `quality` die offizielle Home-Assistant-Hassfest-Action ausführen. Diese
   prüft die Integrationsmetadaten und verwendet das offizielle Hassfest-Image.
   Fehlt der Integrationsordner noch, wird der Job ausdrücklich übersprungen.
3. **`build`:** Erst nach erfolgreichen Qualitätsprüfungen und erfolgreichem
   beziehungsweise mangels Integration übersprungenem Hassfest starten.
   Sobald `frontend/` existiert, Node.js 24 einrichten und in diesem Ordner
   `npm ci`, `npm run lint`, `npm test -- --run` und `npm run build` ausführen.
   `frontend/package-lock.json`, die genannten Skripte und ein nichtleerer
   Buildordner `frontend/dist/` sind dann verpflichtend. Ohne Frontend werden
   nur diese Frontend-Schritte ausdrücklich übersprungen.
4. **Artefakt:** `python scripts/build.py --build-id ci.<Lauf>.<Versuch>`
   erstellt `dist/heizlast-ha-<Version>+ci.<Lauf>.<Versuch>.zip`. Das Archiv wird
   als Actions-Artefakt `heizlast-ha-<Lauf>-<Versuch>` für 14 Tage gespeichert.
   Fehlende Archive gelten als Fehler. Die CI veröffentlicht keine Releases
   und führt keine Merges aus; der vorgeschriebene Review bleibt erforderlich.

### Versionierung und Paketinhalt

- `VERSION` ist die zentrale Projektversion im Format `MAJOR.MINOR.PATCH`,
  zunächst `0.1.0`. Für eine neue Implementierung die Version nach SemVer
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
- Aktuell enthält das Projekt noch keinen Integrations- oder Dashboard-Code.
  Der erste Build ist daher ein Projektarchiv der Entwicklungsgrundlage und
  noch keine installierbare Home-Assistant-Integration.
- Die Tests unter `tests/` prüfen unter anderem Archivinhalt, Versionsfehler,
  erforderliche Frontend-Ausgaben und den Dokumentationsabgleich. Sobald der
  Prototyp implementiert wird, dessen fachliche Tests und erforderliche
  Home-Assistant-Testabhängigkeiten ergänzen und diese CI-Beschreibung anpassen.

### CI-Änderungen immer mitdokumentieren

- **Jede Änderung an der CI-Pipeline muss im selben Commit beziehungsweise
  Pull Request auch diese Beschreibung in `AGENTS.md` aktualisieren.** Das gilt
  insbesondere für Trigger, Jobs, Werkzeuge, Versionen, Befehle, Bedingungen,
  Buildausgaben, Berechtigungen und die Aufbewahrung von Artefakten.
- `scripts/check_ci_docs.py` erzwingt eine Änderung an `AGENTS.md`, wenn sich
  `.github/workflows/`, `.python-version`, `requirements-ci.txt`,
  `pyproject.toml`, `scripts/build.py`, `scripts/check_ci_docs.py`,
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
