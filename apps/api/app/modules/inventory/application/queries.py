from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.catalog.domain.models import Material, RotationPolicy
from app.modules.inventory.application.errors import InventoryNotFoundError
from app.modules.inventory.domain.models import (
    InventoryMovement,
    Pallet,
    PalletLifecycleStatus,
)


class InventoryQueries:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def get_pallet(self, pallet_id: UUID) -> Pallet:
        pallet = await self._session.get(Pallet, pallet_id)
        if pallet is None:
            raise InventoryNotFoundError("pallet not found")
        return pallet

    async def list_stock(
        self,
        *,
        supplier_id: UUID | None = None,
        material_id: UUID | None = None,
        location_id: UUID | None = None,
        include_depleted: bool = False,
        limit: int = 100,
    ) -> list[Pallet]:
        statement = select(Pallet)
        if supplier_id is not None:
            statement = statement.where(Pallet.supplier_id == supplier_id)
        if material_id is not None:
            statement = statement.where(Pallet.material_id == material_id)
        if location_id is not None:
            statement = statement.where(Pallet.location_id == location_id)
        if not include_depleted:
            statement = statement.where(
                Pallet.lifecycle_status == PalletLifecycleStatus.ACTIVE
            )
        statement = statement.order_by(Pallet.created_at.desc()).limit(limit)
        return list((await self._session.scalars(statement)).all())

    async def list_movements(self, pallet_id: UUID) -> list[InventoryMovement]:
        await self.get_pallet(pallet_id)
        statement = (
            select(InventoryMovement)
            .where(InventoryMovement.pallet_id == pallet_id)
            .order_by(
                InventoryMovement.occurred_at.desc(),
                InventoryMovement.created_at.desc(),
            )
        )
        return list((await self._session.scalars(statement)).all())

    async def rotation_recommendation(self, material_id: UUID) -> Pallet | None:
        material = await self._session.get(Material, material_id)
        if material is None:
            raise InventoryNotFoundError("material not found")
        statement = select(Pallet).where(
            Pallet.material_id == material_id,
            Pallet.lifecycle_status == PalletLifecycleStatus.ACTIVE,
            Pallet.available_quantity > 0,
        )
        if material.rotation_policy is RotationPolicy.FEFO:
            statement = statement.order_by(
                Pallet.expires_on.asc().nulls_last(),
                Pallet.created_at.asc(),
                Pallet.internal_number.asc(),
            )
        else:
            statement = statement.order_by(
                Pallet.created_at.asc(), Pallet.internal_number.asc()
            )
        return await self._session.scalar(statement.limit(1))
