"""Phase 4 MEIO: shortage/expiry-penalty and MOQ cost inputs, plus
OptimizationRun/OptimizationRecommendation persistence for reproducible solves."""
from alembic import op
import sqlalchemy as sa

revision = "0005_meio_optimization"
down_revision = "0004_multi_node"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("sku_cost_profiles", sa.Column("shortage_penalty_per_unit", sa.Numeric(12, 2), nullable=False, server_default="0"))
    op.add_column("sku_cost_profiles", sa.Column("expiry_penalty_per_unit", sa.Numeric(12, 2), nullable=False, server_default="0"))
    op.add_column("sku_cost_profiles", sa.Column("moq_units", sa.Numeric(12, 2), nullable=False, server_default="0"))

    op.create_table(
        "optimization_runs",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("requested_at", sa.DateTime()),
        sa.Column("node_codes", sa.JSON()),
        sa.Column("sku_codes", sa.JSON()),
        sa.Column("horizon_days", sa.Integer()),
        sa.Column("scenario_set", sa.JSON()),
        sa.Column("solver_status", sa.String(20)),
        sa.Column("objective_value", sa.Numeric(18, 2), nullable=True),
        sa.Column("solve_seconds", sa.Numeric(10, 3)),
        sa.Column("detail", sa.String(255)),
    )
    op.create_index("ix_optimization_runs_requested_at", "optimization_runs", ["requested_at"])

    op.create_table(
        "optimization_recommendations",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("run_id", sa.Uuid()),
        sa.Column("recommendation_type", sa.String(20)),
        sa.Column("sku_code", sa.String(80)),
        sa.Column("node_code", sa.String(80)),
        sa.Column("source_node_code", sa.String(80), nullable=True),
        sa.Column("period_index", sa.Integer()),
        sa.Column("scenario_name", sa.String(30)),
        sa.Column("quantity", sa.Numeric(14, 3)),
        sa.ForeignKeyConstraint(["run_id"], ["optimization_runs.id"]),
        sa.ForeignKeyConstraint(["sku_code"], ["skus.sku_code"]),
        sa.ForeignKeyConstraint(["node_code"], ["nodes.node_code"]),
        sa.ForeignKeyConstraint(["source_node_code"], ["nodes.node_code"]),
    )
    op.create_index("ix_optimization_recommendations_run_id", "optimization_recommendations", ["run_id"])
    op.create_index("ix_optimization_recommendations_sku_code", "optimization_recommendations", ["sku_code"])
    op.create_index("ix_optimization_recommendations_node_code", "optimization_recommendations", ["node_code"])


def downgrade():
    op.drop_index("ix_optimization_recommendations_node_code", table_name="optimization_recommendations")
    op.drop_index("ix_optimization_recommendations_sku_code", table_name="optimization_recommendations")
    op.drop_index("ix_optimization_recommendations_run_id", table_name="optimization_recommendations")
    op.drop_table("optimization_recommendations")
    op.drop_index("ix_optimization_runs_requested_at", table_name="optimization_runs")
    op.drop_table("optimization_runs")
    op.drop_column("sku_cost_profiles", "moq_units")
    op.drop_column("sku_cost_profiles", "expiry_penalty_per_unit")
    op.drop_column("sku_cost_profiles", "shortage_penalty_per_unit")
