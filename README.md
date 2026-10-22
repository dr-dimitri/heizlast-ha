# heizlast-ha

Home-Assistant-Integration mit einer interaktiven digitalen Grundrisskarte.
Version **0.18.0** öffnet den fest implementierten Grundriss direkt in der
HA-Seitenleiste. Erdgeschoss und Obergeschoss zeigen die aus den Werkplänen
übernommenen Raumkonturen und die belegten Normheizlasten von elf Rechenzonen.
Räume lassen sich anklicken; rechts stehen Fläche, Auslegungstemperatur,
Wärmeverluste, Quellenbelege und vorhandene Temperatursensoren.
Spitzboden und Nebengebäude gehören nicht zur Darstellung.

Die Integration speichert Sensorzuordnungen und feste Raumtemperaturen in
Home Assistant. Raumtemperaturen kommen von zugeordneten Sensoren oder aus
ausdrücklich eingegebenen festen Werten. Dokumentierte Normheizlasten sind
Planungsdaten, keine aktuellen Messwerte. Ohne Sensor oder feste Eingabe
bleibt die Raumtemperatur unbekannt. Jedes Raumlabel zeigt
**aktuelle Temperatur / berechnete Heizlast / aktuelle Heizlast**. Die aktuelle
Heizlast wird aus einem eindeutigen Raumfühlerwert oder einer festen Eingabe,
der Außentemperatur und den dokumentierten Auslegungswerten näherungsweise
berechnet. Wenn aktuelle
Strahlungsdaten vorliegen, werden solare Gewinne nach den belegten
EnEV-Annahmen abgezogen. Das Ergebnis ist mit **≈** gekennzeichnet. Fehlende oder mehrdeutige Temperaturen ergeben **?**.
Eine Heizungssteuerung ist nicht enthalten.

Im Tab **Simulation** werden heute und die folgenden sechs Tage mit
stündlichen Wetterdaten berechnet. Ein Diagramm zeigt pro Stunde die
Heizlast und den nötigen gemeinsamen Vorlauf. Manuelle FBH- und Wetterfelder
entfallen; Raumtemperaturen, Grundriss und Planungsdaten entsprechen Live.

Die Außentemperatur wird über Open-Meteo mit dem in Home Assistant eingestellten
Standort abgefragt: beim Laden der Integration und anschließend alle **30 Minuten**.
Bei Fehlern bleibt der letzte erfolgreiche Wert erhalten; nach weiteren
30 Minuten wird erneut abgefragt. Vor dem ersten erfolgreichen Abruf steht **?**.
Die Integration speichert oder veröffentlicht die Standortkoordinaten nicht.
Die stündlichen Vorhersagen werden über denselben Abruf geladen.
Open-Meteo liefert Wettermodelldaten,
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
  Raumtemperaturen stammen aus tatsächlich zugeordneten Home-Assistant-
  Temperatursensoren oder ausdrücklich eingegebenen festen Werten. Feste Werte
  sind Benutzereingaben, keine Messwerte.

Administratoren können in der Raumauswahl vorhandene Temperatursensoren
zuordnen oder direkt darunter eine **feste Raumtemperatur in °C** eingeben
und die Änderungen ausdrücklich speichern. Ohne Sensor verwendet die aktuelle
Heizlastschätzung diesen festen Wert. Eine leere Eingabe bedeutet „nicht
vorhanden“. Sobald ein Sensor zugeordnet wird, wird der feste Wert gelöscht
und die Eingabe deaktiviert. Sensorwerte haben Vorrang, auch wenn der Sensor
nicht verfügbar ist; nach Entfernen der Zuordnung bleibt die feste Temperatur
leer, bis sie erneut eingegeben wird. Die Zuordnung gilt für die
gesamte Rechenzone; mehrere Sensorwerte erscheinen einzeln. Entfernte oder
nicht verfügbare Sensoren bleiben erkennbar. Normale Benutzer können die
gespeicherten Zuordnungen und Werte ansehen. Zuordnungen und feste Temperaturen
werden zentral in Home Assistant gespeichert und nutzen eine gemeinsame Projekt-Revision, um
gleichzeitige Änderungen nicht zu überschreiben.

Das kompakte Raumlabel zeigt die Temperatur eines eindeutig zugeordneten
verfügbaren Sensors oder ohne Sensor den festen Wert. Die Raumdetails
kennzeichnen feste Werte ausdrücklich als Eingaben. Bei mehreren Sensoren steht
dort **?**; die Einzelwerte
bleiben in den Raumdetails sichtbar. Es werden keine Mittelwerte erzeugt.
Die Außentemperatur erscheint zusätzlich im Dashboard und als Home-Assistant-
Temperatursensor. Nach Abfragefehlern bleibt der letzte Wert verfügbar und
wird auch für die Temperaturabschätzung verwendet.

Neben der Normheizlastsumme zeigt jedes Geschoss die **Summe der aktuellen
Heizlasten** seiner Rechenzonen. Die ungerundeten Raumwerte werden einschließlich
der jeweils verfügbaren Solarkorrektur addiert und erst als Summe gerundet.
Fehlt eine berechenbare Raumheizlast, erscheint **?** mit der Anzahl berechenbarer
Rechenzonen; fehlende Werte werden nicht als 0 W gewertet.

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

Dieser Abschnitt ist die zentrale Modellbeschreibung für Menschen und LLMs.
Alle belegten Gebäudewerte, Fenster-/Solarfaktoren und bestätigten Heizkreise
kommen ausschließlich aus
[`planning-data.json`](custom_components/heizlast_ha/planning-data.json).
[`thermal-model.ts`](frontend/src/thermal-model.ts) enthält die gemeinsame
Verlust- und Solarbilanz für Live und Simulation;
[`simulation-core.ts`](frontend/src/simulation-core.ts) ergänzt das
FBH-Leistungsmodell und dessen Umkehrung zur nötigen Vorlauftemperatur.

Der Tab **Simulation** berechnet einen vollständigen Tag in **Stundenschritten**.
Wählbar sind heute und die folgenden sechs Tage. Das Diagramm zeigt die Summe
der Raumheizlasten in W auf der linken Achse und den nötigen gemeinsamen Vorlauf
in °C auf der rechten Achse. Eine Stundentabelle liefert die genauen Werte,
Außentemperatur und Globalstrahlung. Durch Auswahl einer Stunde zeigen die
unveränderten EG-/OG-Grundrisse die zugehörigen Raumlasten, solaren Gewinne,
FBH-Leistungen und Defizite. Die Tagesenergie in kWh ist die Summe der
stündlichen Bedarfe. Sie bleibt bei Datenlücken unbekannt.

Die stündliche Außentemperatur und Sonneneinstrahlung stammen aus demselben
**Open-Meteo-Abruf** wie die Live-Wetterwerte. Es gibt keine manuellen Wetter-
oder FBH-Einstellungen und keinen synthetischen Monats-Referenztag mehr in der
Oberfläche. Der gemeinsame Abruf erfolgt beim Laden und alle 30 Minuten mit
`current` und `hourly` für Temperatur, GHI, DNI und DHI. Die Abfrage verwendet
UTC-Zeitstempel, einen vergangenen und acht Vorhersagetage als Randpuffer.
Der authentifizierte Leseendpunkt `heizlast_ha/get_weather` liefert ausschließlich
den bereinigten Arbeitsspeicher-Cache, ohne zusätzlichen HTTP-Abruf. Auch Benutzer
mit Leserechten können ihn nutzen. Die Karte liest den Cache bei Taböffnung,
auf Anforderung und während der Simulation einmal pro Minute.

Die [Open-Meteo-Dokumentation](https://open-meteo.com/en/docs) definiert die
Strahlungswerte als Mittel der **vorangegangenen Stunde**. Für ein Intervall
00–01 Uhr verwendet die Rechnung deshalb die Strahlung mit Endzeit 01 Uhr und
das Mittel der Temperaturwerte von 00 und 01 Uhr als angenäherte
Stundentemperatur. Die Fassadenprojektion nutzt denselben Code wie Live:
Astral-Sonnenstand am Intervallmittelpunkt, isotroper Himmel und 20 %
Bodenreflexion. Das ist eine Näherung aus Wettermodelldaten, keine lokale
Fassadenmessung. Die Tagesgrenzen folgen der Home-Assistant-Zeitzone.
Zeitumstellungstage enthalten korrekt 23 oder 25 Stunden; doppelte Uhrzeiten
werden mit ihrem UTC-Versatz unterschieden. Bei Zeitzonen mit halben oder
Viertelstunden werden überlappende UTC-Stunden anteilig gewichtet; fehlen
benötigte Nachbarwerte, bleibt das lokale Stundenintervall unbekannt.

Wetterdaten und Standort verbleiben im Arbeitsspeicher. Standortkoordinaten
kommen ausschließlich aus Home Assistant und werden weder an das Frontend
noch in Entitätsattribute, Logs oder Planungsdaten übernommen. Fehlende oder
ungültige Stunden bleiben Lücken; sie werden weder mit null noch mit manuellen
Wetterannahmen ersetzt. Nach Abruffehlern, Standortänderung oder spätestens
60 Minuten nach dem letzten Abruf sind die betroffenen Vorhersagedaten
unverfügbar. Die unabhängige Prüfung und der Werterhalt der bisherigen
Live-Sensoren bleiben bestehen. Ein Neustart stellt keine Vorhersage wieder her.

Jede Zone verwendet **dieselbe Raumtemperatur wie Live**: genau einen gültigen
Temperatursensor mit Einheitenumrechnung oder, ohne Sensorzuordnung, den festen
Raumtemperaturwert. Sensorvorrang und unbekannte/mehrdeutige Messwerte gelten in
beiden Ansichten gleich. Diese Raumtemperaturen werden für den ausgewählten Tag
konstant gehalten; ihre tatsächliche Entwicklung wird nicht prognostiziert.
Fehlt eine Raumtemperatur, kann kein vollständiger Gebäudevorlauf angegeben
werden. Änderungen der Live-Eingaben oder Sensorwerte aktualisieren die Rechnung.
Die Simulation verändert weder Zuordnungen noch Sensoren oder Planungsdaten.

Für jede Stunde und jeden Raum gilt die gemeinsame temperaturbezogene
Heizlastschätzung abzüglich verfügbarer solaren Gewinne, begrenzt auf 0 W.
Solarüberschüsse bleiben separat und werden nicht auf andere Räume oder
Nachtstunden angerechnet. Die nötige Vorlauftemperatur wird durch Umkehrung des
bestehenden Heizkreismodells bestimmt: die niedrigste gemeinsame Temperatur,
bei der **jeder Raum** seinen Bedarf decken kann. Numerische Intervallsuche und
Aufrunden auf 0,1 °C verhindern, dass der angezeigte Wert unter dem berechneten
Bedarf liegt. Eine Gebäudereserve kann keinen unterversorgten Raum ausgleichen.
Bei Bedarf null steht **Heizung aus**, ohne erfundene Vorlauftemperatur.
Ist die Leistung trotz Suche bis 60 °C unzureichend, steht **Nicht erreichbar**
und die Kurve hat dort keinen Vorlaufwert. Raumdefizite werden bei dieser
Suchgrenze gezeigt. 60 °C ist eine numerische Suchgrenze, keine Betriebsempfehlung;
die Oberflächengrenze bleibt wirksam.

Das gemeinsame Modell übernimmt den belegten Vorlauf-/Rücklaufansatz aus dem
Planungsdatensatz und die bestätigten Raumrohrlängen, Rohrdimension und
Verteiler-/Zuleitungszonen. Unbekannte Anlagenwerte bleiben **feste Annahmen**
des Rechenkerns: 80 % aktive Bodenfläche, Exponent 1,1, maximal 29 °C
Bodenoberfläche, 1,5 l/min je offenem Heizkreis, zusätzlich insgesamt 6 m
Anbindung je Kreis (3 m hin/3 m zurück) und 0,15 m wirksame Heizstreifenbreite
in der nur durch Zuleitungen beheizten OG-Diele. Das ist kein belegter
Verlegeabstand. Diese Werte lassen sich in der Simulation nicht überschreiben.

Die bestehende Kalibrierannahme bleibt Grundlage der Referenzkennlinie:
22 °C innen bei −9 °C außen, solarfrei, mit dem belegten Vorlauf/Rücklauf.
Der höchste Bedarf je angenommener aktiver Raumfläche wird auf volle W/m²
aufgerundet. Die Referenzleistung wird aus der einzigen Datenquelle hergeleitet,
nicht als kopierte Raumtabelle hinterlegt. Die Kalibrierung ist keine Messung;
die Stundenwerte oder Raumtemperaturen kalibrieren die Kennlinie nicht neu.

Jeder Kreis wird separat als **Hinleitung → Raum → Rückleitung** gerechnet.
Die Anbindung bleibt bei Kreisen im Verteilerraum dort; die übrigen Leitungen
werden vereinfachend der jeweiligen Diele zugerechnet. Mehrere Rohrabschnitte
teilen die aktive Fläche proportional zur Länge. In der OG-Diele ergibt sie
sich aus Zuleitungslänge × Heizstreifenbreite, gedeckelt auf Planfläche ×
aktiven Flächenanteil. Flächen und Leitungswärme werden nur einmal bilanziert.
Jeder Abschnitt verwendet die Live-Raumtemperatur seiner Zone und erhält die
Ausgangstemperatur des vorherigen Abschnitts. Die Wasserbilanz verwendet
1 kg/l und 1,163 Wh/(kg K), siehe
[Uponor-Planungshinweise, S. 96](https://brandportal.uponor.com/m/56e67af918404ae3/original/TI-MLCP-Tap-Water-Heating-DE.pdf).
Rohrdimension und Länge liefern den Wasserinhalt, keinen Durchfluss oder
Wärmespeicher. Die Kreise gelten als offen; ein hydraulischer Abgleich und
Thermostatregelung werden nicht berechnet.

Die Kennlinie verwendet die logarithmische Heizmittelübertemperatur. Die
Oberflächenbeziehung `q = 8,92 × max(0, Oberfläche − Raumtemperatur)^1,1`
begrenzt die Wärmeleistung zusätzlich; die Oberfläche darf im Heizbetrieb
auch die logarithmische Heizmitteltemperatur nicht überschreiten. Die
[Uponor-Basiskennlinie](https://www.uponor.com/de-de/unternehmen/presse/fachbeitraege/fa-uponor-klett-auslegung)
und [Planungshinweise, S. 23](https://brandportal.uponor.com/m/19769cf862d8a19a/original/Uponor-TI-planning-principles-UFHC-GER.pdf)
erläutern diese Beziehungen. Bodenaufbau, Belag, tatsächlicher Verlegeabstand,
Wärmeverluste nach unten, interne Gewinne und wechselnde Lüftung bleiben
unberücksichtigt. Ohne positive Heizmittelübertemperatur wird keine Heizleistung
behauptet. Die Raumoberfläche ist der höchste Segmentwert, der Rücklauf das
Mittel der beteiligten Kreise.

Die Kurve ist eine Folge **stationärer Leistungsberechnungen**, keine
Aufheizzeit-, Raumtemperatur- oder Verbrauchsprognose und keine reale
Heizungssteuerung. Die mögliche FBH-Leistung ist verfügbare Kapazität.
Wärmespeicherung und dynamische Regelung werden nicht modelliert; Ergebnisse
tragen deshalb das Näherungszeichen **≈**.

### Rechenkern für weitere Simulationen

`simulateHeatingDay(data, hours, temperatures)` nimmt strukturelle Planungsdaten,
zeitlich zusammenhängende Stunden mit Wetterwerten und eine Temperaturzuordnung
je Zone entgegen. Das Ergebnis enthält Stundenstatus, Raum- und Kreiswerte,
Heizlast, nötigen Vorlauf und vollständige Tagesenergie. Der Kern importiert
weder JSON noch DOM-/HA-APIs, führt keine Netzabrufe aus und verändert seine
Eingaben nicht. Die bisherigen isolierten Szenariofunktionen bleiben für
fachliche Kernprüfungen nutzbar; die Dashboardansicht verwendet ausschließlich
die wetterbasierte Tagesrechnung mit den gemeinsamen festen FBH-Annahmen.

## Daten und Speicherung

Der feste Grundriss liegt mit seinen belegten Heizlasten und neutralen
Quellenbelegen in `custom_components/heizlast_ha/planning-data.json`.
Die Integration liefert keinen Zeicheneditor, JSON-Import, LLM-Prompt oder
Speicherendpunkt für eigene Raumgeometrie aus. Über die authentifizierte API
können ausschließlich Sensorzuordnungen und feste Raumtemperaturen der elf
festen Rechenzonen verändert werden. Die API liefert `revision`,
`planning_bindings` und `planning_temperatures`; der bestehende administrative
Speicherbefehl akzeptiert zusätzlich das optionale Feld `temperatures`.
Diese Werte sind Benutzerkonfiguration und verändern keine Planungsdaten.
Normale Benutzer erhalten nur Lesezugriff.

Sensorzuordnungen und feste Raumtemperaturen werden über Home Assistants
Storage-Helfer im Konfigurationsverzeichnis unter `.storage` gespeichert. Das
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
