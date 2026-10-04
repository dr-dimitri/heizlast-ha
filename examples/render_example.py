"""Render the simple SVG source with Pillow, preserving its pixel geometry."""

from pathlib import Path
from xml.etree import ElementTree

from PIL import Image, ImageDraw, ImageFont


def render(source: Path, font_path: Path) -> None:
    """Render this example's rectangles and labels at their original resolution."""
    document = ElementTree.parse(source).getroot()
    image = Image.new(
        "RGB", (int(document.attrib["width"]), int(document.attrib["height"]))
    )
    drawing = ImageDraw.Draw(image)

    def draw(element, inherited):
        attributes = inherited | element.attrib
        tag = element.tag.rsplit("}", 1)[-1]
        if tag == "rect":
            left = int(attributes.get("x", 0))
            top = int(attributes.get("y", 0))
            right = left + int(attributes["width"])
            bottom = top + int(attributes["height"])
            drawing.rectangle(
                (left, top, right - 1, bottom - 1), fill=attributes["fill"]
            )
        elif tag == "text":
            font = ImageFont.truetype(str(font_path), int(attributes["font-size"]))
            anchor = "ms" if attributes.get("text-anchor") == "middle" else "ls"
            drawing.text(
                (int(attributes["x"]), int(attributes["y"])),
                element.text,
                fill=attributes["fill"],
                font=font,
                anchor=anchor,
            )
        for child in element:
            draw(child, attributes)

    draw(document, {})
    image.save(source.with_suffix(".png"))


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("font", type=Path, help="Path to an Arial-compatible TTF")
    arguments = parser.parse_args()
    render(Path(__file__).with_name("ground-floor.svg"), arguments.font)
