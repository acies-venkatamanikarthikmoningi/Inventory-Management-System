from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from app.core.config import settings


def _async_database_url(url: str) -> str:
    normalized = url.replace("postgresql+psycopg://", "postgresql+asyncpg://")
    normalized = normalized.replace("postgresql://", "postgresql+asyncpg://")
    normalized = normalized.replace("postgres://", "postgresql+asyncpg://")
    return normalized


engine = create_async_engine(_async_database_url(settings.database_url), pool_pre_ping=True)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


async def get_session():
    async with SessionLocal() as session:
        yield session
