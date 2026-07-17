"""Dynamic Policy: demand/lead-time variability observations, SKU cost profiles,
and versioned policy snapshots (Safety Stock / ROP / MAX)."""
from alembic import op
import sqlalchemy as sa

revision = "0003_dynamic_policy"
down_revision = "0002_exceptions_and_expiry"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("skus", sa.Column("classification", sa.String(30), nullable=True))

    op.create_table(
        "demand_observations",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("sku_code", sa.String(80)),
        sa.Column("node_code", sa.String(80)),
        sa.Column("observed_date", sa.Date()),
        sa.Column("forecast_qty", sa.Numeric(14, 3)),
        sa.Column("actual_qty", sa.Numeric(14, 3)),
        sa.ForeignKeyConstraint(["sku_code"], ["skus.sku_code"]),
        sa.ForeignKeyConstraint(["node_code"], ["nodes.node_code"]),
    )

    op.create_table(
        "lead_time_observations",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("sku_code", sa.String(80)),
        sa.Column("node_code", sa.String(80)),
        sa.Column("order_date", sa.Date()),
        sa.Column("promised_lead_time_days", sa.Numeric(6, 2)),
        sa.Column("actual_lead_time_days", sa.Numeric(6, 2)),
        sa.Column("ordered_qty", sa.Numeric(14, 3)),
        sa.Column("received_qty", sa.Numeric(14, 3)),
        sa.ForeignKeyConstraint(["sku_code"], ["skus.sku_code"]),
        sa.ForeignKeyConstraint(["node_code"], ["nodes.node_code"]),
    )

    op.create_table(
        "sku_cost_profiles",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("sku_code", sa.String(80)),
        sa.Column("unit_cost", sa.Numeric(12, 2)),
        sa.Column("holding_cost_pct", sa.Numeric(5, 4)),
        sa.Column("ordering_cost", sa.Numeric(12, 2)),
        sa.ForeignKeyConstraint(["sku_code"], ["skus.sku_code"]),
        sa.UniqueConstraint("sku_code"),
    )

    op.create_table(
        "policy_snapshots",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("sku_code", sa.String(80)),
        sa.Column("node_code", sa.String(80)),
        sa.Column("computed_at", sa.DateTime()),
        sa.Column("review_period_days", sa.Numeric(6, 2)),
        sa.Column("service_level", sa.Numeric(6, 4)),
        sa.Column("z_score", sa.Numeric(7, 4)),
        sa.Column("add_rolling", sa.Numeric(14, 3)),
        sa.Column("rmse_d", sa.Numeric(14, 3)),
        sa.Column("l_actual", sa.Numeric(6, 2)),
        sa.Column("rmse_lt", sa.Numeric(7, 3)),
        sa.Column("fill_rate", sa.Numeric(6, 4)),
        sa.Column("safety_stock", sa.Numeric(14, 3)),
        sa.Column("base_rop", sa.Numeric(14, 3)),
        sa.Column("total_shelf_life_days", sa.Numeric(7, 2)),
        sa.Column("min_shelf_life_required_days", sa.Numeric(7, 2)),
        sa.Column("max_holdable_stock", sa.Numeric(14, 3)),
        sa.Column("enhanced_rop", sa.Numeric(14, 3)),
        sa.Column("eoq", sa.Numeric(14, 3)),
        sa.Column("raw_max", sa.Numeric(14, 3)),
        sa.Column("warehouse_capacity_qty", sa.Numeric(14, 3)),
        sa.Column("shelf_life_capacity_qty", sa.Numeric(14, 3)),
        sa.Column("final_max", sa.Numeric(14, 3)),
        sa.ForeignKeyConstraint(["sku_code"], ["skus.sku_code"]),
        sa.ForeignKeyConstraint(["node_code"], ["nodes.node_code"]),
    )
    op.create_index("ix_policy_snapshots_sku_node", "policy_snapshots", ["sku_code", "node_code"])


def downgrade():
    op.drop_index("ix_policy_snapshots_sku_node", table_name="policy_snapshots")
    op.drop_table("policy_snapshots")
    op.drop_table("sku_cost_profiles")
    op.drop_table("lead_time_observations")
    op.drop_table("demand_observations")
    op.drop_column("skus", "classification")
