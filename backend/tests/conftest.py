import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from app.db.base import Base
import app.models  # noqa: F401  register table metadata on Base
from app.models import Area, Bin, BinType, Node, Sku, Zone


@pytest_asyncio.fixture
async def session():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as db_session:
        yield db_session
    await engine.dispose()


async def seed_sku(session, sku_code, description="Test SKU"):
    session.add(Sku(sku_code=sku_code, description=description, active=True))
    await session.flush()


async def seed_node(session, node_code):
    session.add(Node(node_code=node_code, description=node_code, active=True))
    await session.flush()


async def seed_bin(session, *, area_code, zone_code, bin_code, face="RESERVE", pallet_capacity=1):
    type_code = f"{bin_code}-TYPE"
    session.add_all([
        Area(area_code=area_code, description=area_code, type="INVENTORY", active=True),
        Zone(zone_code=zone_code, description=zone_code, face=face, area_code=area_code, active=True),
        BinType(type_code=type_code, description=type_code, max_volume_m3=1, max_weight_kg=1, bin_pallet_capacity=pallet_capacity, storage_hu_type="PALLET", active=True),
    ])
    await session.flush()
    session.add(Bin(bin_code=bin_code, description=bin_code, type_code=type_code, zone_code=zone_code, status="ACTIVE"))
    await session.flush()
