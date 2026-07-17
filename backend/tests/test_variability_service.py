from datetime import date, timedelta
import pytest
from app.models import DemandObservation, LeadTimeObservation
from app.services.variability_service import demand_variability, lead_time_variability
from tests.conftest import seed_node, seed_sku

AS_OF = date(2026, 6, 1)


async def test_demand_variability_computes_rmse_of_forecast_error(session):
    await seed_sku(session, "SKU-D1")
    await seed_node(session, "NODE-1")
    actuals = [110, 90, 110, 90]
    for i, actual in enumerate(actuals):
        session.add(DemandObservation(
            sku_code="SKU-D1", node_code="NODE-1",
            observed_date=AS_OF - timedelta(days=len(actuals) - i), forecast_qty=100, actual_qty=actual,
        ))
    await session.commit()

    result = await demand_variability(session, "SKU-D1", "NODE-1", as_of=AS_OF)

    assert result["add_rolling"] == 100
    assert result["rmse_d"] == 10  # errors are +-10 for all four days
    assert result["sample_size"] == 4


async def test_demand_variability_excludes_observations_outside_trailing_window(session):
    await seed_sku(session, "SKU-D2")
    await seed_node(session, "NODE-1")
    session.add(DemandObservation(sku_code="SKU-D2", node_code="NODE-1", observed_date=AS_OF - timedelta(days=200), forecast_qty=1, actual_qty=1000))
    session.add(DemandObservation(sku_code="SKU-D2", node_code="NODE-1", observed_date=AS_OF - timedelta(days=1), forecast_qty=50, actual_qty=50))
    await session.commit()

    result = await demand_variability(session, "SKU-D2", "NODE-1", as_of=AS_OF)

    assert result["sample_size"] == 1
    assert result["add_rolling"] == 50


async def test_demand_variability_returns_none_without_data(session):
    await seed_sku(session, "SKU-D3")
    await seed_node(session, "NODE-1")
    await session.commit()

    assert await demand_variability(session, "SKU-D3", "NODE-1", as_of=AS_OF) is None


async def test_lead_time_variability_computes_rmse_and_fill_rate(session):
    await seed_sku(session, "SKU-L1")
    await seed_node(session, "NODE-1")
    deliveries = [(6, 80), (4, 90), (6, 100), (4, 90)]  # (actual_lt, received out of 100 ordered)
    for i, (actual_lt, received) in enumerate(deliveries):
        session.add(LeadTimeObservation(
            sku_code="SKU-L1", node_code="NODE-1", order_date=AS_OF - timedelta(days=(len(deliveries) - i) * 5),
            promised_lead_time_days=5, actual_lead_time_days=actual_lt, ordered_qty=100, received_qty=received,
        ))
    await session.commit()

    result = await lead_time_variability(session, "SKU-L1", "NODE-1", as_of=AS_OF)

    assert result["l_actual"] == 5
    assert result["rmse_lt"] == 1
    assert result["fill_rate"] == pytest.approx(360 / 400)


async def test_lead_time_variability_ignores_deliveries_after_as_of(session):
    await seed_sku(session, "SKU-L2")
    await seed_node(session, "NODE-1")
    session.add(LeadTimeObservation(sku_code="SKU-L2", node_code="NODE-1", order_date=AS_OF + timedelta(days=10),
                                     promised_lead_time_days=5, actual_lead_time_days=50, ordered_qty=1, received_qty=1))
    session.add(LeadTimeObservation(sku_code="SKU-L2", node_code="NODE-1", order_date=AS_OF - timedelta(days=1),
                                     promised_lead_time_days=5, actual_lead_time_days=5, ordered_qty=100, received_qty=100))
    await session.commit()

    result = await lead_time_variability(session, "SKU-L2", "NODE-1", as_of=AS_OF)

    assert result["sample_size"] == 1
    assert result["l_actual"] == 5


async def test_lead_time_variability_limits_to_trailing_count(session):
    await seed_sku(session, "SKU-L3")
    await seed_node(session, "NODE-1")
    for i in range(20):
        session.add(LeadTimeObservation(
            sku_code="SKU-L3", node_code="NODE-1", order_date=AS_OF - timedelta(days=i),
            promised_lead_time_days=5, actual_lead_time_days=5, ordered_qty=10, received_qty=10,
        ))
    await session.commit()

    result = await lead_time_variability(session, "SKU-L3", "NODE-1", as_of=AS_OF, trailing=12)

    assert result["sample_size"] == 12
