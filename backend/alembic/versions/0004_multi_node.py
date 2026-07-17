"""Multi-node prerequisite for MEIO: inter-node Lane (transit time/cost) table.
Bangalore/Hyderabad DC data itself is added via app/seed/multi_node.py using the
existing Node/Area/Zone/Bin/InventoryPosition/Batch tables - no schema change
needed for those, they are already node-scoped."""
from alembic import op
import sqlalchemy as sa

revision = "0004_multi_node"
down_revision = "0003_dynamic_policy"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "lanes",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("source_node_code", sa.String(80)),
        sa.Column("dest_node_code", sa.String(80)),
        sa.Column("transit_days", sa.Numeric(5, 2)),
        sa.Column("cost_per_unit", sa.Numeric(10, 4)),
        sa.Column("lane_type", sa.String(20)),
        sa.ForeignKeyConstraint(["source_node_code"], ["nodes.node_code"]),
        sa.ForeignKeyConstraint(["dest_node_code"], ["nodes.node_code"]),
        sa.UniqueConstraint("source_node_code", "dest_node_code", name="uq_lane_source_dest"),
    )
    op.create_index("ix_lanes_source_node_code", "lanes", ["source_node_code"])
    op.create_index("ix_lanes_dest_node_code", "lanes", ["dest_node_code"])


def downgrade():
    op.drop_index("ix_lanes_dest_node_code", table_name="lanes")
    op.drop_index("ix_lanes_source_node_code", table_name="lanes")
    op.drop_table("lanes")
