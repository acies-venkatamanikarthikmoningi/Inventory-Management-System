"""Phase 6.1 - simulation-backed recommendations: policy_recommendations
gains governance_action + full Robustness Score breakdowns for both current
and suggested policies (suggested_* now nullable - a SKU/node can genuinely
have no suggestion). suggested_policy_type/suggested_params are relaxed to
nullable for the same reason."""
from alembic import op
import sqlalchemy as sa

revision = "0008_recommendation_scoring"
down_revision = "0007_robustness_governance"
branch_labels = None
depends_on = None


def upgrade():
    op.alter_column("policy_recommendations", "suggested_policy_type", existing_type=sa.String(20), nullable=True)
    op.alter_column("policy_recommendations", "suggested_params", existing_type=sa.JSON(), nullable=True)

    op.add_column("policy_recommendations", sa.Column("governance_action", sa.String(30), nullable=False, server_default="no_change_needed"))

    op.add_column("policy_recommendations", sa.Column("current_composite_score", sa.Numeric(6, 2), nullable=False, server_default="0"))
    op.add_column("policy_recommendations", sa.Column("current_service_stability", sa.Numeric(6, 2), nullable=False, server_default="0"))
    op.add_column("policy_recommendations", sa.Column("current_stockout_resilience", sa.Numeric(6, 2), nullable=False, server_default="0"))
    op.add_column("policy_recommendations", sa.Column("current_cost_stability", sa.Numeric(6, 2), nullable=False, server_default="0"))
    op.add_column("policy_recommendations", sa.Column("current_expiry_robustness", sa.Numeric(6, 2), nullable=False, server_default="0"))
    op.add_column("policy_recommendations", sa.Column("current_inventory_stability", sa.Numeric(6, 2), nullable=False, server_default="0"))
    op.add_column("policy_recommendations", sa.Column("current_service_level_achieved", sa.Numeric(6, 4), nullable=False, server_default="0"))
    op.add_column("policy_recommendations", sa.Column("current_total_cost", sa.Numeric(14, 2), nullable=False, server_default="0"))

    op.add_column("policy_recommendations", sa.Column("suggested_composite_score", sa.Numeric(6, 2), nullable=True))
    op.add_column("policy_recommendations", sa.Column("suggested_service_stability", sa.Numeric(6, 2), nullable=True))
    op.add_column("policy_recommendations", sa.Column("suggested_stockout_resilience", sa.Numeric(6, 2), nullable=True))
    op.add_column("policy_recommendations", sa.Column("suggested_cost_stability", sa.Numeric(6, 2), nullable=True))
    op.add_column("policy_recommendations", sa.Column("suggested_expiry_robustness", sa.Numeric(6, 2), nullable=True))
    op.add_column("policy_recommendations", sa.Column("suggested_inventory_stability", sa.Numeric(6, 2), nullable=True))
    op.add_column("policy_recommendations", sa.Column("suggested_service_level_achieved", sa.Numeric(6, 4), nullable=True))
    op.add_column("policy_recommendations", sa.Column("suggested_total_cost", sa.Numeric(14, 2), nullable=True))


def downgrade():
    op.drop_column("policy_recommendations", "suggested_total_cost")
    op.drop_column("policy_recommendations", "suggested_service_level_achieved")
    op.drop_column("policy_recommendations", "suggested_inventory_stability")
    op.drop_column("policy_recommendations", "suggested_expiry_robustness")
    op.drop_column("policy_recommendations", "suggested_cost_stability")
    op.drop_column("policy_recommendations", "suggested_stockout_resilience")
    op.drop_column("policy_recommendations", "suggested_service_stability")
    op.drop_column("policy_recommendations", "suggested_composite_score")

    op.drop_column("policy_recommendations", "current_total_cost")
    op.drop_column("policy_recommendations", "current_service_level_achieved")
    op.drop_column("policy_recommendations", "current_inventory_stability")
    op.drop_column("policy_recommendations", "current_expiry_robustness")
    op.drop_column("policy_recommendations", "current_cost_stability")
    op.drop_column("policy_recommendations", "current_stockout_resilience")
    op.drop_column("policy_recommendations", "current_service_stability")
    op.drop_column("policy_recommendations", "current_composite_score")

    op.drop_column("policy_recommendations", "governance_action")

    op.alter_column("policy_recommendations", "suggested_params", existing_type=sa.JSON(), nullable=False)
    op.alter_column("policy_recommendations", "suggested_policy_type", existing_type=sa.String(20), nullable=False)
