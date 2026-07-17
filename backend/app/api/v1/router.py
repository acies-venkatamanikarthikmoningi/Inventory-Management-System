from fastapi import APIRouter
from app.api.v1 import inventory, network, optimization, policy, simulation

router = APIRouter()
router.include_router(inventory.router)
router.include_router(network.router)
router.include_router(policy.router)
router.include_router(optimization.router)
router.include_router(simulation.router)
