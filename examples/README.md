# Handgeprüfter Beispielgrundriss

`ground-floor.json` entspricht `schemas/floorplan-v1.schema.json`. Die Dateien
`ground-floor.png` und `ground-floor.svg` zeigen dieselbe schematische Etage mit
vier Räumen. Für den Import genügt die JSON-Datei; PNG und SVG dienen nur als
Ansicht und bearbeitbare Zeichenquelle. Der Koordinatenursprung liegt links oben; x wächst nach rechts und y
nach unten. Die Zeichenfläche beträgt **1200 × 800 Einheiten**.

Die Raumflächen schließen an die inneren Wandkanten an. Die Wände sind 20 Einheiten
breit, zwischen den Polygonen liegt damit ein nicht auswählbarer Wandbereich.
Es gibt keine überlappenden Raumflächen:

| Raum | Linke obere Ecke | Rechte untere Ecke |
| --- | --- | --- |
| Wohnzimmer | (110, 110) | (590, 690) |
| Küche | (610, 110) | (1090, 350) |
| Flur | (610, 370) | (1090, 480) |
| Bad | (610, 500) | (1090, 690) |

Das Polygon schließt sich vom letzten zum ersten Punkt automatisch. Der erste
Punkt wird nicht am Ende wiederholt. Der Plan enthält keinen metrischen
Maßstab, deshalb sind alle Flächenangaben `area_m2: null`.

Die Beispielschaltfläche der Dashboard-Karte lädt ausschließlich das JSON
als Vorschau. Für einen manuellen Import `ground-floor.json` direkt verwenden;
ein Bild-Upload und ein `background`-Feld entfallen. Das Format `1.1` enthält
alle Daten für die eigenständige Darstellung der Raumkonturen.

Das JSON Schema prüft Struktur und einfache Wertebereiche. Zusätzliche
Prüfungen beim Import sichern eindeutige stabile IDs, Koordinaten innerhalb der
angegebenen Zeichenfläche, endliche Zahlen und gültige Raumgeometrie. Es dürfen
mehrere Etagen enthalten sein; keine Etage wird beim Import verworfen.
IDs dürfen im gesamten Plan weder zwischen Räumen noch zwischen Etagen und
Räumen doppelt vorkommen. Beim Umbenennen oder Korrigieren eines Raumes bleibt
seine ID erhalten, damit vorhandene Sensorzuordnungen weiter gelten.

Das Format erlaubt bis zu 32 Etagen, 500 Räume je Etage und 500 Eckpunkte je
Raum. Die Zeichenfläche erlaubt höchstens 8192 Einheiten je Dimension.

Die PNG-Datei lässt sich aus der SVG-Datei erneut erzeugen: In einer
Python-Umgebung mit Pillow `python examples/render_example.py /pfad/zu/Arial.ttf`
ausführen. Der Renderer berücksichtigt die rechteckigen Flächen und
Beschriftungen dieses Beispiels.
