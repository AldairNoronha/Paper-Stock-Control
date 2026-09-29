import asyncio
import os
from collections.abc import AsyncIterator
from dataclasses import dataclass
from uuid import UUID

import pytest
from sqlalchemy import select

from app.core.database import dispose_engine, session_factory
from app.core.ids import new_uuid7
from app.modules.catalog.domain.models import Material, Supplier, SupplierMaterial
from app.modules.identity.application.auth import CurrentUser
from app.modules.inventory.application.commands import (
    DiscardCommand,
    IssueCommand,
    ReceiptCommand,
    RequiredReasonMovementCommand,
    ReversalCommand,
    TransferCommand,
)
from app.modules.inventory.application.errors import (
    InsufficientStockError,
    InventoryConflictError,
)
from app.modules.inventory.application.service import InventoryService
from app.modules.inventory.domain.models import InventoryMovement, Pallet
from app.modules.locations.domain.models import Location

pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(
        os.getenv("RUN_INTEGRATION_TESTS") != "1",
        reason="set RUN_INTEGRATION_TESTS=1 to use the migrated PostgreSQL database",
    ),
]


@dataclass(frozen=True)
class CatalogData:
    supplier_id: UUID
    material_id: UUID
    first_location_id: UUID
    second_location_id: UUID


ACTOR = CurrentUser(
    id=UUID("0199a953-b7d3-7000-8000-000000000001"),
    display_name="Integration Admin",
    email="integration@example.com",
    roles=frozenset({"ADMIN"}),
)


@pytest.fixture(autouse=True)
async def close_database_pool_after_test() -> AsyncIterator[None]:
    yield
    await dispose_engine()


async def create_catalog() -> CatalogData:
    suffix = str(new_uuid7()).replace("-", "")[-10:]
    async with session_factory() as session, session.begin():
        supplier_id = await session.scalar(
            select(Supplier.id).where(Supplier.code == "IMPRESS")
        )
        assert supplier_id is not None
        material = Material(
            internal_code=f"MAT-{suffix}",
            name=f"Material integration {suffix}",
            width_mm=1860,
            length_mm=2760,
        )
        first_location = Location(code=f"A-{suffix}", name="Integration A")
        second_location = Location(code=f"B-{suffix}", name="Integration B")
        session.add_all([material, first_location, second_location])
        await session.flush()
        session.add(
            SupplierMaterial(
                supplier_id=supplier_id,
                material_id=material.id,
                supplier_code=f"SUP-{suffix}",
                supplier_name=f"Supplier material {suffix}",
            )
        )
    return CatalogData(
        supplier_id=supplier_id,
        material_id=material.id,
        first_location_id=first_location.id,
        second_location_id=second_location.id,
    )


def receipt_command(catalog: CatalogData, quantity: int = 100) -> ReceiptCommand:
    return ReceiptCommand(
        supplier_id=catalog.supplier_id,
        material_id=catalog.material_id,
        location_id=catalog.first_location_id,
        supplier_material_name="Integration paper",
        supplier_pallet_code=f"PAL-{new_uuid7()}",
        quantity_sheets=quantity,
        width_mm=1860,
        length_mm=2760,
    )


@pytest.mark.asyncio
async def test_full_stock_workflow_preserves_invariants_and_idempotency() -> None:
    catalog = await create_catalog()
    command = receipt_command(catalog)
    run_id = str(new_uuid7())
    async with session_factory() as session:
        service = InventoryService(session)
        receipt_key = f"receipt-{run_id}"
        pallet = await service.receive(command, actor=ACTOR, idempotency_key=receipt_key)
        pallet_id = pallet.id
        replay = await service.receive(command, actor=ACTOR, idempotency_key=receipt_key)
        assert replay.id == pallet_id
        with pytest.raises(InventoryConflictError, match="already registered"):
            await service.receive(
                command,
                actor=ACTOR,
                idempotency_key=f"duplicate-{run_id}",
            )

        issue = await service.issue(
            pallet_id,
            IssueCommand(quantity_sheets=20, destination_reference="PRESS-01"),
            actor=ACTOR,
            idempotency_key=f"issue-a-{run_id}",
        )
        await service.block(
            pallet_id,
            RequiredReasonMovementCommand(
                quantity_sheets=10, reason_code="QUALITY_HOLD"
            ),
            actor=ACTOR,
            idempotency_key=f"block-{run_id}",
        )
        await service.unblock(
            pallet_id,
            RequiredReasonMovementCommand(
                quantity_sheets=5, reason_code="QUALITY_RELEASE"
            ),
            actor=ACTOR,
            idempotency_key=f"unblock-{run_id}",
        )
        await service.discard(
            pallet_id,
            DiscardCommand(
                quantity_sheets=5,
                reason_code="DAMAGED",
                source_bucket="BLOCKED",
            ),
            actor=ACTOR,
            idempotency_key=f"discard-{run_id}",
        )
        await service.return_to_stock(
            pallet_id,
            RequiredReasonMovementCommand(
                quantity_sheets=10, reason_code="OPERATIONAL_RETURN"
            ),
            actor=ACTOR,
            idempotency_key=f"return-{run_id}",
        )
        await service.issue(
            pallet_id,
            IssueCommand(quantity_sheets=10, destination_reference="PRESS-02"),
            actor=ACTOR,
            idempotency_key=f"issue-b-{run_id}",
        )
        transfer = await service.transfer(
            pallet_id,
            TransferCommand(to_location_id=catalog.second_location_id),
            actor=ACTOR,
            idempotency_key=f"transfer-{run_id}",
        )
        await service.reverse(
            transfer.id,
            ReversalCommand(
                reason_code="AUTHORIZED_REVERSAL", notes="Integration reversal"
            ),
            actor=ACTOR,
            idempotency_key=f"reverse-transfer-{run_id}",
        )
        await service.reverse(
            issue.id,
            ReversalCommand(
                reason_code="AUTHORIZED_REVERSAL", notes="Issue correction"
            ),
            actor=ACTOR,
            idempotency_key=f"reverse-issue-{run_id}",
        )

    async with session_factory() as session:
        stored = await session.get(Pallet, pallet_id)
        assert stored is not None
        assert stored.location_id == catalog.first_location_id
        assert stored.available_quantity == 95
        assert stored.blocked_quantity == 0
        assert stored.consumed_quantity == 0
        assert stored.discarded_quantity == 5
        assert (
            stored.available_quantity
            + stored.blocked_quantity
            + stored.consumed_quantity
            + stored.discarded_quantity
            == stored.received_quantity + stored.net_adjustment_quantity
        )
        movement_count = len(
            (
                await session.scalars(
                    select(InventoryMovement).where(
                        InventoryMovement.pallet_id == pallet_id
                    )
                )
            ).all()
        )
        assert movement_count == 10


async def concurrent_issue(pallet_id: UUID, quantity: int, key: str) -> object:
    try:
        async with session_factory() as session:
            return await InventoryService(session).issue(
                pallet_id,
                IssueCommand(
                    quantity_sheets=quantity,
                    destination_reference=f"CONCURRENT-{quantity}",
                ),
                actor=ACTOR,
                idempotency_key=key,
            )
    except Exception as exception:  # result is asserted by type below
        return exception


@pytest.mark.asyncio
async def test_concurrent_issues_never_create_negative_stock() -> None:
    catalog = await create_catalog()
    async with session_factory() as session:
        pallet = await InventoryService(session).receive(
            receipt_command(catalog),
            actor=ACTOR,
            idempotency_key=f"receipt-concurrent-{new_uuid7()}",
        )

    results = await asyncio.gather(
        concurrent_issue(pallet.id, 80, f"issue-80-{new_uuid7()}"),
        concurrent_issue(pallet.id, 50, f"issue-50-{new_uuid7()}"),
    )

    assert sum(isinstance(result, InventoryMovement) for result in results) == 1
    assert sum(isinstance(result, InsufficientStockError) for result in results) == 1
    async with session_factory() as session:
        stored = await session.get(Pallet, pallet.id)
        assert stored is not None
        assert stored.available_quantity in {20, 50}
        assert stored.available_quantity >= 0
        assert stored.available_quantity + stored.consumed_quantity == 100
