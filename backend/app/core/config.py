from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Inventory Network API"
    database_url: str = "postgresql+asyncpg://inventory:inventory@db:5432/inventory"
    # Comma-separated list of allowed browser origins for the frontend dev server / deployment.
    cors_origins: str = "*"
    # The repository seed files are deliberately the source for Phase 1 data.
    source_data_dir: Path = Path(__file__).resolve().parents[3] / "src" / "data"
    model_config = SettingsConfigDict(env_file=".env", env_prefix="INVENTORY_")


settings = Settings()
