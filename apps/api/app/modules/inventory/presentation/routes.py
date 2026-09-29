from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session
from app.modules.identity.application.auth import CurrentUser, require_roles
from app.modules.inventory.application.commands import (
    DiscardCommand,
    IssueCommand,
    ReceiptCommand,
    RequiredReasonMovementCommand,
    ReversalCommand,
    TransferCommand,
)
from app.modules.inventory.application.queries import InventoryQueries
from app.modules.inventory.application.service import InventoryService
from app.modules.inventory.presentation.schemas import (
    MovementResponse,
    PalletResponse,
    RotationRecommendationResponse,
)

router = APIRouter(prefix="/inventory", tags=["inventory"])
SessionDependency = Annotated[AsyncSession, Depends(get_session)]
IdempotencyKey = Annotated[str, Header(alias="Idempotency-Key", min_length=8, max_length=128)]
Reader = Annotated[
    CurrentUser,
    Depends(require_roles("OPERATOR", "QUALITY", "SUPERVISOR", "PCP", "ADMIN", "VIEWER")),
]
Operator = Annotated[
    CurrentUser, Depends(require_roles("OPERATOR", "SUPERVISOR", "ADMIN"))
]
Quality = Annotated[
    CurrentUser, Depends(require_roles("QUALITY", "SUPERVISOR", "ADMIN"))
]
Supervisor = Annotated[CurrentUser, Depends(require_roles("SUPERVISOR", "ADMIN"))]


@router.post("/receipts", response_model=PalletResponse, status_code=status.HTTP_201_CREATED)
async def receive_pallet(
    command: ReceiptCommand,
    session: SessionDependency,
    actor: Operator,
    idempotency_key: IdempotencyKey,
) -> PalletResponse:
    pallet = await InventoryService(session).receive(
        command, actor=actor, idempotency_key=idempotency_key
    )
    return PalletResponse.from_domain(pallet)


@router.post("/pallets/{pallet_id}/issues", response_model=MovementResponse)
async def issue_stock(
    pallet_id: UUID,
    command: IssueCommand,
    session: SessionDependency,
    actor: Operator,
    idempotency_key: IdempotencyKey,
) -> MovementResponse:
    movement = await InventoryService(session).issue(
        pallet_id, command, actor=actor, idempotency_key=idempotency_key
    )
    return MovementResponse.from_domain(movement)


@router.post("/pallets/{pallet_id}/blocks", response_model=MovementResponse)
async def block_stock(
    pallet_id: UUID,
    command: RequiredReasonMovementCommand,
    session: SessionDependency,
    actor: Quality,
    idempotency_key: IdempotencyKey,
) -> MovementResponse:
    movement = await InventoryService(session).block(
        pallet_id, command, actor=actor, idempotency_key=idempotency_key
    )
    return MovementResponse.from_domain(movement)


@router.post("/pallets/{pallet_id}/unblocks", response_model=MovementResponse)
async def unblock_stock(
    pallet_id: UUID,
    command: RequiredReasonMovementCommand,
    session: SessionDependency,
    actor: Quality,
    idempotency_key: IdempotencyKey,
) -> MovementResponse:
    movement = await InventoryService(session).unblock(
        pallet_id, command, actor=actor, idempotency_key=idempotency_key
    )
    return MovementResponse.from_domain(movement)


@router.post("/pallets/{pallet_id}/discards", response_model=MovementResponse)
async def discard_stock(
    pallet_id: UUID,
    command: DiscardCommand,
    session: SessionDependency,
    actor: Quality,
    idempotency_key: IdempotencyKey,
) -> MovementResponse:
    movement = await InventoryService(session).discard(
        pallet_id, command, actor=actor, idempotency_key=idempotency_key
    )
    return MovementResponse.from_domain(movement)


@router.post("/pallets/{pallet_id}/returns", response_model=MovementResponse)
async def return_stock(
    pallet_id: UUID,
    command: RequiredReasonMovementCommand,
    session: SessionDependency,
    actor: Supervisor,
    idempotency_key: IdempotencyKey,
) -> MovementResponse:
    movement = await InventoryService(session).return_to_stock(
        pallet_id, command, actor=actor, idempotency_key=idempotency_key
    )
    return MovementResponse.from_domain(movement)


@router.post("/pallets/{pallet_id}/transfers", response_model=MovementResponse)
async def transfer_pallet(
    pallet_id: UUID,
    command: TransferCommand,
    session: SessionDependency,
    actor: Operator,
    idempotency_key: IdempotencyKey,
) -> MovementResponse:
    movement = await InventoryService(session).transfer(
        pallet_id, command, actor=actor, idempotency_key=idempotency_key
    )
    return MovementResponse.from_domain(movement)


@router.post("/movements/{movement_id}/reversal", response_model=MovementResponse)
async def reverse_movement(
    movement_id: UUID,
    command: ReversalCommand,
    session: SessionDependency,
    actor: Supervisor,
    idempotency_key: IdempotencyKey,
) -> MovementResponse:
    movement = await InventoryService(session).reverse(
        movement_id, command, actor=actor, idempotency_key=idempotency_key
    )
    return MovementResponse.from_domain(movement)


@router.get("/stock", response_model=list[PalletResponse])
async def list_stock(
    session: SessionDependency,
    _: Reader,
    supplier_id: UUID | None = None,
    material_id: UUID | None = None,
    location_id: UUID | None = None,
    include_depleted: bool = False,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
) -> list[PalletResponse]:
    pallets = await InventoryQueries(session).list_stock(
        supplier_id=supplier_id,
        material_id=material_id,
        location_id=location_id,
        include_depleted=include_depleted,
        limit=limit,
    )
    return [PalletResponse.from_domain(pallet) for pallet in pallets]


@router.get("/pallets/{pallet_id}", response_model=PalletResponse)
async def get_pallet(
    pallet_id: UUID, session: SessionDependency, _: Reader
) -> PalletResponse:
    pallet = await InventoryQueries(session).get_pallet(pallet_id)
    return PalletResponse.from_domain(pallet)


@router.get("/pallets/{pallet_id}/movements", response_model=list[MovementResponse])
async def list_movements(
    pallet_id: UUID, session: SessionDependency, _: Reader
) -> list[MovementResponse]:
    movements = await InventoryQueries(session).list_movements(pallet_id)
    return [MovementResponse.from_domain(movement) for movement in movements]


@router.get(
    "/materials/{material_id}/rotation-recommendation",
    response_model=RotationRecommendationResponse,
)
async def rotation_recommendation(
    material_id: UUID, session: SessionDependency, _: Reader
) -> RotationRecommendationResponse:
    pallet = await InventoryQueries(session).rotation_recommendation(material_id)
    return RotationRecommendationResponse(
        material_id=material_id,
        recommended_pallet=PalletResponse.from_domain(pallet) if pallet else None,
    )
