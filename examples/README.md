# Handgeprüfter Beispielgrundriss

`ground-floor.json` entspricht `schemas/floorplan-v1.schema.json`. Die Dateien
`ground-floor.png` und `ground-floor.svg` zeigen dieselbe schematische Etage mit
vier Räumen. Für den Import wird PNG verwendet; SVG dient nur als bearbeitbare
Zeichenquelle. Der Bildursprung liegt links oben; x wächst nach rechts und y
nach unten. Die Originalgröße beträgt **1200 × 800 Pixel**.

Die Raumflächen schließen an die inneren Wandkanten an. Die Wände sind 20 Pixel
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

Die Beispielschaltfläche der Dashboard-Karte lädt Bild und JSON gemeinsam.
Für einen manuellen Import die PNG-Datei zuvor hochladen und den ausgegebenen
Bildpfad im Feld `background` einsetzen. Der im Beispiel angegebene Platzhalter
`/local/heizlast-ha/ground-floor.png` wird durch die Bildreferenz der Anwendung
ersetzt; ein extern abgelegtes Bild allein reicht für den validierten Import
nicht aus.

Das JSON Schema prüft Struktur und einfache Wertebereiche. Zusätzliche
Prüfungen beim Import sichern eindeutige stabile IDs, Koordinaten innerhalb der
tatsächlichen Bildgröße, endliche Zahlen und gültige Raumgeometrie. Es dürfen
mehrere Etagen enthalten sein; keine Etage wird beim Import verworfen.
IDs dürfen im gesamten Plan weder zwischen Räumen noch zwischen Etagen und
Räumen doppelt vorkommen. Beim Umbenennen oder Korrigieren eines Raumes bleibt
seine ID erhalten, damit vorhandene Sensorzuordnungen weiter gelten.

Das Format erlaubt bis zu 32 Etagen, 500 Räume je Etage und 500 Eckpunkte je
Raum. Bilder dürfen höchstens 8192 Pixel je Dimension und insgesamt 24 Millionen
Pixel enthalten; größere Pläne müssen vor dem Upload verkleinert werden.

Die PNG-Datei lässt sich aus der SVG-Datei erneut erzeugen: In einer
Python-Umgebung mit Pillow `python examples/render_example.py /pfad/zu/Arial.ttf`
ausführen. Der Renderer berücksichtigt die rechteckigen Flächen und
Beschriftungen dieses Beispiels.
