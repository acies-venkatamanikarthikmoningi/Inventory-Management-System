"""Fill Rate module foundation: sales/purchase orders and their fulfillment/receipt facts.

Lives in its own migration history (alembic_fill_rate.ini / app/fill_rate/alembic),
targeting the standalone fill_rate_db database - independent of and not
interleaved with the main app's alembic/ history (which targets `inventory`).
"""
from alembic import op
import sqlalchemy as sa

revision = "0001_fill_rate_foundation"
down_revision = None
branch_labels = None
depends_on = None


def keys(*names):
    return [sa.Column("id", sa.Uuid(), primary_key=True), *[sa.Column(name, type_) for name, type_ in names]]


def upgrade():
    op.create_table(
        "sales_orders",
        *keys(
            ("order_number", sa.String(80)), ("sku_code", sa.String(80)), ("node_code", sa.String(80)),
            ("customer_code", sa.String(80)), ("order_date", sa.Date()), ("requested_qty", sa.Numeric(18, 3)),
            ("promised_date", sa.Date()), ("status", sa.String(20)),
        ),
        sa.UniqueConstraint("order_number"),
    )
    op.create_index("ix_sales_orders_sku_code", "sales_orders", ["sku_code"])
    op.create_index("ix_sales_orders_node_code", "sales_orders", ["node_code"])

    op.create_table(
        "order_fulfillments",
        *keys(
            ("sales_order_id", sa.Uuid()), ("fulfilled_qty", sa.Numeric(18, 3)),
            ("fulfillment_date", sa.Date()), ("shipment_reference", sa.String(80)),
        ),
        sa.ForeignKeyConstraint(["sales_order_id"], ["sales_orders.id"]),
    )
    op.create_index("ix_order_fulfillments_sales_order_id", "order_fulfillments", ["sales_order_id"])

    op.create_table(
        "purchase_orders",
        *keys(
            ("po_number", sa.String(80)), ("sku_code", sa.String(80)), ("node_code", sa.String(80)),
            ("supplier_code", sa.String(80)), ("order_date", sa.Date()), ("ordered_qty", sa.Numeric(18, 3)),
            ("expected_date", sa.Date()), ("status", sa.String(20)),
        ),
        sa.UniqueConstraint("po_number"),
    )
    op.create_index("ix_purchase_orders_sku_code", "purchase_orders", ["sku_code"])
    op.create_index("ix_purchase_orders_node_code", "purchase_orders", ["node_code"])

    op.create_table(
        "goods_receipts",
        *keys(
            ("purchase_order_id", sa.Uuid()), ("received_qty", sa.Numeric(18, 3)),
            ("receipt_date", sa.Date()), ("grn_reference", sa.String(80)),
        ),
        sa.ForeignKeyConstraint(["purchase_order_id"], ["purchase_orders.id"]),
    )
    op.create_index("ix_goods_receipts_purchase_order_id", "goods_receipts", ["purchase_order_id"])


def downgrade():
    op.drop_table("goods_receipts")
    op.drop_table("purchase_orders")
    op.drop_table("order_fulfillments")
    op.drop_table("sales_orders")
