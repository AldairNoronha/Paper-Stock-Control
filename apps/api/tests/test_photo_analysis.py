"""Synthetic OCR layout fixtures. These tests do NOT measure real vendor OCR accuracy."""

import base64
import io
import json
from uuid import uuid4

import httpx
import pytest
from PIL import Image

from app.core.config import Settings, get_settings
from app.main import app
from app.modules.identity.application.auth import CurrentUser, get_current_user
from app.modules.labels.application.photo_analysis import Word, extract_photo, valid_sscc
from app.modules.labels.infrastructure.photo_ocr import (
    MAX_PHOTO_BYTES,
    PhotoOcrError,
    prepare_photo,
    recognize_photo,
)
from app.modules.labels.presentation import photo_routes
from app.modules.labels.presentation.photo_routes import AnalysisBudget


def word(text: str, x: float, y: float, height: float = 12) -> Word:
    return Word(text, x, y, x + len(text) * height * 0.5, y + height, 0.92)


def schattdecor_words(sheets: str = "800", weight: str = "1009") -> list[Word]:
    return [
        word("Floraplac MDF LTDA", 20, 20, 18),
        word("schattdecor", 800, 20),
        word("Descrição do produto", 20, 55),
        word("Madeira Oak 109", 20, 75, 18),
        word("LENHO", 600, 70, 50),
        word("Comprimento (mm)", 20, 160),
        word("Largura (mm)", 180, 160),
        word("Qde. de folhas", 320, 160),
        word("2765", 20, 180, 20),
        word("1865", 180, 180, 20),
        word(sheets, 320, 180, 20),
        word("Total m2", 20, 225),
        word("Peso (kg)", 180, 225),
        word("4125.38", 20, 250, 20),
        word(weight, 180, 250, 20),
        word("1-0757-B", 20, 310, 20),
        word("Lote:", 600, 290),
        word("D009235577", 600, 310, 45),
    ]


def photo_bytes(*, exif: bool = False) -> bytes:
    image = Image.new("RGB", (400, 250), "white")
    output = io.BytesIO()
    metadata = Image.Exif()
    if exif:
        metadata[274] = 6
    image.save(output, format="JPEG", exif=metadata)
    return output.getvalue()


def test_full_layout_extracts_without_qr_and_without_focus_stages() -> None:
    analysis = extract_photo(schattdecor_words(), "fixture text", 1000, 600)
    expected = {
        "supplier": "SCHATTDECOR",
        "material": "LENHO",
        "sheets": "800",
        "width_mm": "1865",
        "length_mm": "2765",
        "weight_kg": "1009",
        "lot": "D009235577",
        "pallet": "1-0757-B",
        "area_m2": "4125.38",
    }
    assert {key: analysis.fields[key].value for key in expected} == expected
    assert not analysis.missing_critical
    assert analysis.calculated_area_m2 == 4125.38
    assert all(analysis.fields[key].status == "review" for key in expected)
    assert analysis.fields["sheets"].source_text == "800"
    assert analysis.fields["sheets"].box is not None
    assert analysis.fields["sheets"].box.x == 0.32
    assert "overall_confidence" not in analysis.model_dump()


def test_weight_is_never_used_when_sheets_are_missing() -> None:
    words = [item for item in schattdecor_words() if item.text not in ("Qde. de folhas", "800")]
    analysis = extract_photo(words, "", 1000, 600)
    assert analysis.fields["weight_kg"].value == "1009"
    assert analysis.fields["sheets"].value is None
    assert "sheets" in analysis.missing_critical
    assert analysis.calculated_area_m2 is None


def test_conflicts_and_area_divergence_require_review() -> None:
    words = [*schattdecor_words("810"), word("D009999999", 650, 450, 30)]
    analysis = extract_photo(words, "", 1000, 600)
    assert analysis.fields["lot"].status == "ambiguous"
    assert analysis.fields["lot"].value is None
    assert any("Área declarada diverge" in message for message in analysis.warnings)


def test_impress_identifiers_dates_quantity_and_dimensions_stay_separate() -> None:
    words = [
        word("impress", 800, 20),
        word("E-102893/130-15-I-01", 20, 25, 16),
        word("Num. do pallet", 300, 20),
        word("2", 300, 45, 18),
        word("Quantity(sheets)", 500, 20),
        word("950", 500, 45, 18),
        word("Quantity (m2)", 670, 20),
        word("4.876,92", 670, 45, 18),
        word("1860 X2760", 850, 60, 18),
        word("PRODUTO", 400, 100),
        word("PAU", 400, 125, 20),
        word("FERRO", 440, 125, 20),
        word("Order number", 20, 100),
        word("102893/130", 20, 125, 18),
        word("Data de produção", 20, 160),
        word("12/09/2026", 20, 185, 18),
        word("Data validade", 230, 160),
        word("11/12/26", 230, 185, 18),
        word("(00)378989959000373219", 400, 230, 18),
    ]
    analysis = extract_photo(words, "", 1100, 300)
    for key, expected in {
        "material": "PAU FERRO",
        "sheets": "950",
        "width_mm": "1860",
        "length_mm": "2760",
        "order": "102893/130",
        "pallet_number": "2",
        "production_date": "2026-09-12",
        "expiry_date": "2026-12-11",
        "sscc": "378989959000373219",
        "area_m2": "4876.92",
    }.items():
        assert analysis.fields[key].value == expected, key
    assert analysis.fields["lot"].value is None  # Order/SSCC are not invented as lot.


def test_interprint_quantity_thousands_and_batch() -> None:
    analysis = extract_photo(
        [
            word("INTERPRINT", 800, 20),
            word("Material Nr.", 20, 20),
            word("Referência descrição", 20, 100),
            word("FREIJÓ TUCUMA", 20, 125, 24),
            word("1865 / 2765", 400, 40, 18),
            word("Lote / Batch", 20, 200),
            word("8081196011", 20, 230, 35),
            word("Quant. / Quantity", 600, 200),
            word("(pc)", 600, 215),
            word("1.060", 600, 240, 30),
        ],
        "",
        1000,
        400,
    )
    assert analysis.fields["sheets"].value == "1060"
    assert analysis.fields["lot"].value == "8081196011"
    assert analysis.fields["material"].value == "FREIJÓ TUCUMA"


def test_empty_ocr_and_invalid_sscc_are_not_success() -> None:
    analysis = extract_photo([], "", 1000, 600)
    assert len(analysis.missing_critical) == 6
    assert all(field.value is None for field in analysis.fields.values())
    assert valid_sscc("378989959000373219")
    assert not valid_sscc("378989959000373210")


def test_image_validation_and_exif_rotation() -> None:
    normalized, width, height = prepare_photo(photo_bytes(exif=True))
    assert (width, height) == (250, 400)
    with Image.open(io.BytesIO(normalized)) as image:
        assert not image.getexif()
    for bad in (b"not an image", b"x" * (MAX_PHOTO_BYTES + 1)):
        with pytest.raises(PhotoOcrError) as exc:
            prepare_photo(bad)
        assert exc.value.status_code == 422


@pytest.mark.asyncio
async def test_vision_request_contract_and_word_coordinates() -> None:
    def handle(request: httpx.Request) -> httpx.Response:
        assert request.url == "https://vision.googleapis.com/v1/images:annotate"
        assert request.headers["x-goog-api-key"] == "test-only-key"
        payload = json.loads(request.content)
        assert base64.b64decode(payload["requests"][0]["image"]["content"]) == b"photo"
        assert payload["requests"][0]["features"] == [{"type": "DOCUMENT_TEXT_DETECTION"}]
        return httpx.Response(
            200,
            json={
                "responses": [
                    {
                        "fullTextAnnotation": {
                            "text": "LENHO",
                            "pages": [
                                {
                                    "blocks": [
                                        {
                                            "paragraphs": [
                                                {
                                                    "words": [
                                                        {
                                                            "symbols": [
                                                                {"text": char} for char in "LENHO"
                                                            ],
                                                            "confidence": 0.9,
                                                            "boundingBox": {
                                                                "vertices": [
                                                                    {},
                                                                    {"x": 100},
                                                                    {"x": 100, "y": 20},
                                                                    {"y": 20},
                                                                ]
                                                            },
                                                        }
                                                    ]
                                                }
                                            ]
                                        }
                                    ]
                                }
                            ],
                        }
                    }
                ]
            },
        )

    settings = Settings(
        _env_file=None, label_ocr_enabled=True, google_vision_api_key="test-only-key"
    )
    words, text = await recognize_photo(b"photo", settings, transport=httpx.MockTransport(handle))
    assert text == "LENHO"
    assert words == [Word("LENHO", 0, 0, 100, 20, 0.9)]


@pytest.mark.asyncio
@pytest.mark.parametrize("status", [400, 403, 429, 500])
async def test_vendor_errors_do_not_leak_credentials_or_retry(status: int) -> None:
    calls = 0

    def handle(_: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(status, json={"error": "test-only-key confidential"})

    settings = Settings(
        _env_file=None, label_ocr_enabled=True, google_vision_api_key="test-only-key"
    )
    with pytest.raises(PhotoOcrError) as exc:
        await recognize_photo(b"photo", settings, transport=httpx.MockTransport(handle))
    assert "test-only-key" not in str(exc.value)
    assert calls == 1


@pytest.mark.asyncio
async def test_analysis_route_requires_login_and_reports_disabled_service() -> None:
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post(
            "/api/v1/labels/photo-analysis", files={"image": ("x.jpg", photo_bytes())}
        )
    assert response.status_code == 401
    app.dependency_overrides[get_settings] = lambda: Settings(_env_file=None)
    app.dependency_overrides[get_current_user] = lambda: CurrentUser(
        uuid4(), "Operator", None, frozenset({"OPERATOR"})
    )
    try:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            response = await client.post(
                "/api/v1/labels/photo-analysis", files={"image": ("x.jpg", photo_bytes())}
            )
            readiness = await client.get("/api/v1/labels/photo-analysis/status")
        assert response.status_code == 503
        assert readiness.json()["enabled"] is False
        assert readiness.json()["stock_writes"] is False
    finally:
        app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_route_normalizes_photo_and_returns_review_without_persisting(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def recognize(content: bytes, _: Settings) -> tuple[list[Word], str]:
        with Image.open(io.BytesIO(content)) as image:
            assert image.size == (400, 250)
        return [word("LENHO", 20, 20)], "LENHO"

    monkeypatch.setattr(photo_routes, "recognize_photo", recognize)
    monkeypatch.setattr(photo_routes, "budget", AnalysisBudget())
    app.dependency_overrides[get_settings] = lambda: Settings(
        _env_file=None, label_ocr_enabled=True, google_vision_api_key="test-only-key"
    )
    app.dependency_overrides[get_current_user] = lambda: CurrentUser(
        uuid4(), "Operator", None, frozenset({"OPERATOR"})
    )
    try:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            response = await client.post(
                "/api/v1/labels/photo-analysis", files={"image": ("x.jpg", photo_bytes())}
            )
        assert response.status_code == 200
        assert response.json()["missing_critical"]
        assert not photo_routes.budget.active
    finally:
        app.dependency_overrides.clear()


def test_analysis_budget_blocks_duplicates_and_daily_overuse() -> None:
    budget = AnalysisBudget()
    actor = uuid4()
    budget.reserve(actor, 1)
    with pytest.raises(Exception) as exc:
        budget.reserve(actor, 1)
    assert exc.value.status_code == 429  # type: ignore[attr-defined]
    budget.active.discard(actor)
    with pytest.raises(Exception) as exc:
        budget.reserve(uuid4(), 1)
    assert exc.value.status_code == 429  # type: ignore[attr-defined]
