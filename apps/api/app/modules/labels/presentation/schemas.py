from datetime import datetime
from uuid import UUID

from pydantic import BaseModel

from app.modules.labels.domain.models import LabelScan


class LabelScanResponse(BaseModel):
    id: UUID
    image_path: str
    image_sha256: str | None
    status: str
    parser_name: str | None
    parser_version: str | None
    overall_confidence: float | None
    created_at: datetime

    @classmethod
    def from_domain(cls, scan: LabelScan) -> "LabelScanResponse":
        return cls(
            id=scan.id,
            image_path=scan.image_path,
            image_sha256=scan.image_sha256,
            status=scan.status.value,
            parser_name=scan.parser_name,
            parser_version=scan.parser_version,
            overall_confidence=float(scan.overall_confidence)
            if scan.overall_confidence is not None
            else None,
            created_at=scan.created_at,
        )
