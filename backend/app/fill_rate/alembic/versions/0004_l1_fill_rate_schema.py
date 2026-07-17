"""Replace the earlier sales_orders/order_fulfillments schema with the L1 Fill Rate
schema that matches the real seed_data files exactly:
  sales_orders  <- Order_File_Week1.xlsx ("Orders" sheet)
  goods_sent    <- Goods_Sent_Register.xlsx

NOT SAFELY REVERSIBLE: this is a schema replacement, not a column tweak - the old
sales_orders/order_fulfillments tables (and any data in them) are dropped outright.
downgrade() recreates the pre-L1 shape (post-0003, i.e. already without
customer_code) so a rollback restores the SCHEMA, but none of the old or new
tables' data survives either direction.
"""
from alembic import op
import sqlalchemy as sa

revision = "0004_l1_fill_rate_schema"
down_revision = "0003_drop_customer_code"
branch_labels = None
depends_on = None


def keys(*names):
    return [sa.Column("id", sa.Uuid(), primary_key=True), *[sa.Column(name, type_) for name, type_ in names]]


def upgrade():
    op.drop_table("order_fulfillments")
    op.drop_table("sales_orders")

    op.create_table(
        "sales_orders",
        *keys(
            ("order_id", sa.String(80)), ("order_date", sa.Date()), ("day", sa.String(10)),
            ("sku_code", sa.String(80)), ("sku_name", sa.String(255)), ("node", sa.String(120)),
            ("requested_qty", sa.Numeric(18, 3)),
        ),
        sa.UniqueConstraint("order_id"),
    )
    op.create_index("ix_sales_orders_order_id", "sales_orders", ["order_id"])
    op.create_index("ix_sales_orders_sku_code", "sales_orders", ["sku_code"])
    op.create_index("ix_sales_orders_node", "sales_orders", ["node"])

    op.create_table(
        "goods_sent",
        *keys(("order_id", sa.String(80)), ("shipped_qty", sa.Numeric(18, 3))),
        sa.ForeignKeyConstraint(["order_id"], ["sales_orders.order_id"]),
    )
    op.create_index("ix_goods_sent_order_id", "goods_sent", ["order_id"])


def downgrade():
    op.drop_table("goods_sent")
    op.drop_table("sales_orders")

    op.create_table(
        "sales_orders",
        *keys(
            ("order_number", sa.String(80)), ("sku_code", sa.String(80)), ("node_code", sa.String(80)),
            ("order_date", sa.Date()), ("requested_qty", sa.Numeric(18, 3)),
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
