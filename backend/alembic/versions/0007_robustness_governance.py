"""Phase 6 - Robustness Score + Governance: composite/component score columns
on simulation_results, and an immutable policy_change_audit_log table for
governance-tier auto-apply/human-approval changes."""
from alembic import op
import sqlalchemy as sa

revision = "0007_robustness_governance"
down_revision = "0006_simulation"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("simulation_results", sa.Column("composite_score", sa.Numeric(6, 2), nullable=False, server_default="0"))
    op.add_column("simulation_results", sa.Column("service_stability", sa.Numeric(6, 2), nullable=False, server_default="0"))
    op.add_column("simulation_results", sa.Column("stockout_resilience", sa.Numeric(6, 2), nullable=False, server_default="0"))
    op.add_column("simulation_results", sa.Column("cost_stability", sa.Numeric(6, 2), nullable=False, server_default="0"))
    op.add_column("simulation_results", sa.Column("expiry_robustness", sa.Numeric(6, 2), nullable=False, server_default="0"))
    op.add_column("simulation_results", sa.Column("inventory_stability", sa.Numeric(6, 2), nullable=False, server_default="0"))
    op.add_column("simulation_results", sa.Column("governance_action", sa.String(30), nullable=True))

    op.create_table(
        "policy_change_audit_log",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("sku_code", sa.String(80)),
        sa.Column("node_code", sa.String(80)),
        sa.Column("old_policy_type", sa.String(20)),
        sa.Column("old_params", sa.JSON()),
        sa.Column("new_policy_type", sa.String(20)),
        sa.Column("new_params", sa.JSON()),
        sa.Column("robustness_score_at_change", sa.Numeric(6, 2)),
        sa.Column("changed_at", sa.DateTime()),
        sa.Column("changed_by", sa.String(50)),
        sa.ForeignKeyConstraint(["sku_code"], ["skus.sku_code"]),
        sa.ForeignKeyConstraint(["node_code"], ["nodes.node_code"]),
    )
    op.create_index("ix_policy_change_audit_log_sku_code", "policy_change_audit_log", ["sku_code"])
    op.create_index("ix_policy_change_audit_log_node_code", "policy_change_audit_log", ["node_code"])
    op.create_index("ix_policy_change_audit_log_changed_at", "policy_change_audit_log", ["changed_at"])


def downgrade():
    op.drop_index("ix_policy_change_audit_log_changed_at", table_name="policy_change_audit_log")
    op.drop_index("ix_policy_change_audit_log_node_code", table_name="policy_change_audit_log")
    op.drop_index("ix_policy_change_audit_log_sku_code", table_name="policy_change_audit_log")
    op.drop_table("policy_change_audit_log")

    op.drop_column("simulation_results", "governance_action")
    op.drop_column("simulation_results", "inventory_stability")
    op.drop_column("simulation_results", "expiry_robustness")
    op.drop_column("simulation_results", "cost_stability")
    op.drop_column("simulation_results", "stockout_resilience")
    op.drop_column("simulation_results", "service_stability")
    op.drop_column("simulation_results", "composite_score")
