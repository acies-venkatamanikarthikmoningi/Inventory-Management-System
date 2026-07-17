from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase
from app.fill_rate.config import fill_rate_settings


class Base(DeclarativeBase):
    """Fill Rate's own declarative registry.

    Deliberately separate from app.db.base.Base - fill_rate's models must
    never be registered on the main app's metadata/engine, since the two
    modules are meant to live in genuinely separate Postgres databases.
    """


engine = create_async_engine(fill_rate_settings.fill_rate_database_url, pool_pre_ping=True)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


async def get_session():
    async with SessionLocal() as session:
        yield session
