"""L3 Driver Screening - 3 new, additive tables (no existing table touched):
  demand_forecasts    <- Demand_Forecast_Data.xlsx (WIDE format, one row per SKU)
  lead_time_baselines <- Driver 4's self-contained drift baseline (one row per SKU)
  demand_baselines    <- Driver 5's self-contained drift baseline (one row per SKU)

Both baseline tables are local to fill_rate_db only, per the module's database-
isolation requirement - see docs/implementation-status.md.
"""
from alembic import op
import sqlalchemy as sa

revision = "0006_l3_driver_screening"
down_revision = "0005_inventory_snapshot_l2"
branch_labels = None
depends_on = None


def keys(*names):
    return [sa.Column("id", sa.Uuid(), primary_key=True), *[sa.Column(name, type_) for name, type_ in names]]


def upgrade():
    op.create_table(
        "demand_forecasts",
        *keys(
            ("sku_code", sa.String(80)), ("sku_name", sa.String(255)), ("node", sa.String(120)),
            ("week1_forecast", sa.Numeric(18, 3)), ("week2_forecast", sa.Numeric(18, 3)),
            ("week3_forecast", sa.Numeric(18, 3)), ("week4_forecast", sa.Numeric(18, 3)),
        ),
        sa.UniqueConstraint("sku_code", name="uq_demand_forecast_sku"),
    )
    op.create_index("ix_demand_forecasts_sku_code", "demand_forecasts", ["sku_code"])

    op.create_table(
        "lead_time_baselines",
        *keys(("sku_code", sa.String(80)), ("baseline_rmse_lt", sa.Numeric(18, 6)), ("computed_at", sa.DateTime())),
        sa.UniqueConstraint("sku_code", name="uq_lead_time_baseline_sku"),
    )
    op.create_index("ix_lead_time_baselines_sku_code", "lead_time_baselines", ["sku_code"])

    op.create_table(
        "demand_baselines",
        *keys(("sku_code", sa.String(80)), ("baseline_rmse_d", sa.Numeric(18, 6)), ("computed_at", sa.DateTime())),
        sa.UniqueConstraint("sku_code", name="uq_demand_baseline_sku"),
    )
    op.create_index("ix_demand_baselines_sku_code", "demand_baselines", ["sku_code"])


def downgrade():
    op.drop_table("demand_baselines")
    op.drop_table("lead_time_baselines")
    op.drop_table("demand_forecasts")
