from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from app.db.session import get_session
from app.schemas.network import NetworkGraphResponse
from app.services.network_state_service import network_graph

router = APIRouter(prefix="/network", tags=["network"])

@router.get("/graph", response_model=NetworkGraphResponse)
async def get_network_graph(session: AsyncSession = Depends(get_session)):
    return await network_graph(session)
