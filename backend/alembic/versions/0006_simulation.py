"""Phase 5 - Policy Robustness: multiple named policy types (policy_type on
policy_snapshots), a policy-type recommendation engine (policy_recommendations),
and Monte Carlo simulation persistence (simulation_runs/simulation_results)."""
from alembic import op
import sqlalchemy as sa

revision = "0006_simulation"
down_revision = "0005_meio_optimization"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("policy_snapshots", sa.Column("policy_type", sa.String(20), nullable=False, server_default="s_S"))

    op.create_table(
        "policy_recommendations",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("sku_code", sa.String(80)),
        sa.Column("node_code", sa.String(80)),
        sa.Column("computed_at", sa.DateTime()),
        sa.Column("current_policy_type", sa.String(20)),
        sa.Column("suggested_policy_type", sa.String(20)),
        sa.Column("current_params", sa.JSON()),
        sa.Column("suggested_params", sa.JSON()),
        sa.Column("reasoning", sa.Text()),
        sa.ForeignKeyConstraint(["sku_code"], ["skus.sku_code"]),
        sa.ForeignKeyConstraint(["node_code"], ["nodes.node_code"]),
    )
    op.create_index("ix_policy_recommendations_sku_code", "policy_recommendations", ["sku_code"])
    op.create_index("ix_policy_recommendations_node_code", "policy_recommendations", ["node_code"])
    op.create_index("ix_policy_recommendations_computed_at", "policy_recommendations", ["computed_at"])

    op.create_table(
        "simulation_runs",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("requested_at", sa.DateTime()),
        sa.Column("seed", sa.Integer()),
        sa.Column("n_runs", sa.Integer()),
        sa.Column("horizon_days", sa.Integer()),
        sa.Column("sku_codes", sa.JSON()),
        sa.Column("node_codes", sa.JSON()),
        sa.Column("status", sa.String(20)),
        sa.Column("duration_seconds", sa.Numeric(10, 3)),
        sa.Column("detail", sa.String(255)),
    )
    op.create_index("ix_simulation_runs_requested_at", "simulation_runs", ["requested_at"])

    op.create_table(
        "simulation_results",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("run_id", sa.Uuid()),
        sa.Column("sku_code", sa.String(80)),
        sa.Column("node_code", sa.String(80)),
        sa.Column("policy_role", sa.String(20)),
        sa.Column("policy_type", sa.String(20)),
        sa.Column("policy_params", sa.JSON()),
        sa.Column("service_level_achieved", sa.Numeric(6, 4)),
        sa.Column("avg_ending_inventory", sa.Numeric(14, 3)),
        sa.Column("total_holding_cost", sa.Numeric(14, 2)),
        sa.Column("total_shortage_cost", sa.Numeric(14, 2)),
        sa.Column("p95_shortage_qty", sa.Numeric(14, 3)),
        sa.ForeignKeyConstraint(["run_id"], ["simulation_runs.id"]),
        sa.ForeignKeyConstraint(["sku_code"], ["skus.sku_code"]),
        sa.ForeignKeyConstraint(["node_code"], ["nodes.node_code"]),
    )
    op.create_index("ix_simulation_results_run_id", "simulation_results", ["run_id"])
    op.create_index("ix_simulation_results_sku_code", "simulation_results", ["sku_code"])
    op.create_index("ix_simulation_results_node_code", "simulation_results", ["node_code"])


def downgrade():
    op.drop_index("ix_simulation_results_node_code", table_name="simulation_results")
    op.drop_index("ix_simulation_results_sku_code", table_name="simulation_results")
    op.drop_index("ix_simulation_results_run_id", table_name="simulation_results")
    op.drop_table("simulation_results")
    op.drop_index("ix_simulation_runs_requested_at", table_name="simulation_runs")
    op.drop_table("simulation_runs")
    op.drop_index("ix_policy_recommendations_computed_at", table_name="policy_recommendations")
    op.drop_index("ix_policy_recommendations_node_code", table_name="policy_recommendations")
    op.drop_index("ix_policy_recommendations_sku_code", table_name="policy_recommendations")
    op.drop_table("policy_recommendations")
    op.drop_column("policy_snapshots", "policy_type")
