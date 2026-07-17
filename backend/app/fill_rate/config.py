from pydantic_settings import BaseSettings, SettingsConfigDict


class FillRateSettings(BaseSettings):
    # Deliberately its own env var, no shared prefix with the main app's
    # INVENTORY_-prefixed Settings (app/core/config.py) - this module's
    # database configuration must not accidentally fall back to the main
    # database_url if unset.
    fill_rate_database_url: str = "postgresql+asyncpg://inventory:inventory@db:5432/fill_rate_db"
    model_config = SettingsConfigDict(env_file=".env", env_prefix="")


fill_rate_settings = FillRateSettings()
