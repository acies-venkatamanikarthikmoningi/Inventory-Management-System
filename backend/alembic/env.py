from alembic import context
from sqlalchemy import engine_from_config, pool
from app.db.base import Base
from app.core.config import settings
import app.models  # register metadata

config = context.config
target_metadata = Base.metadata


def run_migrations_online():
    section = config.get_section(config.config_ini_section) or {}
    # Render may provide postgres:// or postgresql:// URLs without an explicit driver.
    # Force the sync psycopg v3 dialect so Alembic doesn't fall back to psycopg2.
    database_url = settings.database_url
    database_url = database_url.replace("postgresql+asyncpg://", "postgresql+psycopg://")
    database_url = database_url.replace("postgresql://", "postgresql+psycopg://")
    database_url = database_url.replace("postgres://", "postgresql+psycopg://")
    section["sqlalchemy.url"] = database_url
    connectable = engine_from_config(section, prefix="sqlalchemy.", poolclass=pool.NullPool)
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()


run_migrations_online()
