import asyncio
import logging
import subprocess

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api.v1 import health
from app.api.v1.router import router
from app.core.config import settings
from app.fill_rate.api import router as fill_rate_router

app = FastAPI(title=settings.app_name)
logger = logging.getLogger(__name__)


def _run_bootstrap_command(command: list[str]) -> None:
    subprocess.run(command, check=True)


async def bootstrap_database() -> None:
    commands = [
        ["alembic", "upgrade", "head"],
        ["alembic", "-c", "alembic_fill_rate.ini", "upgrade", "head"],
        ["python", "-m", "app.seed.network_foundation"],
        ["python", "-m", "app.seed.multi_node"],
        ["python", "-m", "app.seed.exceptions_and_expiry"],
        ["python", "-m", "app.seed.dynamic_policy"],
        ["python", "-m", "app.fill_rate.seed"],
    ]
    for command in commands:
        logger.info("Running bootstrap command: %s", " ".join(command))
        await asyncio.to_thread(_run_bootstrap_command, command)


@app.on_event("startup")
async def startup_bootstrap() -> None:
    asyncio.create_task(bootstrap_database())


app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.cors_origins.split(",")],
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(health.router)
app.include_router(router, prefix="/api/v1")
# Fill Rate is a separate module with its own database (app/fill_rate/db.py) -
# its routes are wired in directly here rather than through api/v1/router.py,
# which is scoped to the Phase 1-5 modules sharing the main `inventory` DB.
app.include_router(fill_rate_router, prefix="/api/v1")
