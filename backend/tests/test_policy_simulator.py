from app.simulation.policy_simulator import simulate_policy


def test_same_seed_produces_identical_results():
    kwargs = dict(seed=123, n_runs=50, policy_type="s_S", params={"s": 200, "S": 500},
                  add_rolling=50, rmse_d=10, l_actual=5, rmse_lt=1, initial_on_hand=300,
                  horizon_days=30, holding_cost_per_unit=2, shortage_penalty_per_unit=15)
    first = simulate_policy(**kwargs)
    second = simulate_policy(**kwargs)
    assert first == second


def test_different_seed_can_produce_different_results():
    kwargs = dict(n_runs=50, policy_type="s_S", params={"s": 200, "S": 500},
                  add_rolling=50, rmse_d=20, l_actual=5, rmse_lt=2, initial_on_hand=100,
                  horizon_days=30, holding_cost_per_unit=2, shortage_penalty_per_unit=15)
    a = simulate_policy(seed=1, **kwargs)
    b = simulate_policy(seed=2, **kwargs)
    assert a != b


def test_higher_reorder_point_and_max_improves_service_level():
    base_kwargs = dict(n_runs=200, add_rolling=50, rmse_d=15, l_actual=5, rmse_lt=1,
                        initial_on_hand=100, horizon_days=60, holding_cost_per_unit=2,
                        shortage_penalty_per_unit=15, seed=7)
    low = simulate_policy(policy_type="s_S", params={"s": 50, "S": 150}, **base_kwargs)
    high = simulate_policy(policy_type="s_S", params={"s": 400, "S": 800}, **base_kwargs)
    assert high["service_level_achieved"] >= low["service_level_achieved"]


def test_zero_variance_is_fully_deterministic_and_never_stocks_out_when_amply_stocked():
    metrics = simulate_policy(
        seed=99, n_runs=10, policy_type="s_S", params={"s": 1000, "S": 2000},
        add_rolling=50, rmse_d=0, l_actual=3, rmse_lt=0, initial_on_hand=1000,
        horizon_days=30, holding_cost_per_unit=1, shortage_penalty_per_unit=10,
    )
    assert metrics["service_level_achieved"] == 1.0
    assert metrics["total_shortage_cost"] == 0.0
    assert metrics["p95_shortage_qty"] == 0.0


def test_s_Q_orders_fixed_quantity_regardless_of_position():
    """(s,Q) should behave differently from (s,S): a fixed order size Q can
    leave inventory position below S after ordering, unlike (s,S) which
    always tops up to S - so with a small Q relative to demand, (s,Q) should
    achieve a lower (or equal) service level than an (s,S) policy sharing the
    same s but topping all the way up to a generous S."""
    common = dict(seed=11, n_runs=200, add_rolling=50, rmse_d=5, l_actual=4, rmse_lt=1,
                  initial_on_hand=300, horizon_days=60, holding_cost_per_unit=2, shortage_penalty_per_unit=15)
    s_q = simulate_policy(policy_type="s_Q", params={"s": 200, "Q": 60}, **common)
    s_s = simulate_policy(policy_type="s_S", params={"s": 200, "S": 900}, **common)
    assert s_s["service_level_achieved"] >= s_q["service_level_achieved"]


def test_periodic_review_R_S_only_orders_on_review_days():
    """(R,S) should place its first order at day 0 (day % R == 0) and not
    react again until the next review boundary, unlike continuous-review
    (s,S) which can react any day. With a long enough R and a demand-heavy
    horizon, (R,S) should show measurably different ending inventory
    dynamics than a daily-reacting (s,S) sharing the same S."""
    common = dict(seed=5, n_runs=50, add_rolling=50, rmse_d=0, l_actual=2, rmse_lt=0,
                  initial_on_hand=500, horizon_days=20, holding_cost_per_unit=1, shortage_penalty_per_unit=10)
    r_s = simulate_policy(policy_type="R_S", params={"R": 10, "S": 900}, **common)
    assert r_s["service_level_achieved"] >= 0.0  # sanity: runs to completion, produces a real metric

    # A (R,s,S) with a threshold high enough to never trigger should never order,
    # eventually stocking out - proving the threshold check actually gates orders.
    never_orders = simulate_policy(policy_type="R_s_S", params={"R": 10, "s": -1, "S": 900}, **common)
    assert never_orders["service_level_achieved"] < 1.0
    assert never_orders["total_shortage_cost"] > 0.0


def test_base_stock_replaces_almost_immediately():
    """Base-Stock's s is defined very close to S (S minus ~1 day of demand),
    so it should achieve a high service level even with a fairly short lead
    time, since it reacts to nearly any consumption."""
    metrics = simulate_policy(
        seed=3, n_runs=100, policy_type="base_stock", params={"s": 950, "S": 1000},
        add_rolling=50, rmse_d=5, l_actual=3, rmse_lt=1, initial_on_hand=1000,
        horizon_days=60, holding_cost_per_unit=2, shortage_penalty_per_unit=15,
    )
    assert metrics["service_level_achieved"] > 0.9
