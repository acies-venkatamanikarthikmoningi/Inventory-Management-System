from datetime import date
from pydantic import BaseModel


class ExceptionItem(BaseModel):
    positionId: str
    skuCode: str
    skuName: str
    node: str
    batch: str
    exceptionType: str
    severity: str
    message: str
    expiryDate: date | None
    daysRemaining: int | None
    availableQty: float


class ExceptionsResponse(BaseModel):
    items: list[ExceptionItem]
    total: int


class TransferCandidate(BaseModel):
    skuCode: str
    skuName: str
    batch: str
    fromNode: str
    fromZone: str
    fromBin: str
    toNode: str | None = None
    toZone: str
    toBin: str
    suggestedQty: float
    reason: str


class TransferCandidatesResponse(BaseModel):
    items: list[TransferCandidate]
    total: int
