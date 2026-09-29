import argparse
import asyncio
from uuid import UUID

from sqlalchemy import select

from app.core.database import dispose_engine, session_factory
from app.modules.identity.domain.models import Role, UserProfile, UserRole


async def bootstrap_admin(user_id: UUID, display_name: str, email: str | None) -> None:
    async with session_factory() as session, session.begin():
        profile = await session.get(UserProfile, user_id)
        if profile is None:
            profile = UserProfile(id=user_id, display_name=display_name, email=email)
            session.add(profile)
        else:
            profile.display_name = display_name
            profile.email = email
            profile.is_active = True

        admin_role = await session.scalar(select(Role).where(Role.code == "ADMIN"))
        if admin_role is None:
            raise RuntimeError("ADMIN role not found; run Alembic migrations first")
        assignment = await session.scalar(
            select(UserRole.id).where(
                UserRole.user_id == user_id,
                UserRole.role_id == admin_role.id,
            )
        )
        if assignment is None:
            session.add(UserRole(user_id=user_id, role_id=admin_role.id))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Enable a Supabase Auth user as application administrator."
    )
    parser.add_argument("user_id", type=UUID, help="Supabase Auth user UUID")
    parser.add_argument("display_name")
    parser.add_argument("--email")
    return parser.parse_args()


async def main() -> None:
    args = parse_args()
    try:
        await bootstrap_admin(args.user_id, args.display_name, args.email)
    finally:
        await dispose_engine()


if __name__ == "__main__":
    asyncio.run(main())
