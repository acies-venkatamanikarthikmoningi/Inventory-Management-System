from datetime import datetime
from pydantic import BaseModel


class SimulationRunRequest(BaseModel):
    skuCodes: list[str] | None = None
    nodeCodes: list[str] | None = None
    nRuns: int | None = None
    horizonDays: int | None = None
    seed: int | None = None


class SimulationRunResponse(BaseModel):
    runId: str
    requestedAt: datetime
    seed: int
    nRuns: int
    horizonDays: int
    skuCodes: list[str]
    nodeCodes: list[str]
    status: str
    durationSeconds: float
    detail: str


class SimulationResultItem(BaseModel):
    runId: str
    skuCode: str
    nodeCode: str
    policyRole: str
    policyType: str
    policyParams: dict
    serviceLevelAchieved: float
    avgEndingInventory: float
    totalHoldingCost: float
    totalShortageCost: float
    p95ShortageQty: float
    compositeScore: float
    serviceStability: float
    stockoutResilience: float
    costStability: float
    expiryRobustness: float
    inventoryStability: float
    governanceAction: str | None = None


class SimulationResultsResponse(BaseModel):
    runId: str | None
    seed: int | None
    nRuns: int | None
    horizonDays: int | None
    status: str | None
    items: list[SimulationResultItem]
    total: int
