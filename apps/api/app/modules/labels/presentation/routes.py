from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, UploadFile, status
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.core.database import get_session
from app.modules.identity.application.auth import CurrentUser, require_roles
from app.modules.labels.application.errors import LabelScanValidationError
from app.modules.labels.application.schemas import LabelAnalysisSubmission
from app.modules.labels.application.service import MAX_IMAGE_BYTES, LabelScanService
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
) -> LabelScanResponse:
    try:
        submission = LabelAnalysisSubmission.model_validate_json(analysis)
    except ValidationError as exc:
        raise LabelScanValidationError("invalid label analysis payload") from exc
    content = await image.read(MAX_IMAGE_BYTES + 1)
    scan = await LabelScanService(session, storage).register(
        filename=image.filename or "label",
        content_type=image.content_type or "application/octet-stream",
        content=content,
        analysis=submission,
        actor=actor,
    )
    return LabelScanResponse.from_domain(scan)
