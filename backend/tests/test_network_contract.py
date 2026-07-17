from app.schemas.network import InventoryPositionResponse


def test_network_state_location_contract_keeps_canonical_hierarchy():
    row = InventoryPositionResponse(
        id="INV001", skuCode="SKU-2001", skuName="SKU", node="Node", batch="B1",
        onHandQty=1, inTransitQty=0, reservedQty=0, availableQty=1, inventoryPositionQty=1,
        status="Healthy", expiry=None, mfgDate=None, shelfLifeMonths=None, areaCode="AREA-FG1", areaDescription="Finished Goods Storage",
        zoneCode="ZONE-FG01", zoneDescription="ZONE-FG01", binCode="FG1-A01", binDescription="FG1-A01 - ZONE-FG01",
    )
    assert row.binCode == "FG1-A01"
    assert row.zoneCode == "ZONE-FG01"
    assert row.areaCode == "AREA-FG1"
