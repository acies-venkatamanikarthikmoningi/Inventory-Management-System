from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from app.db.session import get_session
from app.schemas.exceptions import ExceptionsResponse, TransferCandidatesResponse
from app.schemas.network import NetworkStateResponse
from app.services.exceptions_service import detect_exceptions, transfer_candidates
from app.services.network_state_service import network_state

router = APIRouter(prefix="/inventory", tags=["inventory"])

@router.get("/network-state", response_model=NetworkStateResponse)
async def get_network_state(node: str | None = None, sku: str | None = None, page: int = Query(1, ge=1), page_size: int = Query(250, ge=1, le=500), session: AsyncSession = Depends(get_session)):
    return await network_state(session, node, sku, page, page_size)

@router.get("/exceptions", response_model=ExceptionsResponse)
async def get_exceptions(session: AsyncSession = Depends(get_session)):
    items = await detect_exceptions(session)
    return {"items": items, "total": len(items)}

@router.get("/transfer-candidates", response_model=TransferCandidatesResponse)
async def get_transfer_candidates(session: AsyncSession = Depends(get_session)):
    items = await transfer_candidates(session)
    return {"items": items, "total": len(items)}
