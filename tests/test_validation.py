"""Tests for authoritative backend schema, geometry, sensors, and uploads."""

import base64
import math
from copy import deepcopy
from io import BytesIO

import pytest
from homeassistant.core import State
from PIL import Image

from custom_components.heizlast_ha.const import IMAGE_PATH, MAX_IMAGE_BYTES
from custom_components.heizlast_ha.images import (
    check_image_file,
    decode_image,
    image_file,
    write_image,
)
from custom_components.heizlast_ha.validation import (
    ProjectError,
    is_temperature_state,
    load_validator,
    validate_bindings,
    validate_plan,
    validate_removals,
)

BACKGROUND = f"{IMAGE_PATH}12345678-1234-1234-1234-123456789abc"
IMAGES = [
    {
        "background": BACKGROUND,
        "name": "Testplan.png",
        "width": 100,
        "height": 100,
        "mime": "image/png",
    }
]


@pytest.fixture
def validator():
    """Use the exact installed interchange schema."""
    return load_validator()


@pytest.fixture
def plan():
    """Two adjacent rooms with a shared boundary and no positive overlap."""
    return {
        "schema_version": "1.0",
        "floors": [
            {
                "id": "eg",
                "name": "Erdgeschoss",
                "background": BACKGROUND,
                "canvas": {"width": 100, "height": 100},
                "rooms": [
                    {
                        "id": "eg_links",
                        "name": "Links",
                        "polygon": [[0, 0], [50, 0], [50, 100], [0, 100]],
                        "area_m2": None,
                    },
                    {
                        "id": "eg_rechts",
                        "name": "Rechts",
                        "polygon": [[50, 0], [100, 0], [100, 100], [50, 100]],
                        "area_m2": 21.5,
                    },
                ],
            }
        ],
    }


def test_plan_is_validated_and_copied(plan, validator):
    """Shared room edges are valid, and caller mutations cannot affect saved plans."""
    checked = validate_plan(plan, IMAGES, validator)
    assert checked == plan
    checked["floors"][0]["rooms"][0]["name"] = "Bearbeitet"
    assert plan["floors"][0]["rooms"][0]["name"] == "Links"


@pytest.mark.parametrize("version", ["0.1", "2.0", 1.0, None])
def test_unsupported_schema_versions(plan, validator, version):
    plan["schema_version"] = version
    with pytest.raises(ProjectError, match="schema_version"):
        validate_plan(plan, IMAGES, validator)


@pytest.mark.parametrize("coordinate", [math.nan, math.inf, -math.inf, -1, 101, True])
def test_invalid_coordinates(plan, validator, coordinate):
    plan["floors"][0]["rooms"][0]["polygon"][0][0] = coordinate
    with pytest.raises(ProjectError):
        validate_plan(plan, IMAGES, validator)


@pytest.mark.parametrize(
    "polygon",
    [
        [[0, 0], [0, 0], [50, 50]],
        [[0, 0], [10, 10], [20, 20]],
        [[0, 0], [50, 50], [0, 50], [50, 0]],
        [[0, 0], [50, 0], [0, 50], [0, 0]],
        [[0, 0], [0.00001, 0], [0, 0.00001]],
    ],
)
def test_invalid_or_degenerate_polygons(plan, validator, polygon):
    plan["floors"][0]["rooms"][0]["polygon"] = polygon
    with pytest.raises(ProjectError):
        validate_plan(plan, IMAGES, validator)


def test_contained_room_overlap_is_rejected(plan, validator):
    """Containment must be rejected as well as crossing room boundaries."""
    plan["floors"][0]["rooms"][1]["polygon"] = [[10, 10], [30, 10], [30, 30], [10, 30]]
    with pytest.raises(ProjectError, match="eg_links.*eg_rechts.*überlappen"):
        validate_plan(plan, IMAGES, validator)


def test_identical_room_overlap_is_rejected(plan, validator):
    """Equal polygons have positive overlap although edges only coincide."""
    plan["floors"][0]["rooms"][1]["polygon"] = deepcopy(
        plan["floors"][0]["rooms"][0]["polygon"]
    )
    with pytest.raises(ProjectError, match="überlappen"):
        validate_plan(plan, IMAGES, validator)


def test_crossing_room_overlap_is_rejected(plan, validator):
    plan["floors"][0]["rooms"][1]["polygon"] = [[40, 20], [60, 20], [60, 80], [40, 80]]
    with pytest.raises(ProjectError, match="überlappen"):
        validate_plan(plan, IMAGES, validator)


def test_concave_non_overlapping_rooms_are_valid(plan, validator):
    """A room may wrap around another one without their interiors intersecting."""
    plan["floors"][0]["rooms"][0]["polygon"] = [
        [0, 0],
        [50, 0],
        [50, 10],
        [10, 10],
        [10, 50],
        [0, 50],
    ]
    plan["floors"][0]["rooms"][1]["polygon"] = [[20, 20], [40, 20], [40, 40], [20, 40]]
    assert validate_plan(plan, IMAGES, validator) == plan


def test_multiple_floors_preserve_all_rooms(plan, validator):
    upper = deepcopy(plan["floors"][0])
    upper.update(id="og", name="Obergeschoss")
    for room in upper["rooms"]:
        room["id"] = room["id"].replace("eg_", "og_")
    plan["floors"].append(upper)
    assert validate_plan(plan, IMAGES, validator) == plan


@pytest.mark.parametrize("duplicate", ["room", "floor", "cross_floor", "floor_room"])
def test_ids_are_globally_unique(plan, validator, duplicate):
    if duplicate == "room":
        plan["floors"][0]["rooms"][1]["id"] = "eg_links"
    elif duplicate == "floor_room":
        plan["floors"][0]["rooms"][1]["id"] = "eg"
    else:
        upper = deepcopy(plan["floors"][0])
        upper["id"] = "og" if duplicate == "cross_floor" else "eg"
        plan["floors"].append(upper)
    with pytest.raises(ProjectError, match="Doppelte ID"):
        validate_plan(plan, IMAGES, validator)


def test_unknown_image_and_incorrect_dimensions(plan, validator):
    with pytest.raises(ProjectError, match="Hintergrundbild"):
        validate_plan(plan, [], validator)
    plan["floors"][0]["canvas"]["width"] = 99
    with pytest.raises(ProjectError, match="100 × 100"):
        validate_plan(plan, IMAGES, validator)


@pytest.mark.parametrize("name", ["", " ", "\n\t"])
def test_room_names_must_be_visible(plan, validator, name):
    plan["floors"][0]["rooms"][0]["name"] = name
    with pytest.raises(ProjectError):
        validate_plan(plan, IMAGES, validator)


@pytest.mark.parametrize("area", [0, -1, math.nan, math.inf, True])
def test_area_must_be_unknown_or_finite_and_positive(plan, validator, area):
    plan["floors"][0]["rooms"][0]["area_m2"] = area
    with pytest.raises(ProjectError):
        validate_plan(plan, IMAGES, validator)


def test_bindings_preserve_stable_ids_and_later_removed_entities(plan):
    previous = {"eg_links": ["sensor.deleted"]}
    bindings = {"eg_rechts": ["sensor.new"]}
    assert validate_bindings(plan, bindings, previous, lambda _: True) == {
        "eg_links": ["sensor.deleted"],
        "eg_rechts": ["sensor.new"],
    }
    assert (
        validate_bindings(plan, {"eg_links": []}, previous, lambda _: False)["eg_links"]
        == []
    )


@pytest.mark.parametrize(
    "bindings",
    [
        {"unknown_room": []},
        {"eg_links": ["sensor.not_temperature"]},
        {"eg_links": ["light.room"]},
        {"eg_links": [None]},
        {"eg_links": "sensor.foo"},
        {"eg_links": ["sensor.foo", "sensor.foo"]},
    ],
)
def test_invalid_new_bindings(plan, bindings):
    with pytest.raises(ProjectError):
        validate_bindings(plan, bindings, {}, lambda _: False)


def test_existing_entity_cannot_be_moved_to_new_room_without_validation(plan):
    with pytest.raises(ProjectError, match="Temperatur"):
        validate_bindings(
            plan,
            {"eg_rechts": ["sensor.deleted"]},
            {"eg_links": ["sensor.deleted"]},
            lambda _: False,
        )


def test_removal_needs_explicit_confirmation(plan):
    revised = deepcopy(plan)
    revised["floors"][0]["rooms"].pop()
    with pytest.raises(ProjectError, match="eg_rechts") as error:
        validate_removals(plan, revised, [])
    assert error.value.code == "confirmation_required"
    validate_removals(plan, revised, ["eg_rechts"])
    validate_removals(plan, plan, [])


def test_temperature_state_uses_device_class_not_unit_or_numeric_value():
    """Unavailable temperatures remain selectable by their device class."""
    temperature = State("sensor.t", "unavailable", {"device_class": "temperature"})
    assert is_temperature_state("sensor.t", temperature)
    assert not is_temperature_state("sensor.t", None)
    assert not is_temperature_state("sensor.t", State("sensor.t", "23", {}))
    assert not is_temperature_state("number.t", temperature)


@pytest.mark.parametrize(
    "image_format,mime", [("PNG", "image/png"), ("JPEG", "image/jpeg")]
)
def test_image_upload_verifies_content_and_persists(tmp_path, image_format, mime):
    output = BytesIO()
    Image.new("RGB", (80, 60)).save(output, format=image_format)
    encoded = base64.b64encode(output.getvalue()).decode()
    data, metadata = decode_image(" Original.jpg ", encoded)
    assert metadata["width"] == 80
    assert metadata["height"] == 60
    assert metadata["mime"] == mime
    assert metadata["name"] == "Original.jpg"
    write_image(tmp_path, metadata["background"], data)
    path = check_image_file(tmp_path, metadata)
    assert path.read_bytes() == output.getvalue()
    assert list(tmp_path.iterdir()) == [path]


@pytest.mark.parametrize("encoded", ["", "!!!", "data:image/png;base64,AAAA", "AA=="])
def test_invalid_encoded_images(encoded):
    with pytest.raises(ProjectError):
        decode_image("plan.png", encoded)


def test_oversized_image_rejected_before_decoding():
    encoded = "a" * (4 * ((MAX_IMAGE_BYTES + 2) // 3) + 4)
    with pytest.raises(ProjectError, match="2 MiB"):
        decode_image("plan.png", encoded)


def test_large_uncompressed_dimensions_rejected():
    output = BytesIO()
    Image.new("RGB", (8193, 1)).save(output, format="PNG")
    with pytest.raises(ProjectError, match="8192"):
        decode_image("large.png", base64.b64encode(output.getvalue()).decode())


def test_unsupported_and_truncated_images_rejected():
    output = BytesIO()
    Image.new("RGB", (20, 20)).save(output, format="GIF")
    with pytest.raises(ProjectError, match="PNG.*JPEG"):
        decode_image("pretends.png", base64.b64encode(output.getvalue()).decode())
    output = BytesIO()
    Image.new("RGB", (20, 20)).save(output, format="PNG")
    with pytest.raises(ProjectError, match="beschädigt"):
        decode_image("broken.png", base64.b64encode(output.getvalue()[:-12]).decode())


@pytest.mark.parametrize(
    "reference", ["../../secret", f"{IMAGE_PATH}../../secret", f"{IMAGE_PATH}foo"]
)
def test_image_references_cannot_escape_upload_directory(tmp_path, reference):
    with pytest.raises(ProjectError):
        image_file(tmp_path, reference)


def test_image_symlinks_are_not_served(tmp_path):
    target = tmp_path / "secret"
    target.write_bytes(b"private")
    image_file(tmp_path, BACKGROUND).symlink_to(target)
    assert check_image_file(tmp_path, IMAGES[0]) is None


@pytest.mark.parametrize("image_format", ["JPEG", "PNG"])
def test_exif_rotation_is_normalized_before_metadata_and_storage(
    tmp_path, image_format
):
    """The rendered raster and overlay canvas share the same upright dimensions."""
    image = Image.new("RGB", (80, 40), "red")
    exif = Image.Exif()
    exif[274] = 6
    stream = BytesIO()
    image.save(stream, format=image_format, exif=exif)
    data, metadata = decode_image(
        "rotated.jpg", base64.b64encode(stream.getvalue()).decode()
    )
    assert (metadata["width"], metadata["height"]) == (40, 80)
    write_image(tmp_path, metadata["background"], data)
    with Image.open(image_file(tmp_path, metadata["background"])) as saved:
        assert saved.size == (40, 80)
        assert saved.getexif().get(274, 1) == 1
        assert saved.getpixel((20, 40))[0] >= 250
