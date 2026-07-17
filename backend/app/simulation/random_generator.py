"""Seeded random source for Phase 5's Monte Carlo simulation. Every simulated
run is fully reproducible given the same seed - this is non-negotiable per
the task spec: an unreproducible "Monte Carlo" result is not trustworthy and
not debuggable. Uses Python's stdlib `random.Random` (no new dependency;
numpy is only a transitive dependency of Pyomo, not something this repo
declares directly, so we don't lean on it for something stdlib already does).
"""
import random

DEFAULT_SEED = 42  # fixed default so a request without an explicit seed still reproduces


def make_rng(seed: int | None = None) -> random.Random:
    return random.Random(seed if seed is not None else DEFAULT_SEED)


def draw_nonnegative_gaussian(rng: random.Random, mean: float, std: float) -> float:
    """A demand or lead-time draw from a Normal(mean, std), clipped to >= 0
    since neither can be negative. std <= 0 (e.g. RMSE of exactly 0 in a
    unit test) degenerates to the mean with no variance."""
    if mean <= 0:
        return 0.0
    if std <= 0:
        return mean
    return max(rng.gauss(mean, std), 0.0)
