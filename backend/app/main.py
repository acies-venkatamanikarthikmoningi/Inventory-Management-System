from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api.v1 import health
from app.api.v1.router import router
from app.core.config import settings
from app.fill_rate.api import router as fill_rate_router

app = FastAPI(title=settings.app_name)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.cors_origins.split(",")],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)
app.include_router(health.router)
app.include_router(router, prefix="/api/v1")
# Fill Rate is a separate module with its own database (app/fill_rate/db.py) -
# its routes are wired in directly here rather than through api/v1/router.py,
# which is scoped to the Phase 1-5 modules sharing the main `inventory` DB.
app.include_router(fill_rate_router, prefix="/api/v1")
