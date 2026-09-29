class InventoryError(Exception):
    """Base error raised by inventory use cases."""


class InventoryNotFoundError(InventoryError):
    pass


class InventoryConflictError(InventoryError):
    pass


class InsufficientStockError(InventoryConflictError):
    pass


class RotationOverrideRequiredError(InventoryConflictError):
    pass


class InvalidMovementError(InventoryError):
    pass

