from datetime import date, datetime
from io import BytesIO
from openpyxl import load_workbook

PURCHASE_ORDER_REQUIRED_COLUMNS = ["po_number", "sku_code", "node_code", "supplier_code", "order_date", "ordered_qty"]
GOODS_RECEIPT_REQUIRED_COLUMNS = ["po_number", "received_qty", "receipt_date"]


class UploadValidationError(Exception):
    def __init__(self, message: str):
        self.message = message
        super().__init__(message)


def _normalize_header(value) -> str | None:
    if value is None:
        return None
    return str(value).strip().lower().replace(" ", "_").replace("-", "_")


def coerce_date(value):
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    return date.fromisoformat(str(value).strip())


def parse_xlsx_rows(file_bytes: bytes, required_columns: list[str]) -> list[dict]:
    """Reads the first sheet of an .xlsx file into a list of {normalized_header: value}
    dicts. Column names are matched case/spacing-insensitively (e.g. "PO Number",
    "po-number", "po_number" all resolve to "po_number")."""
    try:
        workbook = load_workbook(BytesIO(file_bytes), read_only=True, data_only=True)
    except Exception as exc:
        raise UploadValidationError(f"Could not read file as .xlsx: {exc}") from exc

    sheet = workbook.active
    rows_iter = sheet.iter_rows(values_only=True)
    try:
        header_row = next(rows_iter)
    except StopIteration:
        raise UploadValidationError("File is empty - no header row found")

    headers = [_normalize_header(h) for h in header_row]
    missing = [col for col in required_columns if col not in headers]
    if missing:
        found = [h for h in headers if h is not None]
        raise UploadValidationError(f"Missing required column(s): {', '.join(missing)}. Found columns: {', '.join(found)}")

    rows = []
    for row in rows_iter:
        if row is None or all(v is None for v in row):
            continue
        rows.append({h: v for h, v in zip(headers, row) if h is not None})
    return rows
