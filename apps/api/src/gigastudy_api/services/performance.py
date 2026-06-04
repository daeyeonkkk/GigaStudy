from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar, Token
from time import perf_counter
from typing import Iterator

_REQUEST_METRICS: ContextVar[dict[str, float] | None] = ContextVar(
    "gigastudy_request_metrics",
    default=None,
)


def begin_request_metrics() -> Token[dict[str, float] | None]:
    return _REQUEST_METRICS.set({})


def end_request_metrics(token: Token[dict[str, float] | None]) -> dict[str, float]:
    metrics = dict(_REQUEST_METRICS.get() or {})
    _REQUEST_METRICS.reset(token)
    return metrics


def record_metric(name: str, value_ms: float) -> None:
    metrics = _REQUEST_METRICS.get()
    if metrics is None:
        return
    metrics[name] = metrics.get(name, 0.0) + value_ms


@contextmanager
def measure_metric(name: str) -> Iterator[None]:
    started_at = perf_counter()
    try:
        yield
    finally:
        record_metric(name, (perf_counter() - started_at) * 1000)
