"""Safely decode and persist user-uploaded floor plan images."""

import base64
import binascii
import os
import tempfile
import warnings
from io import BytesIO
from pathlib import Path
from typing import Any
from uuid import UUID, uuid4

from PIL import Image, ImageOps, UnidentifiedImageError

from .const import (
    IMAGE_PATH,
    MAX_IMAGE_BYTES,
    MAX_IMAGE_DIMENSION,
    MAX_IMAGE_PIXELS,
)
from .validation import ProjectError


def decode_image(name: Any, encoded: Any) -> tuple[bytes, dict[str, Any]]:
    """Validate file content and authoritative dimensions in an executor."""
    if not isinstance(name, str) or not name.strip() or len(name) > 255:
        raise ProjectError("name: Ein Bildname mit höchstens 255 Zeichen ist nötig.")
    if not isinstance(encoded, str) or len(encoded) > ((MAX_IMAGE_BYTES + 2) // 3) * 4:
        raise ProjectError("data: Das Bild darf höchstens 2 MiB groß sein.")
    try:
        data = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError) as err:
        raise ProjectError("data: Ungültige Base64-Bilddaten.") from err
    if not data or len(data) > MAX_IMAGE_BYTES:
        raise ProjectError("data: Das Bild muss 1 Byte bis 2 MiB groß sein.")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(BytesIO(data)) as image:
                image_format = image.format
                width, height = image.size
                if image_format not in ("PNG", "JPEG"):
                    raise ProjectError("data: Nur PNG- und JPEG-Bilder sind erlaubt.")
                if (
                    not (0 < width <= MAX_IMAGE_DIMENSION)
                    or not (0 < height <= MAX_IMAGE_DIMENSION)
                    or width * height > MAX_IMAGE_PIXELS
                ):
                    raise ProjectError(
                        "data: Höchstens 8192 Pixel pro Seite "
                        "und 24 Mio. Pixel erlaubt."
                    )
                if getattr(image, "n_frames", 1) != 1:
                    raise ProjectError(
                        "data: Bitte ein einzelnes, unbewegtes Bild laden."
                    )
                # Verify container checksums and force decoding of all pixel data;
                # merely reading the header also accepts damaged/truncated files.
                image.verify()
            with Image.open(BytesIO(data)) as image:
                image.load()
                orientation = image.getexif().get(274, 1)
                if orientation not in range(1, 9):
                    raise ProjectError("data: Ungültige EXIF-Bildausrichtung.")
                if orientation != 1:
                    # Browsers honor EXIF rotation, while pixel dimensions and an
                    # LLM may otherwise refer to the unrotated raster. Store one
                    # upright image, without an EXIF orientation, for both uses.
                    normalized = ImageOps.exif_transpose(image)
                    width, height = normalized.size
                    output = BytesIO()
                    options = {"quality": 95} if image_format == "JPEG" else {}
                    normalized.save(output, format=image_format, exif=b"", **options)
                    data = output.getvalue()
                    if len(data) > MAX_IMAGE_BYTES:
                        raise ProjectError(
                            "data: Das ausgerichtete Bild überschreitet 2 MiB. "
                            "Bitte kleiner exportieren und erneut laden."
                        )
    except (
        UnidentifiedImageError,
        OSError,
        SyntaxError,
        Image.DecompressionBombWarning,
        Image.DecompressionBombError,
    ) as err:
        raise ProjectError("data: Das Bild ist beschädigt oder nicht lesbar.") from err
    image_id = str(uuid4())
    metadata = {
        "background": f"{IMAGE_PATH}{image_id}",
        "name": name.strip(),
        "width": width,
        "height": height,
        "mime": "image/png" if image_format == "PNG" else "image/jpeg",
    }
    return data, metadata


def image_file(image_dir: Path, background: str) -> Path:
    """Resolve only UUID-based references inside the private upload directory."""
    if not background.startswith(IMAGE_PATH):
        raise ProjectError("background: Ungültige Bildreferenz.")
    image_id = background.removeprefix(IMAGE_PATH)
    try:
        if str(UUID(image_id)) != image_id:
            raise ValueError
    except ValueError as err:
        raise ProjectError("background: Ungültige Bild-ID.") from err
    return image_dir / image_id


def write_image(image_dir: Path, background: str, data: bytes) -> None:
    """Atomically persist a verified image before exposing its metadata."""
    target = image_file(image_dir, background)
    image_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=".upload-", dir=image_dir)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, target)
    finally:
        Path(temporary).unlink(missing_ok=True)


def check_image_file(image_dir: Path, metadata: dict[str, Any]) -> Path | None:
    """Return an existing regular uploaded file and reject symlinks."""
    path = image_file(image_dir, metadata["background"])
    if path.is_symlink() or not path.is_file():
        return None
    return path
