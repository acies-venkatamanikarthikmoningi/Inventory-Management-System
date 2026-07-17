from datetime import datetime
from pydantic import BaseModel


class PolicyDriftEvidence(BaseModel):
    label: str
    fromValue: str
    toValue: str


class PolicyDriftImpact(BaseModel):
    label: str
    value: str


class PolicyDriftItem(BaseModel):
    skuCode: str
    skuName: str
    node: str
    metric: str
    previousValue: float
    currentValue: float
    driftPct: float
    driftDirection: str
    previousComputedAt: datetime
    currentComputedAt: datetime
    evidence: list[PolicyDriftEvidence]
    explanation: str
    impact: list[PolicyDriftImpact]


class PolicyDriftResponse(BaseModel):
    items: list[PolicyDriftItem]
    total: int


class PolicySnapshotItem(BaseModel):
    skuCode: str
    node: str
    computedAt: datetime

    reviewPeriodDays: float
    serviceLevel: float
    zScore: float

    addRolling: float
    rmseD: float
    lActual: float
    rmseLt: float
    fillRate: float

    safetyStock: float

    baseRop: float
    totalShelfLifeDays: float
    minShelfLifeRequiredDays: float
    maxHoldableStock: float
    enhancedRop: float

    eoq: float
    rawMax: float
    warehouseCapacityQty: float
    shelfLifeCapacityQty: float
    finalMax: float


class PolicyRefreshResponse(BaseModel):
    items: list[PolicySnapshotItem]
    total: int


class PolicyRecommendationItem(BaseModel):
    skuCode: str
    node: str
    computedAt: datetime
    currentPolicyType: str
    suggestedPolicyType: str | None = None
    currentParams: dict
    suggestedParams: dict | None = None
    reasoning: str
    governanceAction: str
    currentCompositeScore: float
    currentServiceStability: float
    currentStockoutResilience: float
    currentCostStability: float
    currentExpiryRobustness: float
    currentInventoryStability: float
    currentServiceLevelAchieved: float
    currentTotalCost: float
    currentTotalHoldingCost: float
    currentTotalShortageCost: float
    suggestedCompositeScore: float | None = None
    suggestedServiceStability: float | None = None
    suggestedStockoutResilience: float | None = None
    suggestedCostStability: float | None = None
    suggestedExpiryRobustness: float | None = None
    suggestedInventoryStability: float | None = None
    suggestedServiceLevelAchieved: float | None = None
    suggestedTotalCost: float | None = None
    suggestedTotalHoldingCost: float | None = None
    suggestedTotalShortageCost: float | None = None
    isDemoSeed: bool = False


class PolicyRecommendationsResponse(BaseModel):
    items: list[PolicyRecommendationItem]
    total: int


class PolicyRecommendationsRefreshResponse(BaseModel):
    total: int
    durationSeconds: float
    totalSimulations: int
    tierCounts: dict[str, int]


class PolicyChangeAuditLogItem(BaseModel):
    id: str
    skuCode: str
    nodeCode: str
    oldPolicyType: str
    oldParams: dict
    newPolicyType: str
    newParams: dict
    robustnessScoreAtChange: float
    changedAt: datetime
    changedBy: str
    isDemoSeed: bool = False


class PolicyAuditLogResponse(BaseModel):
    items: list[PolicyChangeAuditLogItem]
    total: int


class PolicyApproveChangeRequest(BaseModel):
    skuCode: str
    nodeCode: str
    approvedBy: str | None = None
    robustnessScore: float | None = None


class PolicyApproveChangeResponse(BaseModel):
    applied: bool
    audit: PolicyChangeAuditLogItem | None = None
