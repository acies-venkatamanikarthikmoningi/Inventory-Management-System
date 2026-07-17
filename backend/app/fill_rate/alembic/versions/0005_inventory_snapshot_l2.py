"""Replace the earlier (dormant, never-seeded, never-wired-to-an-endpoint)
inventory_snapshots schema with L2 Days of Supply's authoritative one, matching
seed_data/Inventory_Snapshot.xlsx exactly.

NOT SAFELY REVERSIBLE: the old schema was never seeded or used by any endpoint, so
there is no real data to preserve either direction - this is a straightforward
schema replacement, same as 0004's sales_orders/goods_sent replacement.
"""
from alembic import op
import sqlalchemy as sa

revision = "0005_inventory_snapshot_l2"
down_revision = "0004_l1_fill_rate_schema"
branch_labels = None
depends_on = None


def keys(*names):
    return [sa.Column("id", sa.Uuid(), primary_key=True), *[sa.Column(name, type_) for name, type_ in names]]


def upgrade():
    op.drop_table("inventory_snapshots")
    op.create_table(
        "inventory_snapshots",
        *keys(
            ("snapshot_date", sa.Date()), ("day", sa.String(10)), ("sku_code", sa.String(80)),
            ("sku_name", sa.String(255)), ("on_hand_before_shipment", sa.Numeric(18, 3)),
            ("qty_shipped", sa.Numeric(18, 3)), ("on_hand_eod", sa.Numeric(18, 3)),
        ),
        sa.UniqueConstraint("sku_code", "snapshot_date", name="uq_inventory_snapshot_sku_date"),
    )
    op.create_index("ix_inventory_snapshots_snapshot_date", "inventory_snapshots", ["snapshot_date"])
    op.create_index("ix_inventory_snapshots_sku_code", "inventory_snapshots", ["sku_code"])


def downgrade():
    op.drop_table("inventory_snapshots")
    op.create_table(
        "inventory_snapshots",
        *keys(
            ("sku_code", sa.String(80)), ("node_code", sa.String(80)),
            ("snapshot_date", sa.Date()), ("on_hand_qty", sa.Numeric(18, 3)),
        ),
        sa.UniqueConstraint("sku_code", "node_code", "snapshot_date", name="uq_inventory_snapshot_sku_node_date"),
    )
    op.create_index("ix_inventory_snapshots_sku_code", "inventory_snapshots", ["sku_code"])
    op.create_index("ix_inventory_snapshots_node_code", "inventory_snapshots", ["node_code"])
