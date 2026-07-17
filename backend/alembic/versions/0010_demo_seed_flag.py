"""Demo/showcase data flag - a DATA-level marker (not just a code comment)
identifying rows written by app/seed/demo_robustness_showcase.py rather than
the real evaluate_sku_node pipeline, so they can be filtered out, audited, or
removed programmatically later, and so the real pipeline can skip over them
on every re-run instead of overwriting/conflicting with a showcase card."""
from alembic import op
import sqlalchemy as sa

revision = "0010_demo_seed_flag"
down_revision = "0009_cost_breakdown"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("policy_recommendations", sa.Column("is_demo_seed", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("policy_change_audit_log", sa.Column("is_demo_seed", sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade():
    op.drop_column("policy_change_audit_log", "is_demo_seed")
    op.drop_column("policy_recommendations", "is_demo_seed")
