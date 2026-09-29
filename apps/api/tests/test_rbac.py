from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.modules.identity.application.auth import CurrentUser, require_roles


def user_with(*roles: str) -> CurrentUser:
    return CurrentUser(
        id=uuid4(),
        display_name="Test User",
        email="test@example.com",
        roles=frozenset(roles),
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("role", ["OPERATOR", "SUPERVISOR", "ADMIN"])
async def test_operator_command_accepts_authorized_roles(role: str) -> None:
    dependency = require_roles("OPERATOR", "SUPERVISOR", "ADMIN")
    user = user_with(role)

    assert await dependency(user) is user


@pytest.mark.asyncio
@pytest.mark.parametrize("role", ["QUALITY", "PCP", "VIEWER"])
async def test_operator_command_rejects_unauthorized_roles(role: str) -> None:
    dependency = require_roles("OPERATOR", "SUPERVISOR", "ADMIN")

    with pytest.raises(HTTPException) as exception:
        await dependency(user_with(role))

    assert exception.value.status_code == 403
