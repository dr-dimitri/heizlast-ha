# heizlast-ha

Home-Assistant-Integration mit einer interaktiven digitalen Grundrisskarte.
Version **0.13.0** öffnet den fest implementierten Grundriss direkt in der
HA-Seitenleiste. Erdgeschoss und Obergeschoss zeigen die aus den Werkplänen
übernommenen Raumkonturen und die belegten Normheizlasten von elf Rechenzonen.
Räume lassen sich anklicken; rechts stehen Fläche, Auslegungstemperatur,
Wärmeverluste, Quellenbelege und vorhandene Temperatursensoren.
Spitzboden und Nebengebäude gehören nicht zur Darstellung.

Die Integration speichert die Sensorzuordnungen in Home Assistant.
Raumtemperaturen kommen direkt von den vorhandenen Sensoren. Dokumentierte
Normheizlasten sind Planungsdaten, keine aktuellen Messwerte. Ohne Sensorzuordnung
werden keine Raumtemperaturen vorgetäuscht. Jedes Raumlabel zeigt
**aktuelle Temperatur / berechnete Heizlast / aktuelle Heizlast**. Die aktuelle
Heizlast wird aus einem eindeutig zugeordneten Raumfühler, der Außentemperatur
und den dokumentierten Auslegungswerten näherungsweise berechnet. Wenn aktuelle
Strahlungsdaten vorliegen, werden solare Gewinne nach den belegten
EnEV-Annahmen abgezogen. Das Ergebnis ist mit **≈** gekennzeichnet. Fehlende oder mehrdeutige Temperaturen ergeben **?**.
Eine Heizungssteuerung ist nicht enthalten.

Im zusätzlichen Tab **Simulation** lassen sich Vorlauf, gewünschte
Innentemperatur, Außentemperatur und **sonnig/bewölkt** verändern. Live-Ansicht
und Simulation verwenden denselben Grundriss und dieselben Planungsdaten.

Die Außentemperatur wird über Open-Meteo mit dem in Home Assistant eingestellten
Standort abgefragt: beim Laden der Integration und anschließend alle **30 Minuten**.
Bei Fehlern bleibt der letzte erfolgreiche Wert erhalten; nach weiteren
30 Minuten wird erneut abgefragt. Vor dem ersten erfolgreichen Abruf steht **?**.
Die Standortkoordinaten werden ausschließlich für diese HTTPS-Abfrage verwendet
und nicht mit dem Dashboard ausgeliefert. Open-Meteo liefert Wettermodelldaten,
keine lokale Sensormessung. Quelle: [Open-Meteo](https://open-meteo.com/).

Derselbe Abruf liefert außerdem Globalstrahlung, direkte Normalstrahlung und
diffuse Strahlung als Home-Assistant-Sensoren in **W/m²**. Das Dashboard zeigt
die horizontale Globalstrahlung als **Sonneneinstrahlung**. Die einzelnen Felder
werden unabhängig geprüft; ein fehlender Strahlungswert verhindert keine
Temperaturaktualisierung. Nach Fehlern bleiben die jeweiligen letzten gültigen
Werte erhalten, auch nach einem Neustart. Die Entitäten enthalten den
Gültigkeitszeitpunkt und gegebenenfalls das Mittelungsintervall aus der
API-Antwort. Die Globalstrahlungsentität liefert zusätzlich berechnete
Einstrahlung auf die vier senkrechten Fassaden. Diese Attribute werden nur aus
allen drei gültigen Strahlungsfeldern desselben Abrufs mit gültigem Zeitbezug
berechnet; alte oder unvollständige Daten erhalten keine Solarkorrektur.
Bei `current` bezieht sich Strahlung gewöhnlich auf die vorherigen
15 Minuten, nicht auf den 30-Minuten-Abfragetakt.
[API und Zeitbezug](https://open-meteo.com/en/docs).

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

Alle Raumnamen verwenden dieselbe Schriftfamilie und Schriftgröße. Die
Wertezeile darunter ist halb so groß; Texte werden nicht raumweise gestreckt.

- Wohnen/Essen/Küche bilden einen offenen Bereich mit einer gemeinsamen
  Heizlast und einem einzelnen Label **Wohnen und Essen**. Zone 4 ist als
  **Diele** beschriftet. Schlafen und Ankleide
  bilden eine zusammenhängende Kontur **Schlafzimmer** mit dem bisherigen
  gemeinsamen Heizlastwert.
- Die Zuordnung des Bads zur berechneten Zone 7 ist bestätigt. Seine
  unbeschriftete Planfläche bleibt unbekannt;
  12,74 m² und 641,59 W sind belegte Berechnungswerte, keine aus der Kontur
  abgeleiteten Zahlen.
- Die Gebäude-Normheizlast beträgt **5.989 W**, die Raumheizlastsumme
  **7.354,5 W**. Die Berechnung berücksichtigt Lüftungsverluste auf Gebäudeebene
  nur hälftig. Beide Werte werden entsprechend getrennt beschriftet.
- Die belegte Norm-Außentemperatur beträgt **−12,2 °C**
  (**Heizlastberechnung**, Seite 2 / G1). Auslegungstemperaturen innen von
  22 °C beziehungsweise 24 °C sind Berechnungsannahmen. Aktuelle
  Raumtemperaturen stammen ausschließlich aus
  tatsächlich zugeordneten Home-Assistant-Temperatursensoren.

Administratoren können in der Raumauswahl vorhandene Temperatursensoren
zuordnen und die Auswahl ausdrücklich speichern. Die Zuordnung gilt für die
gesamte Rechenzone; mehrere Sensorwerte erscheinen einzeln. Entfernte oder
nicht verfügbare Sensoren bleiben erkennbar. Normale Benutzer können die
gespeicherten Zuordnungen und Werte ansehen. Die Zuordnungen werden zentral in
Home Assistant gespeichert und nutzen eine gemeinsame Projekt-Revision, um
gleichzeitige Änderungen nicht zu überschreiben.

Das kompakte Raumlabel zeigt die Temperatur eines eindeutig zugeordneten
verfügbaren Sensors. Bei mehreren Sensoren steht dort **?**; die Einzelwerte
bleiben in den Raumdetails sichtbar. Es werden keine Mittelwerte erzeugt.
Die Außentemperatur erscheint zusätzlich im Dashboard und als Home-Assistant-
Temperatursensor. Nach Abfragefehlern bleibt der letzte Wert verfügbar und
wird auch für die Temperaturabschätzung verwendet.

Die temperaturbasierte Schätzung verwendet
`Normheizlast × max(0, Raumtemperatur − Außentemperatur) / (Auslegung innen − Auslegung außen)`.
Temperaturen werden dazu aus °C, °F oder K in °C umgerechnet. Außenluft mit
gleicher oder höherer Temperatur als der Raum ergibt 0 W; bei kälteren
Bedingungen kann die Schätzung über der Normheizlast liegen.

Solare Gewinne werden je Raum aus den zugeordneten Fensterbauteilflächen und
aktueller Fassadeneinstrahlung berechnet. Der **EnEV-Nachweis, Abschnitt 5.3,
Seiten 5–6**, belegt g-Wert **0,50**, Rahmenfaktor **0,70** (wirksamer Glasanteil),
Verschattung **0,90**, Sonnenschutz **1,00** und Einfallsfaktor **0,90**.
Das Produkt beträgt 0,2835. Die Fassadensummen aus der Heizlastberechnung
stimmen innerhalb der Quellenrundung mit den EnEV-Werten überein:
Süd 23,30 m², Ost 5,83 m², Nord 8,30 m², West 12,33 m².
Die südlichen verglasten Außentüren von Wohnen/Essen sind darin enthalten;
die Eingangstür ist keine Solarfläche. Die letzte westliche Fensterfläche
von Wohnen/Essen wird aus dem Außenwandabzug und dem Summenabgleich zugeordnet.

Die Fassadeneinstrahlung wird mit Sonnenstand am Mittelpunkt des API-Intervalls,
direkter Normalstrahlung, diffuser Strahlung, isotropem Himmel und 20 %
Bodenreflexion angenähert. Sie entspricht keiner lokalen Fassadenmessung.
Die temperaturbasierte Heizlastschätzung wird um solare Gewinne reduziert, mindestens
auf 0 W. Der aktuelle Rollladenstatus wird nicht erfasst; die dokumentierten
Verschattungs- und Sonnenschutzfaktoren sind Planungsannahmen.

Wenn Strahlungswerte, Zeitbezug oder Einheiten fehlen oder die API-Zeit mehr als
60 Minuten zurückliegt, werden Fassadenattribute entfernt. Ein zusätzlicher
Timer entfernt sie auch dann rechtzeitig, wenn sie vor der nächsten
30-Minuten-Abfrage veralten. In diesem Fall
zeigt das Dashboard die temperaturbasierte Näherung mit entsprechendem Hinweis.
Die Roh-Strahlungswerte bleiben nach Fehlern sichtbar. Beim Neustart werden
nur Rohwerte und ihre Zeitmetadaten wiederhergestellt, keine alte Solarkorrektur.
Interne Gewinne, veränderte Nachbarraumtemperaturen, wechselnde Lüftung und
Wärmespeicherung bleiben unberücksichtigt.

Der mitgelieferte Datensatz
[`planning-data.json`](custom_components/heizlast_ha/planning-data.json)
enthält ausschließlich benötigte fachliche Daten und neutrale Quellenbelege
wie **Plan EG**, **Plan OG** und **Heizlastberechnung** mit Blatt-/Seitennummern.
Personenangaben aus den Quelldokumenten, Ort, Postleitzahl, persönliche
Originaldateinamen, Benutzerpfade und Original-PDFs werden nicht ausgeliefert.
Ausdrücklich gewünschte Anzeigenamen werden ausschließlich als Raumlabel
übernommen.

## Simulation der Fußbodenheizung

Dieser Abschnitt ist die zentrale fachliche Modellbeschreibung für Menschen
und LLMs. `AGENTS.md` verweist verbindlich darauf. Belegte Zahlen und
Quellen werden ausschließlich aus
[`planning-data.json`](custom_components/heizlast_ha/planning-data.json)
gelesen; die ausführbare Modellspezifikation liegt in
[`simulation-core.ts`](frontend/src/simulation-core.ts) und
[`thermal-model.ts`](frontend/src/thermal-model.ts). Bei Abweichungen die
Dokumentation mit den maßgeblichen Quellen abgleichen, keine Datenkopie anlegen.

Der Tab **Simulation** vergleicht den Wärmebedarf mit der möglichen
Fußbodenheizungsleistung bei einem gemeinsamen Raumtemperaturziel. Vorlauf,
Innentemperatur und Außentemperatur sind veränderbar; **sonnig** und
**bewölkt** wählen zwei einstellbare Strahlungsszenarien. Erdgeschoss,
Obergeschoss und anklickbare Räume verwenden denselben Planrenderer wie
**Live**. Pro Raum erscheinen Wärmebedarf, mögliche FBH-Leistung und
Leistungsreserve beziehungsweise Defizit. Die Details zeigen zusätzlich
solare Gewinne, aktive Heizfläche und angenäherte Bodenoberflächentemperatur.
Eine positive Gesamtbilanz kann Defizite einzelner Räume nicht ausgleichen.

Die Berechnung verwendet die vorhandenen Normheizlasten,
Auslegungstemperaturen, Raumflächen, Fensterflächen und EnEV-Solarfaktoren
direkt aus **derselben `planning-data.json`**. Es gibt keinen zweiten
Simulationsdatensatz. Der dort ergänzte EnEV-Planungsansatz **35/28 °C**
für Vorlauf/Rücklauf ist auf Seiten 8 und 10 belegt und liefert die
Starttemperatur und 7 K Spreizung. Er ist keine aktuelle Anlagenmessung.

Unter **Modellannahmen** sind die nicht belegten Startannahmen einstellbar:
80 % aktive Fußbodenfläche, 50 W/m² Referenzleistung bei zunächst
35/28 °C und angenommenen 20 °C Raumtemperatur, Kennlinienexponent 1,1
und 29 °C maximale Bodenoberfläche. Die Spreizung am Referenzpunkt ist
ebenfalls einstellbar; ihre Änderung verändert den angenommenen
Referenzrücklauf. Das Wassermodell verwendet die logarithmische
Heizmittelübertemperatur. Die Referenzleistung wird mit dem Verhältnis
dieser Übertemperatur zur Referenzübertemperatur potenziert.
Aus Referenzleistung und Referenzspreizung wird ein konstanter spezifischer
Durchfluss angenommen. Leistung und aktueller Rücklauf werden gemeinsam
gelöst; bei niedrigerem Vorlauf wird keine unveränderte 7-K-Abkühlung
bis unter die Raumtemperatur behauptet. Vorlauf auf oder unter dem
Raumtemperaturziel ergibt keine Heizleistung.
Die Leistung wird zusätzlich durch die Oberflächenkennlinie
`q = 8,92 × max(0, Bodenoberfläche − Raumtemperatur)^1,1` begrenzt.
Im positiven Heizbetrieb darf die berechnete Bodenoberfläche weder die
eingestellte Grenze noch die logarithmische Heizmitteltemperatur überschreiten. Physikalisch
unmögliche Referenzkombinationen liefern einen Eingabefehler.
Diese Oberflächenbeziehung ist fachlich belegt;
[Uponor erläutert die Basiskennlinie](https://www.uponor.com/de-de/unternehmen/presse/fachbeitraege/fa-uponor-klett-auslegung).
Die logarithmische Übertemperatur und die üblichen Oberflächengrenzen
werden in den [Uponor-Planungshinweisen, S. 23](https://brandportal.uponor.com/m/19769cf862d8a19a/original/Uponor-TI-planning-principles-UFHC-GER.pdf)
erläutert. Die Wasserkennlinie, der Referenzwert, der aktive Flächenanteil
und der spezifische Durchfluss sind ausdrücklich vereinfachende
Modellannahmen. Rohrabstand, Bodenbelag,
Wassermenge und eine herstellerspezifische Auslegung liegen nicht vor.

Die Wetterszenarien starten mit 700 W/m² direkter Normalstrahlung und
100 W/m² diffuser Strahlung bei **sonnig**, beziehungsweise ohne direkte
Strahlung und mit 150 W/m² diffuser Strahlung bei **bewölkt**. Sonnenhöhe
45°, Sonnenrichtung Süd (180°) und 20 % Bodenreflexion sind ebenfalls
einstellbare Szenarioannahmen. Daraus wird die Einstrahlung auf N/O/S/W
berechnet und mit den gemeinsamen Raumfensterflächen und Solarfaktoren
verknüpft. Diese Szenarien benötigen keine aktuellen Wetterwerte oder
Temperatursensoren. Simulationsergebnisse sind mit **≈** gekennzeichnet.

Die Simulation ist ein stationärer Leistungsvergleich, keine Prognose
der Aufheizdauer oder der tatsächlichen Raumtemperatur. Die dargestellte
Leistungsreserve bezeichnet verfügbare Heizkapazität, keinen gemessenen
Verbrauch. Thermostatregelung, Wärmespeicherung, interne Gewinne und
wechselnde Lüftung sind nicht modelliert. Die Eingaben bleiben beim
Tab- und Geschosswechsel erhalten und werden nicht in Home Assistant
gespeichert. Sie sind auch für Benutzer mit Leserechten bedienbar und
verändern weder Sensorwerte noch Sensorzuordnungen.

### Rechenkern für weitere Simulationen

`frontend/src/thermal-model.ts` enthält die gemeinsamen Verlust- und
Solargewinnfunktionen für Live-Ansicht und Simulation.
`frontend/src/simulation-core.ts` ergänzt Strahlungsszenarien und
Fußbodenheizungsleistung. Beide Module sind reine TypeScript-Funktionen:
kein DOM, keine Home-Assistant-Verbindung, kein Netzabruf und kein
Import des projektspezifischen Datensatzes. Der Aufrufer übergibt die
Planungsdaten und die Szenarioannahmen; die Funktionen verändern sie nicht.

```ts
import { planningData } from "./planning-types";
import {
  defaultSimulationScenario, defaultSimulationParameters, simulateBuilding,
} from "./simulation-core";

const scenario = defaultSimulationScenario(planningData);
const parameters = defaultSimulationParameters(planningData);
const result = simulateBuilding(planningData, scenario, parameters);
```

Das Ergebnis enthält Raumwerte und Summen. Ungültige Eingaben liefern
Feldfehler und keine scheinbar gültigen Nullwerte. Andere Oberflächen
können denselben Kern mit eigenen strukturell passenden Eingaben verwenden.

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
