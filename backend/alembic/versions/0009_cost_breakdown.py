"""Phase 6.2 - Policy Robustness card cost breakdown: holding + shortage
cost sub-components for both current and suggested policies, so the
collapsible cost detail on the card doesn't need to re-simulate anything."""
from alembic import op
import sqlalchemy as sa

revision = "0009_cost_breakdown"
down_revision = "0008_recommendation_scoring"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("policy_recommendations", sa.Column("current_total_holding_cost", sa.Numeric(14, 2), nullable=False, server_default="0"))
    op.add_column("policy_recommendations", sa.Column("current_total_shortage_cost", sa.Numeric(14, 2), nullable=False, server_default="0"))
    op.add_column("policy_recommendations", sa.Column("suggested_total_holding_cost", sa.Numeric(14, 2), nullable=True))
    op.add_column("policy_recommendations", sa.Column("suggested_total_shortage_cost", sa.Numeric(14, 2), nullable=True))


def downgrade():
    op.drop_column("policy_recommendations", "suggested_total_shortage_cost")
    op.drop_column("policy_recommendations", "suggested_total_holding_cost")
    op.drop_column("policy_recommendations", "current_total_shortage_cost")
    op.drop_column("policy_recommendations", "current_total_holding_cost")
