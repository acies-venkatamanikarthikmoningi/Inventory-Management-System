"""Exceptions and Expiry: batch master data for FEFO, shelf-life feasibility, and exception detection."""
from alembic import op
import sqlalchemy as sa

revision = "0002_exceptions_and_expiry"
down_revision = "0001_network_foundation"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "batches",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("batch_number", sa.String(100)),
        sa.Column("sku_code", sa.String(80)),
        sa.Column("node_code", sa.String(80)),
        sa.Column("mfg_date", sa.Date()),
        sa.Column("expiry_date", sa.Date()),
        sa.Column("shelf_life_months", sa.Integer()),
        sa.Column("total_qty", sa.Numeric(18, 3)),
        sa.ForeignKeyConstraint(["sku_code"], ["skus.sku_code"]),
        sa.ForeignKeyConstraint(["node_code"], ["nodes.node_code"]),
        sa.UniqueConstraint("batch_number"),
    )


def downgrade():
    op.drop_table("batches")
