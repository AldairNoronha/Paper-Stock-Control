import asyncio
from collections.abc import Callable
from dataclasses import dataclass
from typing import Annotated, Any
from uuid import UUID

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import PyJWKClient
from jwt.exceptions import PyJWTError
from sqlalchemy import select

from app.core.config import Settings, get_settings
from app.core.database import session_factory
from app.modules.identity.domain.models import Role, UserProfile, UserRole

bearer_scheme = HTTPBearer(auto_error=False)


@dataclass(frozen=True, slots=True)
class CurrentUser:
    id: UUID
    display_name: str
    email: str | None
    roles: frozenset[str]

    def has_any_role(self, required: set[str]) -> bool:
        return bool(self.roles.intersection(required))


class JwtVerifier:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._jwks_client = PyJWKClient(settings.supabase_jwks_url)

    def _decode_sync(self, token: str) -> dict[str, Any]:
        if self._settings.supabase_jwt_secret:
            payload = jwt.decode(
                token,
                self._settings.supabase_jwt_secret,
                algorithms=["HS256"],
                audience="authenticated",
                options={"require": ["exp", "sub"]},
            )
        else:
            signing_key = self._jwks_client.get_signing_key_from_jwt(token)
            payload = jwt.decode(
                token,
                signing_key.key,
                algorithms=["ES256", "RS256"],
                audience="authenticated",
                options={"require": ["exp", "sub"]},
            )
        return payload

    async def decode(self, token: str) -> dict[str, Any]:
        return await asyncio.to_thread(self._decode_sync, token)


async def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> CurrentUser:
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="missing bearer token",
        )

    try:
        claims = await JwtVerifier(settings).decode(credentials.credentials)
        user_id = UUID(str(claims["sub"]))
    except (KeyError, ValueError, PyJWTError) as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid access token",
        ) from exc

    async with session_factory() as session:
        profile = await session.get(UserProfile, user_id)
        if profile is None or not profile.is_active:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="user is not enabled for this application",
            )
        role_codes = set(
            (
                await session.scalars(
                    select(Role.code)
                    .join(UserRole, UserRole.role_id == Role.id)
                    .where(UserRole.user_id == user_id)
                )
            ).all()
        )

    return CurrentUser(
        id=profile.id,
        display_name=profile.display_name,
        email=profile.email,
        roles=frozenset(role_codes),
    )


CurrentUserDependency = Annotated[CurrentUser, Depends(get_current_user)]


def require_roles(*role_codes: str) -> Callable[[CurrentUserDependency], Any]:
    required = set(role_codes)

    async def dependency(user: CurrentUserDependency) -> CurrentUser:
        if not user.has_any_role(required):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"one of these roles is required: {', '.join(sorted(required))}",
            )
        return user

    return dependency
