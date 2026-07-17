from datetime import datetime
from pydantic import BaseModel


class OptimizationRunRequest(BaseModel):
    skuCodes: list[str] | None = None
    nodeCodes: list[str] | None = None
    horizonDays: int | None = None


class OptimizationRunResponse(BaseModel):
    runId: str
    requestedAt: datetime
    nodeCodes: list[str]
    skuCodes: list[str]
    horizonDays: int
    scenarioSet: list[dict]
    solverStatus: str
    objectiveValue: float | None
    solveSeconds: float
    detail: str


class OptimizationRecommendationItem(BaseModel):
    runId: str
    recommendationType: str
    skuCode: str
    nodeCode: str
    sourceNodeCode: str | None
    periodIndex: int
    scenarioName: str
    quantity: float


class OptimizationRecommendationsResponse(BaseModel):
    runId: str | None
    items: list[OptimizationRecommendationItem]
    total: int
