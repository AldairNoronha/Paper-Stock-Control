from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, UploadFile, status
from pydantic import TypeAdapter, ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.core.database import get_session
from app.modules.identity.application.auth import CurrentUser, require_roles
from app.modules.labels.application.errors import LabelScanValidationError
from app.modules.labels.application.schemas import (
    LabelAnalysisSubmission,
    LabelCaptureSubmission,
)
from app.modules.labels.application.service import (
    MAX_CAPTURE_BYTES,
    MAX_CAPTURE_COUNT,
    MAX_IMAGE_BYTES,
    LabelCaptureUpload,
    LabelScanService,
)
from app.modules.labels.infrastructure.storage import (
    LabelImageStorage,
    SupabaseLabelImageStorage,
)
from app.modules.labels.presentation.schemas import LabelScanResponse

router = APIRouter(prefix="/labels", tags=["labels"])
SessionDependency = Annotated[AsyncSession, Depends(get_session)]
Operator = Annotated[
    CurrentUser, Depends(require_roles("OPERATOR", "SUPERVISOR", "ADMIN"))
]


def get_label_storage(
    settings: Annotated[Settings, Depends(get_settings)],
) -> LabelImageStorage:
    return SupabaseLabelImageStorage(settings)


StorageDependency = Annotated[LabelImageStorage, Depends(get_label_storage)]


@router.post("/scans", response_model=LabelScanResponse, status_code=status.HTTP_201_CREATED)
async def register_label_scan(
    session: SessionDependency,
    actor: Operator,
    storage: StorageDependency,
    image: Annotated[UploadFile, File()],
    analysis: Annotated[str, Form(min_length=2, max_length=500_000)],
    evidence_images: Annotated[list[UploadFile] | None, File()] = None,
    evidence_manifest: Annotated[str | None, Form(max_length=100_000)] = None,
) -> LabelScanResponse:
    try:
        submission = LabelAnalysisSubmission.model_validate_json(analysis)
    except ValidationError as exc:
        raise LabelScanValidationError("invalid label analysis payload") from exc
    images = evidence_images or []
    if len(images) > MAX_CAPTURE_COUNT:
        raise LabelScanValidationError(
            f"at most {MAX_CAPTURE_COUNT} evidence images are allowed"
        )
    try:
        manifest = TypeAdapter(list[LabelCaptureSubmission]).validate_json(
            evidence_manifest or "[]"
        )
    except ValidationError as exc:
        raise LabelScanValidationError("invalid evidence manifest") from exc
    if len(manifest) != len(images):
        raise LabelScanValidationError(
            "evidence manifest and evidence image counts do not match"
        )
    content = await image.read(MAX_IMAGE_BYTES + 1)
    captures = [
        LabelCaptureUpload(
            filename=evidence.filename or f"evidence-{index}.jpg",
            content_type=evidence.content_type or "application/octet-stream",
            content=await evidence.read(MAX_CAPTURE_BYTES + 1),
            metadata=manifest[index],
        )
        for index, evidence in enumerate(images)
    ]
    scan = await LabelScanService(session, storage).register(
        filename=image.filename or "label",
        content_type=image.content_type or "application/octet-stream",
        content=content,
        analysis=submission,
        actor=actor,
        captures=captures,
    )
    return LabelScanResponse.from_domain(scan, capture_count=len(captures))
