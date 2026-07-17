import pytest
from app.services.statistics import inverse_normal_cdf


@pytest.mark.parametrize("p,expected", [
    (0.90, 1.2816),
    (0.95, 1.6449),
    (0.975, 1.9600),
    (0.99, 2.3263),
])
def test_matches_known_quantiles(p, expected):
    assert inverse_normal_cdf(p) == pytest.approx(expected, abs=1e-3)


def test_median_is_zero():
    assert inverse_normal_cdf(0.5) == pytest.approx(0.0, abs=1e-9)


def test_symmetric_around_median():
    assert inverse_normal_cdf(0.3) == pytest.approx(-inverse_normal_cdf(0.7), abs=1e-9)


def test_monotonic_increasing():
    values = [inverse_normal_cdf(p) for p in [0.1, 0.3, 0.5, 0.7, 0.9, 0.99]]
    assert values == sorted(values)


def test_rejects_out_of_range():
    with pytest.raises(ValueError):
        inverse_normal_cdf(0)
    with pytest.raises(ValueError):
        inverse_normal_cdf(1)
