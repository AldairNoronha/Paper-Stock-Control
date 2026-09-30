class LabelScanError(Exception):
    """Base error for the label scan workflow."""


class LabelScanValidationError(LabelScanError):
    """Raised when an uploaded label does not satisfy the input contract."""


class LabelScanConflictError(LabelScanError):
    """Raised when the same immutable image has already been registered."""


class LabelStorageError(LabelScanError):
    """Raised when the private image store cannot persist the label."""
