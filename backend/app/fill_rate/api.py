from datetime import date
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from app.fill_rate import service
from app.fill_rate.db import get_session
from app.fill_rate.rca_service import InvalidActionError, RcaNotResponsibleError, apply_recommendation, compare_periods, run_rca
from app.fill_rate.schemas import (
    ApplyRecommendationRequest, ApplyRecommendationResponse, DiagnosticsResponse, FillRateSummaryResponse,
    MeasurementResponse, PurchaseOrdersResponse, RcaResponse, SkuDiagnosticsResponse, SkuFillRateResponse,
    SupplierFillRateResponse, TriageResponse, UploadResult,
)
from app.fill_rate.triage_service import run_triage
from app.fill_rate.upload import (
    GOODS_RECEIPT_REQUIRED_COLUMNS, PURCHASE_ORDER_REQUIRED_COLUMNS, UploadValidationError, parse_xlsx_rows,
)

router = APIRouter(prefix="/fill-rate", tags=["fill-rate"])


async def _parse_upload(file: UploadFile, required_columns: list[str]) -> list[dict]:
    if not file.filename or not file.filename.lower().endswith(".xlsx"):
        raise HTTPException(status_code=400, detail="Only .xlsx files are supported")
    content = await file.read()
    try:
        return parse_xlsx_rows(content, required_columns)
    except UploadValidationError as exc:
        raise HTTPException(status_code=400, detail=exc.message) from exc


@router.get("/ready")
async def ready(session: AsyncSession = Depends(get_session)):
    """Proves this module's connection is genuinely its own: this hits
    fill_rate_db, not the main inventory database (see app/db/session.py's
    /api/v1/../ready for the main app's equivalent, which hits `inventory`)."""
    try:
        await session.execute(text("SELECT 1"))
    except Exception as exc:
        raise HTTPException(status_code=503, detail="fill_rate database unavailable") from exc
    return {"status": "ready"}


@router.get("/summary", response_model=FillRateSummaryResponse)
async def get_fill_rate_summary(
    node: str | None = None, date_from: date | None = None, date_to: date | None = None,
    session: AsyncSession = Depends(get_session),
):
    """The L1 Fill Rate result - always computed fresh from SalesOrder LEFT JOIN
    GoodsSent, never itself an upload/input (see service.compute_fill_rate)."""
    return await service.compute_fill_rate(session, node=node, date_from=date_from, date_to=date_to)


@router.get("/summary/by-sku", response_model=SkuFillRateResponse)
async def get_fill_rate_by_sku(
    node: str | None = None, date_from: date | None = None, date_to: date | None = None,
    session: AsyncSession = Depends(get_session),
):
    items = await service.compute_fill_rate_by_sku(session, node, date_from, date_to)
    return {"items": items, "total": len(items)}


@router.get("/diagnostics", response_model=DiagnosticsResponse)
async def get_diagnostics(
    node: str | None = None, sku_code: str | None = None,
    date_from: date | None = None, date_to: date | None = None,
    session: AsyncSession = Depends(get_session),
):
    """L2 diagnostics - Stockout Rate, Backorder Rate, and Days of Supply.
    Omit sku_code for the DC-level view; include it for a single SKU."""
    return await service.get_l2_diagnostics(session, node, sku_code, date_from, date_to)


@router.get("/diagnostics/by-sku", response_model=SkuDiagnosticsResponse)
async def get_diagnostics_by_sku(
    node: str | None = None, date_from: date | None = None, date_to: date | None = None,
    session: AsyncSession = Depends(get_session),
):
    items = await service.get_l2_diagnostics_by_sku(session, node, date_from, date_to)
    return {"items": items, "total": len(items)}


@router.get("/purchase-orders", response_model=PurchaseOrdersResponse)
async def get_purchase_orders(sku: str | None = None, node: str | None = None, session: AsyncSession = Depends(get_session)):
    items = await service.list_purchase_orders(session, sku, node)
    return {"items": items, "total": len(items)}


@router.get("/supplier-summary", response_model=SupplierFillRateResponse)
async def get_supplier_fill_rate_summary(sku: str | None = None, node: str | None = None, session: AsyncSession = Depends(get_session)):
    items = await service.supplier_fill_rate_summary(session, sku, node)
    return {"items": items, "total": len(items)}


@router.get("/triage", response_model=TriageResponse)
async def get_triage(
    date_from: date | None = None, date_to: date | None = None, session: AsyncSession = Depends(get_session),
):
    """L4 Triage - one row per SKU present in SalesOrder for the period, classified
    responsible/unexplained/watch/healthy by combining L1/L2/L3 (see
    triage_service.run_triage)."""
    items = await run_triage(session, date_from, date_to)
    return {"items": items, "total": len(items)}


@router.get("/rca/{sku_code}", response_model=RcaResponse)
async def get_rca(
    sku_code: str, date_from: date, date_to: date, session: AsyncSession = Depends(get_session),
):
    """L4 RCA - only runs for a sku/period Triage marked "responsible"; returns 400
    otherwise (see rca_service.run_rca)."""
    try:
        return await run_rca(session, sku_code, date_from, date_to)
    except RcaNotResponsibleError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/rca/{sku_code}/apply", response_model=ApplyRecommendationResponse)
async def post_apply_recommendation(
    sku_code: str, body: ApplyRecommendationRequest, session: AsyncSession = Depends(get_session),
):
    """L5 Action - applies ("Update ERP Parameters") or logs (every other action)
    the approved action(s) from the RCA recommendation for this sku/period.
    body.actions is optional - omit it to approve every recommended action at
    once, or pass a subset for partial approval (see
    rca_service.apply_recommendation)."""
    try:
        return await apply_recommendation(
            session, sku_code, body.date_from, body.date_to, body.approved_by, body.actions,
        )
    except (RcaNotResponsibleError, InvalidActionError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/measurement/{sku_code}", response_model=MeasurementResponse)
async def get_measurement(
    sku_code: str, before_from: date, before_to: date, after_from: date, after_to: date,
    session: AsyncSession = Depends(get_session),
):
    """Measurement - before/after Fill Rate comparison for this sku, reusing
    compute_fill_rate for both periods (see rca_service.compare_periods)."""
    return await compare_periods(session, sku_code, before_from, before_to, after_from, after_to)


@router.get("/drivers/screen")
async def get_driver_screening(
    date_from: date | None = None, date_to: date | None = None, session: AsyncSession = Depends(get_session),
):
    """L3 Driver Screening - all 5 drivers, per SKU present in SalesOrder for this
    period. No response_model here: each driver's payload shape legitimately varies
    by status ("ok" / "insufficient_data" / "baseline_established"), so a single
    rigid schema would either force every field Optional or force a Union type for
    little benefit over documenting the shapes in service.py's driver functions."""
    items = await service.screen_all_drivers(session, date_from, date_to)
    return {"items": items, "total": len(items)}


@router.post("/upload/purchase-orders", response_model=UploadResult)
async def upload_purchase_orders(file: UploadFile = File(...), session: AsyncSession = Depends(get_session)):
    rows = await _parse_upload(file, PURCHASE_ORDER_REQUIRED_COLUMNS)
    return await service.upsert_purchase_orders(session, rows)


@router.post("/upload/goods-receipts", response_model=UploadResult)
async def upload_goods_receipts(file: UploadFile = File(...), session: AsyncSession = Depends(get_session)):
    rows = await _parse_upload(file, GOODS_RECEIPT_REQUIRED_COLUMNS)
    return await service.insert_goods_receipts(session, rows)
