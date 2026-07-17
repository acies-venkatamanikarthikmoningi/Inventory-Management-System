from datetime import date, datetime
from pydantic import BaseModel


class PurchaseOrderResponse(BaseModel):
    id: str
    poNumber: str
    skuCode: str
    node: str
    supplierCode: str
    orderDate: date
    orderedQty: float
    receivedQty: float
    expectedDate: date | None
    status: str


class PurchaseOrdersResponse(BaseModel):
    items: list[PurchaseOrderResponse]
    total: int


class FillRateSummaryResponse(BaseModel):
    totalOrders: int
    ordersFilledComplete: int
    fillRate: float
    isException: bool


class SkuFillRateItem(BaseModel):
    skuCode: str
    skuName: str
    totalOrders: int
    ordersFilledComplete: int
    fillRate: float
    isException: bool


class SkuFillRateResponse(BaseModel):
    items: list[SkuFillRateItem]
    total: int


class DosPoint(BaseModel):
    date: date
    onHand: float
    demand: float
    dos: float | None


class DiagnosticsResponse(BaseModel):
    totalOrders: int
    stockoutCount: int
    stockoutRate: float
    isStockoutException: bool
    backorderCount: int
    backorderRate: float
    isBackorderException: bool
    dosTrend: list[DosPoint]
    diagnosticMessage: str


class SkuDiagnosticsItem(DiagnosticsResponse):
    skuCode: str
    skuName: str


class SkuDiagnosticsResponse(BaseModel):
    items: list[SkuDiagnosticsItem]
    total: int


class SupplierFillRateItem(BaseModel):
    skuCode: str
    node: str
    supplierCode: str
    ordersCount: int
    orderedQty: float
    receivedQty: float
    fillRatePct: float


class SupplierFillRateResponse(BaseModel):
    items: list[SupplierFillRateItem]
    total: int


class TriageItem(BaseModel):
    skuCode: str
    status: str
    fillRate: float
    stockoutRate: float
    backorderRate: float
    flaggedDrivers: list[str]


class TriageResponse(BaseModel):
    items: list[TriageItem]
    total: int


class RcaStep1(BaseModel):
    unservedUnits: float


class RcaStep2(BaseModel):
    startingOnHand: float
    requiredBuffer: float | None
    wasStructurallyInsufficient: bool | None


class RcaStep3(BaseModel):
    causalDrivers: list[str]
    noncausalButRealDrivers: list[str]


class RcaStep4(BaseModel):
    gapPct: float | None


class RcaStep5(BaseModel):
    isStale: bool
    driftPct: float | None
    freshRmseD: float | None


class RecommendationReason(BaseModel):
    driver: str
    wasCausal: bool | None


class RcaResponse(BaseModel):
    skuCode: str
    step1: RcaStep1
    step2: RcaStep2
    step3: RcaStep3
    step4: RcaStep4
    step5: RcaStep5
    primaryCause: str
    recommendation: list[str]
    recommendationReasons: dict[str, list[RecommendationReason]]


class ApplyRecommendationRequest(BaseModel):
    date_from: date
    date_to: date
    approved_by: str
    actions: list[str] | None = None


class AppliedActionItem(BaseModel):
    id: str
    actionTaken: str
    oldBaseline: float | None
    newBaseline: float | None
    approvedBy: str
    approvedAt: datetime


class ApplyRecommendationResponse(BaseModel):
    skuCode: str
    primaryCause: str
    actions: list[AppliedActionItem]


class MeasurementResponse(BaseModel):
    skuCode: str
    beforeFillRate: float
    afterFillRate: float
    delta: float
    improved: bool


class UploadRowError(BaseModel):
    row: int
    message: str


class UploadResult(BaseModel):
    inserted: int
    updated: int
    skipped: int
    errors: list[UploadRowError]
