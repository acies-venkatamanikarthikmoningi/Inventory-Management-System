from datetime import date
from pydantic import BaseModel


class LocationRef(BaseModel):
    areaCode: str
    areaDescription: str
    zoneCode: str
    zoneDescription: str
    binCode: str
    binDescription: str


class InventoryPositionResponse(LocationRef):
    id: str
    skuCode: str
    skuName: str
    node: str
    batch: str
    onHandQty: float
    inTransitQty: float
    reservedQty: float
    availableQty: float
    inventoryPositionQty: float
    status: str
    expiry: date | None
    mfgDate: date | None
    shelfLifeMonths: int | None
    # Phase 6/6.1: the SKU/node's current named policy type (from its latest
    # PolicySnapshot) and its latest network-wide-evaluation Robustness
    # composite score + governance tier (from PolicyRecommendation, written
    # by POST /policy/recommendations/refresh) - all None when no evaluation
    # has run yet for this pair, never fabricated.
    policyType: str | None = None
    robustnessScore: float | None = None
    governanceAction: str | None = None


class NetworkStateResponse(BaseModel):
    items: list[InventoryPositionResponse]
    total: int
    page: int
    pageSize: int


class NetworkGraphResponse(BaseModel):
    nodes: list[dict]
    edges: list[dict]
