"""L5 Action's audit log - 1 new, purely additive table (no existing table touched):
  fill_rate_action_logs <- one row per applied RCA recommendation

Local to fill_rate_db only, same isolation stance as every other table in this
module.
"""
from alembic import op
import sqlalchemy as sa

revision = "0007_action_log"
down_revision = "0006_l3_driver_screening"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "fill_rate_action_logs",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("sku_code", sa.String(80)),
        sa.Column("primary_cause", sa.String(60)),
        sa.Column("old_baseline", sa.Numeric(18, 6), nullable=True),
        sa.Column("new_baseline", sa.Numeric(18, 6), nullable=True),
        sa.Column("action_taken", sa.String(120)),
        sa.Column("approved_by", sa.String(120)),
        sa.Column("approved_at", sa.DateTime()),
    )
    op.create_index("ix_fill_rate_action_logs_sku_code", "fill_rate_action_logs", ["sku_code"])


def downgrade():
    op.drop_table("fill_rate_action_logs")
