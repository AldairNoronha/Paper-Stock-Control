from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field, field_validator

SupplierCode = Literal["IMPRESS", "SCHATTDECOR", "INTERPRINT", "UNKNOWN"]
ReadingSource = Literal["QR", "BARCODE", "OCR", "CALCULATION", "MANUAL"]
CaptureTarget = Literal["code", "identity", "quantity", "dimensions", "lot", "overview"]
FieldValue = str | int | float


class DetectedCodeSubmission(BaseModel):
    value: str = Field(min_length=1, max_length=4000)
    format: str = Field(min_length=1, max_length=80)


class FieldReadingSubmission(BaseModel):
    value: FieldValue | None = None
    confidence: Decimal = Field(ge=0, le=1, max_digits=5, decimal_places=4)
    sources: list[ReadingSource] = Field(default_factory=list, max_length=5)

    @field_validator("sources")
    @classmethod
    def unique_sources(cls, value: list[ReadingSource]) -> list[ReadingSource]:
        return list(dict.fromkeys(value))


class ImageQualitySubmission(BaseModel):
    width: int = Field(gt=0, le=20_000)
    height: int = Field(gt=0, le=20_000)
    brightness: float = Field(ge=0, le=255)
    contrast: float = Field(ge=0)
    sharpness: float = Field(ge=0)


class LabelAnalysisSubmission(BaseModel):
    supplier: SupplierCode
    parser_name: str = Field(min_length=1, max_length=120)
    parser_version: str = Field(min_length=1, max_length=32)
    overall_confidence: Decimal = Field(ge=0, le=1, max_digits=5, decimal_places=4)
    raw_text: str = Field(default="", max_length=100_000)
    codes: list[DetectedCodeSubmission] = Field(default_factory=list, max_length=20)
    fields: dict[str, FieldReadingSubmission] = Field(min_length=1, max_length=40)
    quality: ImageQualitySubmission

    @field_validator("fields")
    @classmethod
    def safe_field_names(
        cls, value: dict[str, FieldReadingSubmission]
    ) -> dict[str, FieldReadingSubmission]:
        for field_name in value:
            if not field_name.replace("_", "").isalnum() or len(field_name) > 80:
                raise ValueError(f"invalid field name: {field_name}")
        return value


class LabelCaptureSubmission(BaseModel):
    target: CaptureTarget
    field_names: list[str] = Field(min_length=1, max_length=20)
    captured_at: datetime
    quality: ImageQualitySubmission

    @field_validator("field_names")
    @classmethod
    def safe_field_names(cls, value: list[str]) -> list[str]:
        unique = list(dict.fromkeys(value))
        for field_name in unique:
            if not field_name.replace("_", "").isalnum() or len(field_name) > 80:
                raise ValueError(f"invalid field name: {field_name}")
        return unique
