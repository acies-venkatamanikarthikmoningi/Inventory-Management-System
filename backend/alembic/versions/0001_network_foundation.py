"""Network Intelligence Foundation, including canonical location hierarchy."""
from alembic import op
import sqlalchemy as sa

revision = "0001_network_foundation"
down_revision = None
branch_labels = None
depends_on = None


def keys(table, *names):
    return [sa.Column("id", sa.Uuid(), primary_key=True), *[sa.Column(name, type_) for name, type_ in names]]


def upgrade():
    op.create_table("nodes", *keys("nodes", ("node_code", sa.String(80)), ("description", sa.String(255)), ("active", sa.Boolean())), sa.UniqueConstraint("node_code"))
    op.create_table("skus", *keys("skus", ("sku_code", sa.String(80)), ("description", sa.String(255)), ("active", sa.Boolean())), sa.UniqueConstraint("sku_code"))
    op.create_table("areas", *keys("areas", ("area_code", sa.String(80)), ("description", sa.String(255)), ("type", sa.String(20)), ("active", sa.Boolean())), sa.UniqueConstraint("area_code"))
    op.create_table("zones", *keys("zones", ("zone_code", sa.String(80)), ("description", sa.String(255)), ("face", sa.String(10)), ("area_code", sa.String(80)), ("active", sa.Boolean())), sa.ForeignKeyConstraint(["area_code"], ["areas.area_code"]), sa.UniqueConstraint("zone_code"))
    op.create_table("bin_types", *keys("bin_types", ("type_code", sa.String(80)), ("description", sa.String(255)), ("max_volume_m3", sa.Numeric(12, 3)), ("max_weight_kg", sa.Numeric(12, 3)), ("bin_pallet_capacity", sa.Integer()), ("storage_hu_type", sa.String(10)), ("active", sa.Boolean())), sa.UniqueConstraint("type_code"))
    op.create_table("bins", *keys("bins", ("bin_code", sa.String(100)), ("description", sa.String(255)), ("type_code", sa.String(80)), ("zone_code", sa.String(80)), ("status", sa.String(20))), sa.ForeignKeyConstraint(["type_code"], ["bin_types.type_code"]), sa.ForeignKeyConstraint(["zone_code"], ["zones.zone_code"]), sa.UniqueConstraint("bin_code"))
    op.create_table("inventory_positions", *keys("inventory_positions", ("source_id", sa.String(80)), ("sku_code", sa.String(80)), ("node_code", sa.String(80)), ("bin_code", sa.String(100)), ("batch_code", sa.String(100)), ("on_hand", sa.Numeric(18, 3)), ("on_order", sa.Numeric(18, 3)), ("in_transit", sa.Numeric(18, 3)), ("allocated", sa.Numeric(18, 3)), ("available", sa.Numeric(18, 3)), ("backorder", sa.Numeric(18, 3)), ("inventory_position", sa.Numeric(18, 3)), ("status", sa.String(30)), ("expiry_date", sa.Date())), sa.ForeignKeyConstraint(["sku_code"], ["skus.sku_code"]), sa.ForeignKeyConstraint(["node_code"], ["nodes.node_code"]), sa.ForeignKeyConstraint(["bin_code"], ["bins.bin_code"]), sa.UniqueConstraint("source_id", name="uq_inventory_position_source_id"))


def downgrade():
    op.drop_table("inventory_positions")
    op.drop_table("bins")
    op.drop_table("bin_types")
    op.drop_table("zones")
    op.drop_table("areas")
    op.drop_table("skus")
    op.drop_table("nodes")
