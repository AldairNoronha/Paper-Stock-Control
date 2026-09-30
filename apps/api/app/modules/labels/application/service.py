import hashlib
import json
from pathlib import PurePosixPath

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.ids import new_uuid7
from app.modules.catalog.domain.models import Supplier
from app.modules.identity.application.auth import CurrentUser
from app.modules.labels.application.errors import (
    LabelScanConflictError,
    LabelScanValidationError,
)
from app.modules.labels.application.schemas import LabelAnalysisSubmission
from app.modules.labels.domain.models import LabelFieldReading, LabelScan, LabelScanStatus
from app.modules.labels.infrastructure.storage import LabelImageStorage

ALLOWED_CONTENT_TYPES = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
}
MAX_IMAGE_BYTES = 10 * 1024 * 1024
CRITICAL_FIELDS = ("supplier", "supplierMaterialName", "quantitySheets", "widthMm", "lengthMm")


class LabelScanService:
    def __init__(self, session: AsyncSession, storage: LabelImageStorage) -> None:
        self._session = session
        self._storage = storage

    async def register(
        self,
        *,
        filename: str,
        content_type: str,
        content: bytes,
        analysis: LabelAnalysisSubmission,
        actor: CurrentUser,
    ) -> LabelScan:
        extension = self._validate_image(filename, content_type, content)
        image_sha256 = hashlib.sha256(content).hexdigest()
        scan_id = new_uuid7()
        image_path = f"{actor.id}/{scan_id}{extension}"
        payload = analysis.model_dump(mode="json")
        payload_hash = hashlib.sha256(
            json.dumps(payload, ensure_ascii=False, sort_keys=True).encode("utf-8")
        ).hexdigest()
        status = self._status(analysis)
        supplier_reading = analysis.fields.get("supplier")

        uploaded = False
        try:
            async with self._session.begin():
                existing = await self._session.scalar(
                    select(LabelScan.id).where(LabelScan.image_sha256 == image_sha256)
                )
                if existing is not None:
                    raise LabelScanConflictError(
                        f"label image already registered: {existing}"
                    )
                supplier = await self._supplier(analysis.supplier)
                if analysis.supplier != "UNKNOWN" and supplier is None:
                    raise LabelScanValidationError("active supplier was not found")
                await self._storage.upload(image_path, content, content_type)
                uploaded = True
                scan = LabelScan(
                    id=scan_id,
                    image_path=image_path,
                    image_sha256=image_sha256,
                    status=status,
                    supplier_detected_id=supplier.id if supplier else None,
                    supplier_confidence=(
                        supplier_reading.confidence
                        if supplier_reading is not None
                        else analysis.overall_confidence
                    ),
                    ocr_raw_text=analysis.raw_text,
                    qr_raw_value=next(
                        (code.value for code in analysis.codes if "QR" in code.format.upper()),
                        None,
                    ),
                    barcode_raw_values=[
                        code.value for code in analysis.codes if "QR" not in code.format.upper()
                    ],
                    raw_payload_sha256=payload_hash,
                    parser_name=analysis.parser_name,
                    parser_version=analysis.parser_version,
                    overall_confidence=analysis.overall_confidence,
                    created_by=actor.id,
                )
                self._session.add(scan)
                self._session.add_all(
                    [
                        LabelFieldReading(
                            label_scan_id=scan_id,
                            field_name=name,
                            normalized_value=reading.value,
                            confidence=reading.confidence,
                            evidence=[{"source": source} for source in reading.sources],
                            was_corrected="MANUAL" in reading.sources,
                            corrected_by=actor.id if "MANUAL" in reading.sources else None,
                        )
                        for name, reading in analysis.fields.items()
                    ]
                )
                await self._session.flush()
        except Exception:
            if uploaded:
                await self._storage.delete(image_path)
            raise
        return scan

    @staticmethod
    def _validate_image(filename: str, content_type: str, content: bytes) -> str:
        if content_type not in ALLOWED_CONTENT_TYPES:
            raise LabelScanValidationError("image must be JPEG, PNG or WebP")
        if not content:
            raise LabelScanValidationError("image is empty")
        if len(content) > MAX_IMAGE_BYTES:
            raise LabelScanValidationError("image exceeds the 10 MiB limit")
        source_extension = PurePosixPath(filename).suffix.lower()
        allowed_extension = ALLOWED_CONTENT_TYPES[content_type]
        valid_extensions = {allowed_extension}
        if content_type == "image/jpeg":
            valid_extensions.add(".jpeg")
        if source_extension and source_extension not in valid_extensions:
            raise LabelScanValidationError("filename extension does not match content type")
        signatures = {
            "image/jpeg": content.startswith(b"\xff\xd8\xff"),
            "image/png": content.startswith(b"\x89PNG\r\n\x1a\n"),
            "image/webp": content.startswith(b"RIFF") and content[8:12] == b"WEBP",
        }
        if not signatures[content_type]:
            raise LabelScanValidationError("file content does not match the declared image type")
        return allowed_extension

    async def _supplier(self, code: str) -> Supplier | None:
        if code == "UNKNOWN":
            return None
        return await self._session.scalar(
            select(Supplier).where(Supplier.code == code, Supplier.is_active.is_(True))
        )

    @staticmethod
    def _status(analysis: LabelAnalysisSubmission) -> LabelScanStatus:
        missing = [
            name
            for name in CRITICAL_FIELDS
            if name not in analysis.fields or analysis.fields[name].value in {None, ""}
        ]
        supplier = analysis.fields.get("supplier")
        if supplier is not None and supplier.value == "UNKNOWN":
            missing.append("supplier")
        lot = analysis.fields.get("lotCode")
        pallet_code = analysis.fields.get("supplierPalletCode")
        if (lot is None or lot.value in {None, ""}) and (
            pallet_code is None or pallet_code.value in {None, ""}
        ):
            missing.append("lotCode/supplierPalletCode")
        return LabelScanStatus.NEEDS_REVIEW if missing else LabelScanStatus.READY
