# heizlast-ha

Home-Assistant-Projekt zur späteren Berechnung des aktuellen Wärmebedarfs eines
Gebäudes mit einem interaktiven Grundriss und raumweise zugeordneten Sensoren.
Der Prototyp ist in [Issue #1](https://github.com/dr-dimitri/heizlast-ha/issues/1)
beschrieben. Aktuell enthält das Repository die CI- und Buildgrundlage;
Integration und Dashboard werden noch implementiert.

## Entwicklung und CI

Python 3.14 verwenden. Die Qualitätsprüfungen und der lokale Build lassen sich
wie folgt ausführen:

```sh
python -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements-ci.txt
python -m ruff check .
python -m ruff format --check .
python -m pytest
python scripts/build.py
```

Der Build erzeugt ein versioniertes Projektarchiv in `dist/`. Er nimmt nur mit
Git verwaltete Dateien auf; neue Dateien vor dem lokalen Build mit `git add`
vormerken. Solange der Prototyp fehlt, ist dieses Archiv noch keine installierbare
Home-Assistant-Integration.

Die GitHub-CI prüft Pull Requests nach `main` sowie Änderungen auf `main` und
kann manuell gestartet werden. Ihre verbindliche Beschreibung, die geplanten
Integrations-/Frontendpfade und die Pflicht zur synchronen Dokumentation stehen
in [AGENTS.md](AGENTS.md). Build-Archive stehen im jeweiligen Actions-Lauf für
14 Tage zum Download bereit.
