"""Bounded full-image OCR call. No storage, stock write, URL input or automatic retry."""

import base64
import io
import warnings

import httpx
from PIL import Image, ImageOps, UnidentifiedImageError
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from app.core.config import Settings
from app.modules.labels.application.photo_analysis import Word

MAX_PHOTO_BYTES = 10 * 1024 * 1024
MAX_PHOTO_PIXELS = 20_000_000
VISION_URL = "https://vision.googleapis.com/v1/images:annotate"


class PhotoOcrError(Exception):
    def __init__(self, message: str, status_code: int = 502) -> None:
        super().__init__(message)
        self.status_code = status_code


def prepare_photo(content: bytes) -> tuple[bytes, int, int]:
    if not content or len(content) > MAX_PHOTO_BYTES:
        raise PhotoOcrError("A foto deve ter no máximo 10 MB.", 422)
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(content)) as source:
                if source.format not in ("JPEG", "PNG") or getattr(source, "n_frames", 1) != 1:
                    raise PhotoOcrError("Use uma foto JPEG ou PNG, não uma animação.", 422)
                if source.width * source.height > MAX_PHOTO_PIXELS:
                    raise PhotoOcrError("A foto excede 20 megapixels; use resolução menor.", 422)
                source.load()
                oriented = ImageOps.exif_transpose(source)
                if oriented.mode in ("RGBA", "LA") or "transparency" in oriented.info:
                    rgba = oriented.convert("RGBA")
                    image = Image.new("RGB", rgba.size, "white")
                    image.paste(rgba, mask=rgba.getchannel("A"))
                else:
                    image = oriented.convert("RGB")
                width, height = image.size
                if min(width, height) < 200:
                    raise PhotoOcrError("Foto muito pequena; fotografe a etiqueta novamente.", 422)
                output = io.BytesIO()
                # Preserve the full photo and dimensions. Strip EXIF/GPS before sending.
                image.save(output, format="JPEG", quality=95)
                encoded = output.getvalue()
                if len(encoded) > MAX_PHOTO_BYTES:
                    raise PhotoOcrError("A foto normalizada excede 10 MB.", 422)
                return encoded, width, height
    except (
        UnidentifiedImageError,
        OSError,
        ValueError,
        Image.DecompressionBombError,
        Image.DecompressionBombWarning,
    ) as exc:
        raise PhotoOcrError("Arquivo inválido ou imagem danificada. Use JPEG ou PNG.", 422) from exc


class Vertex(BaseModel):
    x: float = 0
    y: float = 0


class BoundingBox(BaseModel):
    vertices: list[Vertex] = Field(default_factory=list)


class Symbol(BaseModel):
    text: str


class VisionWord(BaseModel):
    symbols: list[Symbol]
    bounding_box: BoundingBox = Field(alias="boundingBox")
    confidence: float | None = Field(default=None, ge=0, le=1)


class Paragraph(BaseModel):
    words: list[VisionWord] = Field(default_factory=list)


class Block(BaseModel):
    paragraphs: list[Paragraph] = Field(default_factory=list)


class Page(BaseModel):
    blocks: list[Block] = Field(default_factory=list)


class Annotation(BaseModel):
    text: str = ""
    pages: list[Page] = Field(default_factory=list)


class VisionResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")
    annotation: Annotation = Field(default_factory=Annotation, alias="fullTextAnnotation")
    error: dict[str, object] | None = None


class VisionBatch(BaseModel):
    responses: list[VisionResponse] = Field(min_length=1, max_length=1)


async def recognize_photo(
    content: bytes,
    settings: Settings,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> tuple[list[Word], str]:
    if not settings.label_ocr_enabled or not settings.google_vision_api_key.get_secret_value():
        raise PhotoOcrError("OCR V2 ainda não configurado no servidor (Google Cloud Vision).", 503)
    try:
        async with httpx.AsyncClient(
            timeout=settings.label_ocr_timeout_seconds, transport=transport
        ) as client:
            response = await client.post(
                VISION_URL,
                headers={"x-goog-api-key": settings.google_vision_api_key.get_secret_value()},
                json={
                    "requests": [
                        {
                            "image": {"content": base64.b64encode(content).decode()},
                            "features": [{"type": "DOCUMENT_TEXT_DETECTION"}],
                            "imageContext": {"languageHints": ["pt", "en"]},
                        }
                    ]
                },
            )
            response.raise_for_status()
            batch = VisionBatch.model_validate(response.json())
    except httpx.TimeoutException as exc:
        raise PhotoOcrError(
            "O OCR demorou demais. Tente novamente, sem reenvio automático.", 504
        ) from exc
    except (httpx.HTTPError, ValidationError, ValueError) as exc:
        # Do not leak vendor response, request headers or credentials to the browser.
        raise PhotoOcrError("Não foi possível analisar a foto no serviço de OCR.") from exc
    result = batch.responses[0]
    if result.error:
        raise PhotoOcrError("O serviço de OCR recusou a análise. Verifique a configuração.")
    words = []
    for page in result.annotation.pages:
        for block in page.blocks:
            for paragraph in block.paragraphs:
                for word in paragraph.words:
                    points = word.bounding_box.vertices
                    text = "".join(symbol.text for symbol in word.symbols)
                    if not text or len(points) < 4:
                        continue
                    words.append(
                        Word(
                            text,
                            min(p.x for p in points),
                            min(p.y for p in points),
                            max(p.x for p in points),
                            max(p.y for p in points),
                            word.confidence,
                        )
                    )
                    if len(words) > 1500:
                        raise PhotoOcrError("Muitos textos na foto. Fotografe uma etiqueta.", 422)
    return words, result.annotation.text[:50000]
