from decimal import Decimal

import pytest

from app.modules.inventory.domain.services import calculate_area_m2


@pytest.mark.parametrize(
    ("width_mm", "length_mm", "sheets", "expected"),
    [
        (2760, 1860, 820, Decimal("4209.552")),
        (1865, 2765, 850, Decimal("4383.216")),
        (1865, 2765, 1060, Decimal("5466.128")),
    ],
)
def test_calculate_area_m2(
    width_mm: int, length_mm: int, sheets: int, expected: Decimal
) -> None:
    assert calculate_area_m2(width_mm, length_mm, sheets) == expected


def test_area_rejects_nonpositive_input() -> None:
    with pytest.raises(ValueError, match="must be positive"):
        calculate_area_m2(1865, 2765, 0)

