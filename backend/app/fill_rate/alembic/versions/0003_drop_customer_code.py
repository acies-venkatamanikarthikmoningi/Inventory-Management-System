"""Drop SalesOrder.customer_code - unused in every fill-rate calculation
(order/demand fill rate, DoS) and not present in the real "Fill Rate Log"
source file this module now ingests directly.

NOT SAFELY REVERSIBLE: downgrade() re-adds the column, but the original
per-row customer codes are gone once dropped - there is no way to
reconstruct them. The re-added column is nullable so downgrade() at least
restores the schema shape without inventing fake data.
"""
from alembic import op
import sqlalchemy as sa

revision = "0003_drop_customer_code"
down_revision = "0002_inventory_snapshot"
branch_labels = None
depends_on = None


def upgrade():
    op.drop_column("sales_orders", "customer_code")


def downgrade():
    op.add_column("sales_orders", sa.Column("customer_code", sa.String(80), nullable=True))
