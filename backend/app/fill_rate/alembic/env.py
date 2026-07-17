from alembic import context
from sqlalchemy import engine_from_config, pool
from app.fill_rate.db import Base
from app.fill_rate.config import fill_rate_settings
import app.fill_rate.models  # register metadata

config = context.config
target_metadata = Base.metadata


def run_migrations_online():
    section = config.get_section(config.config_ini_section) or {}
    # Alembic runs migrations synchronously; swap the app's asyncpg driver for psycopg (v3, sync).
    section["sqlalchemy.url"] = fill_rate_settings.fill_rate_database_url.replace("+asyncpg", "+psycopg")
    connectable = engine_from_config(section, prefix="sqlalchemy.", poolclass=pool.NullPool)
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()


run_migrations_online()
