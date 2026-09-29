from uuid import UUID

from uuid6 import uuid7


def new_uuid7() -> UUID:
    """Return a time-ordered UUIDv7 without exposing sequential business IDs."""
    return uuid7()


def format_pallet_code(internal_number: int) -> str:
    if internal_number < 1:
        raise ValueError("internal_number must be positive")
    return f"PAP-{internal_number:06d}"


def format_internal_qr(pallet_id: UUID) -> str:
    return f"PSC:1:{pallet_id}"

