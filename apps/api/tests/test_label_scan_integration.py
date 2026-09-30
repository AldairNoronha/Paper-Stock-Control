import os
from uuid import UUID

import pytest
from sqlalchemy import select

from app.core.database import dispose_engine, session_factory
from app.modules.identity.application.auth import CurrentUser
from app.modules.labels.application.errors import LabelScanConflictError
from app.modules.labels.application.schemas import LabelAnalysisSubmission
from app.modules.labels.application.service import LabelScanService
from app.modules.labels.domain.models import LabelFieldReading, LabelScanStatus

pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(
        os.getenv("RUN_INTEGRATION_TESTS") != "1",
        reason="set RUN_INTEGRATION_TESTS=1 to use the migrated PostgreSQL database",
    ),
]

ACTOR = CurrentUser(
    id=UUID("0199a953-b7d3-7000-8000-000000000002"),
    display_name="Label Operator",
    email="labels@example.com",
    roles=frozenset({"OPERATOR"}),
)
IMAGE_BYTES = b"\xff\xd8\xffintegration-label-image"


class FakeStorage:
    def __init__(self) -> None:
        self.uploaded: list[str] = []
        self.deleted: list[str] = []

    async def upload(self, path: str, content: bytes, content_type: str) -> None:
        assert content == IMAGE_BYTES
        assert content_type == "image/jpeg"
        self.uploaded.append(path)

    async def delete(self, path: str) -> None:
        self.deleted.append(path)


@pytest.mark.asyncio
async def test_scan_persists_image_metadata_and_field_evidence() -> None:
    storage = FakeStorage()
    analysis = LabelAnalysisSubmission.model_validate(
        {
            "supplier": "SCHATTDECOR",
            "parser_name": "SchattdecorLabelParser",
            "parser_version": "1.0.0",
            "overall_confidence": 0.91,
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
    )
    try:
        async with session_factory() as session:
            scan = await LabelScanService(session, storage).register(
                filename="label.jpg",
                content_type="image/jpeg",
                content=IMAGE_BYTES,
                analysis=analysis,
                actor=ACTOR,
            )
            scan_id = scan.id

        assert scan.status is LabelScanStatus.READY
        assert len(storage.uploaded) == 1
        assert storage.deleted == []

        async with session_factory() as session:
            readings = list(
                (
                    await session.scalars(
                        select(LabelFieldReading).where(
                            LabelFieldReading.label_scan_id == scan_id
                        )
                    )
                ).all()
            )
            assert {reading.field_name for reading in readings} >= {
                "supplier",
                "lotCode",
                "quantitySheets",
            }

        async with session_factory() as session:
            with pytest.raises(LabelScanConflictError, match="already registered"):
                await LabelScanService(session, storage).register(
                    filename="label.jpg",
                    content_type="image/jpeg",
                    content=IMAGE_BYTES,
                    analysis=analysis,
                    actor=ACTOR,
                )
            assert len(storage.uploaded) == 1
    finally:
        await dispose_engine()
