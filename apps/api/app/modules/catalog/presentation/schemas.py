from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.modules.catalog.domain.models import RotationPolicy


class SupplierResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    code: str
    name: str
    is_active: bool


class MaterialCreate(BaseModel):
    internal_code: str = Field(min_length=1, max_length=32)
    name: str = Field(min_length=1, max_length=160)
    width_mm: int = Field(gt=0)
    length_mm: int = Field(gt=0)
    rotation_policy: RotationPolicy = RotationPolicy.FIFO


class MaterialResponse(MaterialCreate):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    is_active: bool
    created_at: datetime


class LocationCreate(BaseModel):
    code: str = Field(min_length=1, max_length=32)
    name: str = Field(min_length=1, max_length=120)


class LocationResponse(LocationCreate):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    is_active: bool
    created_at: datetime


class SupplierMaterialCreate(BaseModel):
    supplier_id: UUID
    material_id: UUID
    supplier_code: str | None = Field(default=None, max_length=80)
    supplier_name: str = Field(min_length=1, max_length=240)


class SupplierMaterialResponse(SupplierMaterialCreate):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    is_active: bool
    created_at: datetime


class ReasonCodeResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    code: str
    category: str
    label: str
    is_active: bool
