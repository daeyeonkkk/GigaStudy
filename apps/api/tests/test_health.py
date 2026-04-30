from fastapi.testclient import TestClient

from gigastudy_api.main import create_app


def test_health_returns_ok() -> None:
    client = TestClient(create_app())

    response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_readiness_returns_non_secret_runtime_contract() -> None:
    client = TestClient(create_app())

    response = client.get("/api/health/ready")

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ready"
    assert payload["service"] == "gigastudy-six-track-api"
    assert payload["storage_backend"] in {"local", "s3"}
    assert isinstance(payload["database_configured"], bool)
    assert isinstance(payload["deepseek_configured"], bool)
    assert "deepseek_api_key" not in payload
    assert "s3_secret_access_key" not in payload
