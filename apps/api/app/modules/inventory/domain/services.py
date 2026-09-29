from decimal import Decimal

SQUARE_MILLIMETRES_PER_SQUARE_METRE = Decimal(1_000_000)


def calculate_area_m2(width_mm: int, length_mm: int, quantity_sheets: int) -> Decimal:
    if width_mm <= 0 or length_mm <= 0 or quantity_sheets <= 0:
        raise ValueError("dimensions and quantity must be positive")

    area = Decimal(width_mm * length_mm * quantity_sheets) / SQUARE_MILLIMETRES_PER_SQUARE_METRE
    return area.quantize(Decimal("0.001"))

