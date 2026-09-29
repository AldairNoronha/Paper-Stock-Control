from datetime import datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.audit.domain.models import AuditLog
from app.modules.catalog.domain.models import (
    Material,
    RotationPolicy,
    Supplier,
    SupplierMaterial,
)
from app.modules.identity.application.auth import CurrentUser
from app.modules.inventory.application.commands import (
    DiscardCommand,
    IssueCommand,
    QuantityMovementCommand,
    ReceiptCommand,
    RequiredReasonMovementCommand,
    ReversalCommand,
    TransferCommand,
)
from app.modules.inventory.application.errors import (
    InsufficientStockError,
    InvalidMovementError,
    InventoryConflictError,
    InventoryNotFoundError,
    RotationOverrideRequiredError,
)
from app.modules.inventory.application.idempotency import (
    acquire_idempotency,
    complete_idempotency,
    movement_idempotency_key,
    request_hash,
)
from app.modules.inventory.domain.models import (
    InventoryMovement,
    MovementType,
    Pallet,
    PalletLifecycleStatus,
    StockBucket,
)
from app.modules.inventory.domain.services import calculate_area_m2
from app.modules.inventory.domain.support_models import ReasonCode
from app.modules.labels.domain.models import LabelScan, LabelScanStatus
from app.modules.locations.domain.models import Location

BUCKET_FIELD = {
    StockBucket.AVAILABLE: "available_quantity",
    StockBucket.BLOCKED: "blocked_quantity",
    StockBucket.CONSUMED: "consumed_quantity",
    StockBucket.DISCARDED: "discarded_quantity",
}


class InventoryService:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def receive(
        self,
        command: ReceiptCommand,
        *,
        actor: CurrentUser,
        idempotency_key: str,
    ) -> Pallet:
        scope = "inventory.receipt"
        command_hash = request_hash(scope, command)

        async with self._session.begin():
            replay_id = await acquire_idempotency(
                self._session,
                actor_id=actor.id,
                scope=scope,
                key=idempotency_key,
                command_hash=command_hash,
            )
            if replay_id is not None:
                return await self._get_pallet(replay_id)

            supplier = await self._session.get(Supplier, command.supplier_id)
            if supplier is None or not supplier.is_active:
                raise InventoryNotFoundError("active supplier not found")

            material = await self._session.get(Material, command.material_id)
            if material is None or not material.is_active:
                raise InventoryNotFoundError("active material not found")
            if material.width_mm != command.width_mm or material.length_mm != command.length_mm:
                raise InvalidMovementError("label dimensions do not match the internal material")

            mapping = await self._session.scalar(
                select(SupplierMaterial.id).where(
                    SupplierMaterial.supplier_id == command.supplier_id,
                    SupplierMaterial.material_id == command.material_id,
                    SupplierMaterial.is_active.is_(True),
                )
            )
            if mapping is None:
                raise InventoryConflictError("supplier material mapping is required")

            location = await self._session.get(Location, command.location_id)
            if location is None or not location.is_active:
                raise InventoryNotFoundError("active location not found")

            await self._ensure_not_duplicate(command)
            self._validate_declared_area(command)

            pallet = Pallet(
                supplier_id=command.supplier_id,
                material_id=command.material_id,
                location_id=command.location_id,
                supplier_material_name=command.supplier_material_name,
                supplier_pallet_code=command.supplier_pallet_code,
                supplier_sscc=command.supplier_sscc,
                lot_code=command.lot_code,
                received_quantity=command.quantity_sheets,
                available_quantity=command.quantity_sheets,
                blocked_quantity=0,
                consumed_quantity=0,
                discarded_quantity=0,
                net_adjustment_quantity=0,
                width_mm=command.width_mm,
                length_mm=command.length_mm,
                declared_area_m2=command.declared_area_m2,
                manufactured_at=command.manufactured_at,
                expires_on=command.expires_on,
                orientation=command.orientation,
                lifecycle_status=PalletLifecycleStatus.ACTIVE,
                raw_label_payload=command.raw_label_payload,
                created_by=actor.id,
                version=1,
            )
            self._session.add(pallet)
            await self._session.flush()

            movement = self._new_movement(
                pallet=pallet,
                movement_type=MovementType.RECEIPT,
                from_bucket=StockBucket.EXTERNAL,
                to_bucket=StockBucket.AVAILABLE,
                quantity=command.quantity_sheets,
                actor=actor,
                scope=scope,
                key=idempotency_key,
                command_hash=command_hash,
                occurred_at=command.occurred_at,
            )
            self._session.add(movement)

            if command.label_scan_id is not None:
                scan = await self._session.scalar(
                    select(LabelScan)
                    .where(LabelScan.id == command.label_scan_id)
                    .with_for_update()
                )
                if scan is None:
                    raise InventoryNotFoundError("label scan not found")
                if scan.pallet_id is not None:
                    raise InventoryConflictError("label scan is already linked to a pallet")
                scan.pallet_id = pallet.id
                scan.status = LabelScanStatus.CONFIRMED

            self._add_audit(
                actor=actor,
                action="PALLET_RECEIVED",
                entity_type="pallet",
                entity_id=pallet.id,
                payload={"quantity_sheets": command.quantity_sheets},
            )
            await complete_idempotency(
                self._session,
                actor_id=actor.id,
                scope=scope,
                key=idempotency_key,
                resource_type="pallet",
                resource_id=pallet.id,
            )
            await self._session.flush()
            return pallet

    async def issue(
        self,
        pallet_id: UUID,
        command: IssueCommand,
        *,
        actor: CurrentUser,
        idempotency_key: str,
    ) -> InventoryMovement:
        return await self._quantity_movement(
            pallet_id,
            command,
            actor=actor,
            idempotency_key=idempotency_key,
            movement_type=MovementType.ISSUE,
            from_bucket=StockBucket.AVAILABLE,
            to_bucket=StockBucket.CONSUMED,
            reason_category="ISSUE",
            enforce_rotation=True,
        )

    async def block(
        self,
        pallet_id: UUID,
        command: RequiredReasonMovementCommand,
        *,
        actor: CurrentUser,
        idempotency_key: str,
    ) -> InventoryMovement:
        return await self._quantity_movement(
            pallet_id,
            command,
            actor=actor,
            idempotency_key=idempotency_key,
            movement_type=MovementType.BLOCK,
            from_bucket=StockBucket.AVAILABLE,
            to_bucket=StockBucket.BLOCKED,
            reason_category="BLOCK",
        )

    async def unblock(
        self,
        pallet_id: UUID,
        command: RequiredReasonMovementCommand,
        *,
        actor: CurrentUser,
        idempotency_key: str,
    ) -> InventoryMovement:
        return await self._quantity_movement(
            pallet_id,
            command,
            actor=actor,
            idempotency_key=idempotency_key,
            movement_type=MovementType.UNBLOCK,
            from_bucket=StockBucket.BLOCKED,
            to_bucket=StockBucket.AVAILABLE,
            reason_category="UNBLOCK",
        )

    async def discard(
        self,
        pallet_id: UUID,
        command: DiscardCommand,
        *,
        actor: CurrentUser,
        idempotency_key: str,
    ) -> InventoryMovement:
        source = StockBucket(command.source_bucket)
        movement_type = (
            MovementType.DISCARD_AVAILABLE
            if source is StockBucket.AVAILABLE
            else MovementType.DISCARD_BLOCKED
        )
        return await self._quantity_movement(
            pallet_id,
            command,
            actor=actor,
            idempotency_key=idempotency_key,
            movement_type=movement_type,
            from_bucket=source,
            to_bucket=StockBucket.DISCARDED,
            reason_category="DISCARD",
        )

    async def return_to_stock(
        self,
        pallet_id: UUID,
        command: RequiredReasonMovementCommand,
        *,
        actor: CurrentUser,
        idempotency_key: str,
    ) -> InventoryMovement:
        return await self._quantity_movement(
            pallet_id,
            command,
            actor=actor,
            idempotency_key=idempotency_key,
            movement_type=MovementType.RETURN,
            from_bucket=StockBucket.CONSUMED,
            to_bucket=StockBucket.AVAILABLE,
            reason_category="RETURN",
        )

    async def transfer(
        self,
        pallet_id: UUID,
        command: TransferCommand,
        *,
        actor: CurrentUser,
        idempotency_key: str,
    ) -> InventoryMovement:
        scope = "inventory.transfer"
        command_hash = request_hash(scope, command)

        async with self._session.begin():
            replay_id = await acquire_idempotency(
                self._session,
                actor_id=actor.id,
                scope=scope,
                key=idempotency_key,
                command_hash=command_hash,
            )
            if replay_id is not None:
                return await self._get_movement(replay_id)

            pallet = await self._get_pallet_for_update(pallet_id)
            destination = await self._session.get(Location, command.to_location_id)
            if destination is None or not destination.is_active:
                raise InventoryNotFoundError("active destination location not found")
            if pallet.location_id == command.to_location_id:
                raise InvalidMovementError("pallet is already at the destination location")
            if command.reason_code is not None:
                await self._validate_reason(command.reason_code, "TRANSFER")

            source_location_id = pallet.location_id
            pallet.location_id = command.to_location_id
            pallet.version += 1
            movement = self._new_movement(
                pallet=pallet,
                movement_type=MovementType.TRANSFER,
                from_bucket=None,
                to_bucket=None,
                quantity=None,
                actor=actor,
                scope=scope,
                key=idempotency_key,
                command_hash=command_hash,
                occurred_at=command.occurred_at,
                reason_code=command.reason_code,
                notes=command.notes,
                from_location_id=source_location_id,
                to_location_id=command.to_location_id,
            )
            self._session.add(movement)
            self._add_audit(
                actor=actor,
                action="PALLET_TRANSFERRED",
                entity_type="pallet",
                entity_id=pallet.id,
                payload={
                    "from_location_id": str(source_location_id),
                    "to_location_id": str(command.to_location_id),
                },
            )
            await self._session.flush()
            await complete_idempotency(
                self._session,
                actor_id=actor.id,
                scope=scope,
                key=idempotency_key,
                resource_type="inventory_movement",
                resource_id=movement.id,
            )
            return movement

    async def reverse(
        self,
        movement_id: UUID,
        command: ReversalCommand,
        *,
        actor: CurrentUser,
        idempotency_key: str,
    ) -> InventoryMovement:
        scope = "inventory.reversal"
        command_hash = request_hash(scope, command)

        async with self._session.begin():
            replay_id = await acquire_idempotency(
                self._session,
                actor_id=actor.id,
                scope=scope,
                key=idempotency_key,
                command_hash=command_hash,
            )
            if replay_id is not None:
                return await self._get_movement(replay_id)

            original = await self._session.scalar(
                select(InventoryMovement)
                .where(InventoryMovement.id == movement_id)
                .with_for_update()
            )
            if original is None:
                raise InventoryNotFoundError("movement not found")
            if original.movement_type is MovementType.REVERSAL:
                raise InvalidMovementError("a reversal cannot be reversed")
            prior_reversal = await self._session.scalar(
                select(InventoryMovement.id).where(
                    InventoryMovement.source_movement_id == movement_id
                )
            )
            if prior_reversal is not None:
                raise InventoryConflictError("movement was already reversed")
            await self._validate_reason(command.reason_code, "REVERSAL")

            pallet = await self._get_pallet_for_update(original.pallet_id)
            if original.movement_type is MovementType.TRANSFER:
                if original.from_location_id is None or original.to_location_id is None:
                    raise InvalidMovementError("original transfer has invalid locations")
                if pallet.location_id != original.to_location_id:
                    raise InventoryConflictError(
                        "pallet moved again; reverse the most recent transfer first"
                    )
                pallet.location_id = original.from_location_id
                reverse_from_location = original.to_location_id
                reverse_to_location = original.from_location_id
                reverse_from_bucket = None
                reverse_to_bucket = None
                reverse_quantity = None
            else:
                if (
                    original.quantity is None
                    or original.from_bucket is None
                    or original.to_bucket is None
                ):
                    raise InvalidMovementError("original movement has invalid stock buckets")
                self._move_between_buckets(
                    pallet,
                    original.to_bucket,
                    original.from_bucket,
                    original.quantity,
                )
                if original.movement_type is MovementType.RECEIPT:
                    pallet.received_quantity -= original.quantity
                    if pallet.received_quantity < 0:
                        raise InvalidMovementError(
                            "receipt reversal would invalidate received total"
                        )
                elif original.movement_type is MovementType.ADJUSTMENT_IN:
                    pallet.net_adjustment_quantity -= original.quantity
                elif original.movement_type is MovementType.ADJUSTMENT_OUT:
                    pallet.net_adjustment_quantity += original.quantity
                reverse_from_location = None
                reverse_to_location = None
                reverse_from_bucket = original.to_bucket
                reverse_to_bucket = original.from_bucket
                reverse_quantity = original.quantity

            pallet.version += 1
            self._refresh_lifecycle(pallet)
            reversal = self._new_movement(
                pallet=pallet,
                movement_type=MovementType.REVERSAL,
                from_bucket=reverse_from_bucket,
                to_bucket=reverse_to_bucket,
                quantity=reverse_quantity,
                actor=actor,
                scope=scope,
                key=idempotency_key,
                command_hash=command_hash,
                occurred_at=command.occurred_at,
                reason_code=command.reason_code,
                notes=command.notes,
                from_location_id=reverse_from_location,
                to_location_id=reverse_to_location,
                source_movement_id=original.id,
            )
            self._session.add(reversal)
            await self._session.flush()
            self._add_audit(
                actor=actor,
                action="MOVEMENT_REVERSED",
                entity_type="inventory_movement",
                entity_id=original.id,
                payload={"reversal_id": str(reversal.id)},
            )
            await complete_idempotency(
                self._session,
                actor_id=actor.id,
                scope=scope,
                key=idempotency_key,
                resource_type="inventory_movement",
                resource_id=reversal.id,
            )
            return reversal

    async def _quantity_movement(
        self,
        pallet_id: UUID,
        command: QuantityMovementCommand,
        *,
        actor: CurrentUser,
        idempotency_key: str,
        movement_type: MovementType,
        from_bucket: StockBucket,
        to_bucket: StockBucket,
        reason_category: str,
        enforce_rotation: bool = False,
    ) -> InventoryMovement:
        scope = f"inventory.{movement_type.value.lower()}"
        command_hash = request_hash(scope, command)

        async with self._session.begin():
            replay_id = await acquire_idempotency(
                self._session,
                actor_id=actor.id,
                scope=scope,
                key=idempotency_key,
                command_hash=command_hash,
            )
            if replay_id is not None:
                return await self._get_movement(replay_id)

            pallet = await self._get_pallet_for_update(pallet_id)
            if enforce_rotation:
                await self._enforce_rotation(pallet, command)
            if command.reason_code is not None:
                await self._validate_reason(command.reason_code, reason_category)
            elif isinstance(command, RequiredReasonMovementCommand):
                raise InvalidMovementError("reason code is required")

            self._move_between_buckets(
                pallet,
                from_bucket,
                to_bucket,
                command.quantity_sheets,
            )
            pallet.version += 1
            self._refresh_lifecycle(pallet)

            movement = self._new_movement(
                pallet=pallet,
                movement_type=movement_type,
                from_bucket=from_bucket,
                to_bucket=to_bucket,
                quantity=command.quantity_sheets,
                actor=actor,
                scope=scope,
                key=idempotency_key,
                command_hash=command_hash,
                occurred_at=command.occurred_at,
                reason_code=command.reason_code,
                notes=command.notes,
                destination_reference=command.destination_reference,
            )
            self._session.add(movement)
            self._add_audit(
                actor=actor,
                action=f"STOCK_{movement_type.value}",
                entity_type="pallet",
                entity_id=pallet.id,
                payload={"quantity_sheets": command.quantity_sheets},
            )
            await self._session.flush()
            await complete_idempotency(
                self._session,
                actor_id=actor.id,
                scope=scope,
                key=idempotency_key,
                resource_type="inventory_movement",
                resource_id=movement.id,
            )
            return movement

    async def _get_pallet_for_update(self, pallet_id: UUID) -> Pallet:
        pallet = await self._session.scalar(
            select(Pallet).where(Pallet.id == pallet_id).with_for_update()
        )
        if pallet is None:
            raise InventoryNotFoundError("pallet not found")
        if pallet.lifecycle_status is PalletLifecycleStatus.CANCELLED:
            raise InventoryConflictError("cancelled pallet cannot be moved")
        return pallet

    async def _get_pallet(self, pallet_id: UUID) -> Pallet:
        pallet = await self._session.get(Pallet, pallet_id)
        if pallet is None:
            raise InventoryNotFoundError("pallet not found")
        return pallet

    async def _get_movement(self, movement_id: UUID) -> InventoryMovement:
        movement = await self._session.get(InventoryMovement, movement_id)
        if movement is None:
            raise InventoryNotFoundError("movement not found")
        return movement

    async def _ensure_not_duplicate(self, command: ReceiptCommand) -> None:
        identifiers = []
        if command.supplier_sscc is not None:
            identifiers.append(Pallet.supplier_sscc == command.supplier_sscc)
        if command.supplier_pallet_code is not None:
            identifiers.append(Pallet.supplier_pallet_code == command.supplier_pallet_code)
        if not identifiers:
            return
        duplicate = await self._session.scalar(
            select(Pallet.id).where(
                Pallet.supplier_id == command.supplier_id,
                or_(*identifiers),
            )
        )
        if duplicate is not None:
            raise InventoryConflictError(f"pallet already registered: {duplicate}")

    @staticmethod
    def _validate_declared_area(command: ReceiptCommand) -> None:
        if command.declared_area_m2 is None:
            return
        calculated = calculate_area_m2(
            command.width_mm,
            command.length_mm,
            command.quantity_sheets,
        )
        tolerance = max(Decimal("0.020"), calculated * Decimal("0.0001"))
        if abs(command.declared_area_m2 - calculated) > tolerance:
            raise InvalidMovementError(
                f"declared area {command.declared_area_m2} differs from calculated {calculated}"
            )

    async def _validate_reason(self, code: str, category: str) -> None:
        reason = await self._session.scalar(
            select(ReasonCode.id).where(
                ReasonCode.code == code,
                ReasonCode.category == category,
                ReasonCode.is_active.is_(True),
            )
        )
        if reason is None:
            raise InvalidMovementError(
                f"active reason code {code!r} is not valid for {category}"
            )

    async def _enforce_rotation(
        self, pallet: Pallet, command: QuantityMovementCommand
    ) -> None:
        material = await self._session.get(Material, pallet.material_id)
        if material is None:
            raise InventoryNotFoundError("material not found")
        statement = select(Pallet.id).where(
            Pallet.material_id == pallet.material_id,
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
        recommended_id = await self._session.scalar(statement.limit(1))
        if recommended_id != pallet.id:
            if command.reason_code != "FIFO_OVERRIDE" or not command.notes:
                raise RotationOverrideRequiredError(
                    f"pallet {recommended_id} must be used first or an override justified"
                )

    @staticmethod
    def _move_between_buckets(
        pallet: Pallet,
        from_bucket: StockBucket,
        to_bucket: StockBucket,
        quantity: int,
    ) -> None:
        if from_bucket is not StockBucket.EXTERNAL:
            source_field = BUCKET_FIELD[from_bucket]
            source_balance = getattr(pallet, source_field)
            if source_balance < quantity:
                raise InsufficientStockError(
                    f"insufficient {from_bucket.value.lower()} balance: "
                    f"requested {quantity}, available {source_balance}"
                )
            setattr(pallet, source_field, source_balance - quantity)
        if to_bucket is not StockBucket.EXTERNAL:
            destination_field = BUCKET_FIELD[to_bucket]
            setattr(pallet, destination_field, getattr(pallet, destination_field) + quantity)

    @staticmethod
    def _refresh_lifecycle(pallet: Pallet) -> None:
        pallet.lifecycle_status = (
            PalletLifecycleStatus.DEPLETED
            if pallet.available_quantity + pallet.blocked_quantity == 0
            else PalletLifecycleStatus.ACTIVE
        )

    @staticmethod
    def _new_movement(
        *,
        pallet: Pallet,
        movement_type: MovementType,
        from_bucket: StockBucket | None,
        to_bucket: StockBucket | None,
        quantity: int | None,
        actor: CurrentUser,
        scope: str,
        key: str,
        command_hash: str,
        occurred_at: datetime,
        reason_code: str | None = None,
        notes: str | None = None,
        destination_reference: str | None = None,
        from_location_id: UUID | None = None,
        to_location_id: UUID | None = None,
        source_movement_id: UUID | None = None,
    ) -> InventoryMovement:
        return InventoryMovement(
            pallet_id=pallet.id,
            movement_type=movement_type,
            from_bucket=from_bucket,
            to_bucket=to_bucket,
            quantity=quantity,
            from_location_id=from_location_id,
            to_location_id=to_location_id,
            source_movement_id=source_movement_id,
            reason_code=reason_code,
            notes=notes,
            destination_reference=destination_reference,
            idempotency_key=movement_idempotency_key(actor.id, scope, key),
            request_hash=command_hash,
            occurred_at=occurred_at,
            created_by=actor.id,
        )

    def _add_audit(
        self,
        *,
        actor: CurrentUser,
        action: str,
        entity_type: str,
        entity_id: UUID,
        payload: dict[str, object],
    ) -> None:
        self._session.add(
            AuditLog(
                actor_id=actor.id,
                action=action,
                entity_type=entity_type,
                entity_id=entity_id,
                payload=payload,
            )
        )
