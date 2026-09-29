from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session
from app.modules.audit.domain.models import AuditLog
from app.modules.catalog.domain.models import Material, Supplier, SupplierMaterial
from app.modules.catalog.presentation.schemas import (
    LocationCreate,
    LocationResponse,
    MaterialCreate,
    MaterialResponse,
    ReasonCodeResponse,
    SupplierMaterialCreate,
    SupplierMaterialResponse,
    SupplierResponse,
)
from app.modules.identity.application.auth import CurrentUser, require_roles
from app.modules.inventory.application.errors import InventoryNotFoundError
from app.modules.inventory.domain.support_models import ReasonCode
from app.modules.locations.domain.models import Location

router = APIRouter(prefix="/catalog", tags=["catalog"])
SessionDependency = Annotated[AsyncSession, Depends(get_session)]
Reader = Annotated[
    CurrentUser,
    Depends(require_roles("OPERATOR", "QUALITY", "SUPERVISOR", "PCP", "ADMIN", "VIEWER")),
]
CatalogEditor = Annotated[CurrentUser, Depends(require_roles("PCP", "ADMIN"))]


@router.get("/suppliers", response_model=list[SupplierResponse])
async def list_suppliers(session: SessionDependency, _: Reader) -> list[Supplier]:
    return list(
        (
            await session.scalars(
                select(Supplier).where(Supplier.is_active.is_(True)).order_by(Supplier.name)
            )
        ).all()
    )


@router.get("/materials", response_model=list[MaterialResponse])
async def list_materials(session: SessionDependency, _: Reader) -> list[Material]:
    return list(
        (
            await session.scalars(
                select(Material).where(Material.is_active.is_(True)).order_by(Material.name)
            )
        ).all()
    )


@router.post(
    "/materials", response_model=MaterialResponse, status_code=status.HTTP_201_CREATED
)
async def create_material(
    command: MaterialCreate, session: SessionDependency, actor: CatalogEditor
) -> Material:
    async with session.begin():
        material = Material(**command.model_dump())
        session.add(material)
        await session.flush()
        session.add(
            AuditLog(
                actor_id=actor.id,
                action="MATERIAL_CREATED",
                entity_type="material",
                entity_id=material.id,
                payload={"internal_code": material.internal_code},
            )
        )
    return material


@router.get("/locations", response_model=list[LocationResponse])
async def list_locations(session: SessionDependency, _: Reader) -> list[Location]:
    return list(
        (
            await session.scalars(
                select(Location).where(Location.is_active.is_(True)).order_by(Location.code)
            )
        ).all()
    )


@router.post(
    "/locations", response_model=LocationResponse, status_code=status.HTTP_201_CREATED
)
async def create_location(
    command: LocationCreate, session: SessionDependency, actor: CatalogEditor
) -> Location:
    async with session.begin():
        location = Location(**command.model_dump())
        session.add(location)
        await session.flush()
        session.add(
            AuditLog(
                actor_id=actor.id,
                action="LOCATION_CREATED",
                entity_type="location",
                entity_id=location.id,
                payload={"code": location.code},
            )
        )
    return location


@router.get("/supplier-materials", response_model=list[SupplierMaterialResponse])
async def list_supplier_materials(
    session: SessionDependency, _: Reader
) -> list[SupplierMaterial]:
    return list(
        (
            await session.scalars(
                select(SupplierMaterial)
                .where(SupplierMaterial.is_active.is_(True))
                .order_by(SupplierMaterial.supplier_name)
            )
        ).all()
    )


@router.post(
    "/supplier-materials",
    response_model=SupplierMaterialResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_supplier_material(
    command: SupplierMaterialCreate,
    session: SessionDependency,
    actor: CatalogEditor,
) -> SupplierMaterial:
    async with session.begin():
        supplier = await session.get(Supplier, command.supplier_id)
        material = await session.get(Material, command.material_id)
        if supplier is None or not supplier.is_active:
            raise InventoryNotFoundError("active supplier not found")
        if material is None or not material.is_active:
            raise InventoryNotFoundError("active material not found")
        mapping = SupplierMaterial(**command.model_dump())
        session.add(mapping)
        await session.flush()
        session.add(
            AuditLog(
                actor_id=actor.id,
                action="SUPPLIER_MATERIAL_CREATED",
                entity_type="supplier_material",
                entity_id=mapping.id,
                payload={
                    "supplier_id": str(mapping.supplier_id),
                    "material_id": str(mapping.material_id),
                },
            )
        )
    return mapping


@router.get("/reason-codes", response_model=list[ReasonCodeResponse])
async def list_reason_codes(session: SessionDependency, _: Reader) -> list[ReasonCode]:
    return list(
        (
            await session.scalars(
                select(ReasonCode)
                .where(ReasonCode.is_active.is_(True))
                .order_by(ReasonCode.category, ReasonCode.code)
            )
        ).all()
    )
