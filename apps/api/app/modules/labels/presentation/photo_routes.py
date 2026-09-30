import asyncio
from collections import deque
from datetime import UTC, datetime
from time import monotonic
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from app.core.config import Settings, get_settings
from app.modules.identity.application.auth import CurrentUser, require_roles
from app.modules.labels.application.photo_analysis import PhotoAnalysis, extract_photo
from app.modules.labels.infrastructure.photo_ocr import (
    MAX_PHOTO_BYTES,
    PhotoOcrError,
    prepare_photo,
    recognize_photo,
)

router = APIRouter(prefix="/labels", tags=["photo-analysis-v2"])
Operator = Annotated[CurrentUser, Depends(require_roles("OPERATOR", "SUPERVISOR", "ADMIN"))]
Config = Annotated[Settings, Depends(get_settings)]


class AnalysisBudget:
    """Process-local guard; provider quotas remain necessary across restarts/replicas."""

    def __init__(self) -> None:
        self.day = ""
        self.count = 0
        self.active: set[UUID] = set()
        self.recent: deque[tuple[UUID, float]] = deque()

    def reserve(self, actor: UUID, daily_limit: int) -> None:
        today = datetime.now(UTC).date().isoformat()
        if self.day != today:
            self.day, self.count = today, 0
        now = monotonic()
        while self.recent and now - self.recent[0][1] >= 60:
            self.recent.popleft()
        if (
            actor in self.active
            or len(self.active) >= 2
            or sum(user == actor for user, _ in self.recent) >= 3
        ):
            raise HTTPException(429, "Aguarde a análise atual ou um minuto antes de reenviar.")
        if self.count >= daily_limit:
            raise HTTPException(429, "Limite diário de análises V2 atingido neste servidor.")
        self.count += 1
        self.recent.append((actor, now))
        self.active.add(actor)


budget = AnalysisBudget()


@router.get("/photo-analysis/status")
async def photo_status(settings: Config) -> dict[str, str | bool]:
    return {
        "enabled": settings.label_ocr_enabled
        and bool(settings.google_vision_api_key.get_secret_value()),
        "provider": "google-vision",
        "stock_writes": False,
    }


@router.post("/photo-analysis", response_model=PhotoAnalysis)
async def analyze_photo(
    actor: Operator, settings: Config, image: Annotated[UploadFile, File()]
) -> PhotoAnalysis:
    if not settings.label_ocr_enabled or not settings.google_vision_api_key.get_secret_value():
        raise HTTPException(503, "OCR V2 ainda não configurado no servidor (Google Cloud Vision).")
    budget.reserve(actor.id, settings.label_ocr_daily_limit)
    try:
        content = await image.read(MAX_PHOTO_BYTES + 1)
        normalized, width, height = await asyncio.to_thread(prepare_photo, content)
        words, text = await recognize_photo(normalized, settings)
        return extract_photo(words, text, width, height)
    except PhotoOcrError as exc:
        raise HTTPException(exc.status_code, str(exc)) from exc
    finally:
        budget.active.discard(actor.id)
        await image.close()
