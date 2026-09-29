import hashlib
import json
from datetime import UTC, datetime
from uuid import UUID

from pydantic import BaseModel
from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.inventory.application.errors import InventoryConflictError
from app.modules.inventory.domain.support_models import IdempotencyRecord


def request_hash(scope: str, command: BaseModel) -> str:
    serialized = json.dumps(
        {"scope": scope, "payload": command.model_dump(mode="json")},
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
    )
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


def movement_idempotency_key(actor_id: UUID, scope: str, key: str) -> str:
    value = f"{actor_id}:{scope}:{key}"
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


async def acquire_idempotency(
    session: AsyncSession,
    *,
    actor_id: UUID,
    scope: str,
    key: str,
    command_hash: str,
) -> UUID | None:
    statement = (
        insert(IdempotencyRecord)
        .values(
            actor_id=actor_id,
            operation_scope=scope,
            idempotency_key=key,
            request_hash=command_hash,
            status="PENDING",
        )
        .on_conflict_do_nothing(constraint="uq_idempotency_records_command")
        .returning(IdempotencyRecord.id)
    )
    inserted_id = (await session.execute(statement)).scalar_one_or_none()
    if inserted_id is not None:
        return None

    existing = (
        await session.scalars(
            select(IdempotencyRecord)
            .where(
                IdempotencyRecord.actor_id == actor_id,
                IdempotencyRecord.operation_scope == scope,
                IdempotencyRecord.idempotency_key == key,
            )
            .with_for_update()
        )
    ).one()
    if existing.request_hash != command_hash:
        raise InventoryConflictError("idempotency key was already used with another payload")
    if existing.status != "COMPLETED" or existing.resource_id is None:
        raise InventoryConflictError("idempotent command is still pending")
    return existing.resource_id


async def complete_idempotency(
    session: AsyncSession,
    *,
    actor_id: UUID,
    scope: str,
    key: str,
    resource_type: str,
    resource_id: UUID,
    response_body: dict[str, object] | None = None,
) -> None:
    await session.execute(
        update(IdempotencyRecord)
        .where(
            IdempotencyRecord.actor_id == actor_id,
            IdempotencyRecord.operation_scope == scope,
            IdempotencyRecord.idempotency_key == key,
        )
        .values(
            status="COMPLETED",
            resource_type=resource_type,
            resource_id=resource_id,
            response_body=response_body,
            completed_at=datetime.now(UTC),
        )
    )
