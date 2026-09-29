from app.core.ids import format_internal_qr, format_pallet_code, new_uuid7


def test_uuid7_and_human_readable_identifiers() -> None:
    pallet_id = new_uuid7()

    assert pallet_id.version == 7
    assert format_pallet_code(128) == "PAP-000128"
    assert format_internal_qr(pallet_id) == f"PSC:1:{pallet_id}"


def test_pallet_number_must_be_positive() -> None:
    try:
        format_pallet_code(0)
    except ValueError as exc:
        assert str(exc) == "internal_number must be positive"
    else:
        raise AssertionError("Expected ValueError")

