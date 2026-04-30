from __future__ import annotations

import pytest

from gigastudy_api.config import get_settings


@pytest.fixture(autouse=True)
def disable_external_llm_calls(monkeypatch: pytest.MonkeyPatch):
    """Keep API regression tests deterministic even when local .env enables LLMs."""

    monkeypatch.setenv("GIGASTUDY_API_DEEPSEEK_HARMONY_ENABLED", "false")
    monkeypatch.setenv("GIGASTUDY_API_DEEPSEEK_EXTRACTION_PLAN_ENABLED", "false")
    monkeypatch.setenv("GIGASTUDY_API_DEEPSEEK_NOTATION_REVIEW_ENABLED", "false")
    monkeypatch.setenv("GIGASTUDY_API_DEEPSEEK_ENSEMBLE_REVIEW_ENABLED", "false")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()
