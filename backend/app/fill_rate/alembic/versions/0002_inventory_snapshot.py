"""Inventory Snapshot: Fill Rate's own uploaded on-hand quantity facts, used for
Days of Supply. Deliberately duplicated from the main app's InventoryPosition rather
than joined cross-database - see docs/data-model.md for the tradeoff.
"""
from alembic import op
import sqlalchemy as sa

revision = "0002_inventory_snapshot"
down_revision = "0001_fill_rate_foundation"
branch_labels = None
depends_on = None


def keys(*names):
    return [sa.Column("id", sa.Uuid(), primary_key=True), *[sa.Column(name, type_) for name, type_ in names]]


def upgrade():
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


def downgrade():
    op.drop_table("inventory_snapshots")
