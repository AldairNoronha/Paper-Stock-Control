from decimal import Decimal

import pytest
from pydantic import ValidationError

from app.core.config import Settings
from app.modules.labels.application.errors import LabelScanValidationError
from app.modules.labels.application.schemas import (
    LabelAnalysisSubmission,
    LabelCaptureSubmission,
)
from app.modules.labels.application.service import (
    MAX_CAPTURE_COUNT,
    LabelCaptureUpload,
    LabelScanService,
)
from app.modules.labels.domain.models import LabelScanStatus
from app.modules.labels.infrastructure.storage import SupabaseLabelImageStorage


def analysis_payload() -> dict[str, object]:
    return {
        "supplier": "SCHATTDECOR",
        "parser_name": "SchattdecorLabelParser",
        "parser_version": "1.0.0",
        "overall_confidence": "0.91",
        "raw_text": "CONVES D009247388 850 1865x2765",
        "codes": [{"value": "D009247388", "format": "CODE_128"}],
        "quality": {
            "width": 1113,
            "height": 440,
            "brightness": 170,
            "contrast": 38,
            "sharpness": 51,
        },
        "fields": {
            "supplier": {
                "value": "SCHATTDECOR",
                "confidence": 0.99,
                "sources": ["BARCODE"],
            },
            "supplierMaterialName": {
                "value": "CONVES",
                "confidence": 0.8,
                "sources": ["OCR"],
            },
            "lotCode": {
                "value": "D009247388",
                "confidence": 0.99,
                "sources": ["BARCODE"],
            },
            "quantitySheets": {"value": 850, "confidence": 0.8, "sources": ["OCR"]},
            "widthMm": {"value": 1865, "confidence": 0.8, "sources": ["OCR"]},
            "lengthMm": {"value": 2765, "confidence": 0.8, "sources": ["OCR"]},
        },
    }


@pytest.mark.parametrize("target", ["area", "production", "expiry", "reference"])
def test_highlighted_field_capture_targets(target: str) -> None:
    capture = LabelCaptureSubmission.model_validate({
        "target": target,
        "field_names": ["supplierOrderNumber"],
        "captured_at": "2026-09-30T13:00:00Z",
        "quality": analysis_payload()["quality"],
    })
    assert capture.target == target


def test_complete_analysis_is_ready() -> None:
    analysis = LabelAnalysisSubmission.model_validate(analysis_payload())

    assert analysis.overall_confidence == Decimal("0.91")
    assert LabelScanService._status(analysis) is LabelScanStatus.READY


def test_missing_lot_requires_review() -> None:
    payload = analysis_payload()
    fields = dict(payload["fields"])  # type: ignore[arg-type]
    fields.pop("lotCode")
    payload["fields"] = fields

    analysis = LabelAnalysisSubmission.model_validate(payload)

    assert LabelScanService._status(analysis) is LabelScanStatus.NEEDS_REVIEW


def test_image_contract_rejects_spoofed_extension() -> None:
    with pytest.raises(LabelScanValidationError, match="extension"):
        LabelScanService._validate_image("label.png", "image/jpeg", b"jpeg")


def test_analysis_rejects_unsafe_field_name() -> None:
    payload = analysis_payload()
    fields = dict(payload["fields"])  # type: ignore[arg-type]
    fields["../../unsafe"] = fields["supplier"]
    payload["fields"] = fields

    with pytest.raises(ValidationError, match="invalid field name"):
        LabelAnalysisSubmission.model_validate(payload)


def test_new_secret_key_is_not_sent_as_bearer_token() -> None:
    storage = SupabaseLabelImageStorage(
        Settings(supabase_secret_key="sb_secret_test")
    )

    assert storage._headers == {"apikey": "sb_secret_test"}


def test_legacy_service_key_keeps_bearer_header() -> None:
    storage = SupabaseLabelImageStorage(
        Settings(supabase_secret_key="legacy-service-key")
    )

    assert storage._headers == {
        "apikey": "legacy-service-key",
        "authorization": "Bearer legacy-service-key",
    }


def test_guided_capture_contract_limits_image_count() -> None:
    metadata = LabelCaptureSubmission.model_validate(
        {
            "target": "quantity",
            "field_names": ["quantitySheets"],
            "captured_at": "2026-09-30T12:00:00Z",
            "quality": {
                "width": 1600,
                "height": 700,
                "brightness": 150,
                "contrast": 40,
                "sharpness": 75,
            },
        }
    )
    capture = LabelCaptureUpload(
        filename="quantity.jpg",
        content_type="image/jpeg",
        content=b"\xff\xd8\xffcapture",
        metadata=metadata,
    )

    with pytest.raises(LabelScanValidationError, match="at most"):
        LabelScanService._validate_captures([capture] * (MAX_CAPTURE_COUNT + 1))


def test_guided_capture_rejects_unsafe_field_name() -> None:
    with pytest.raises(ValidationError, match="invalid field name"):
        LabelCaptureSubmission.model_validate(
            {
                "target": "lot",
                "field_names": ["../../lot"],
                "captured_at": "2026-09-30T12:00:00Z",
                "quality": {
                    "width": 1600,
                    "height": 700,
                    "brightness": 150,
                    "contrast": 40,
                    "sharpness": 75,
                },
            }
        )
