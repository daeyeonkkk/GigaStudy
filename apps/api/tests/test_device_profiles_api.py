from collections.abc import Iterator
from pathlib import Path

from fastapi.testclient import TestClient
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from gigastudy_api.db.base import Base
from gigastudy_api.db.session import get_db_session
from gigastudy_api.main import app


@pytest.fixture
def client(tmp_path: Path) -> Iterator[TestClient]:
    database_path = tmp_path / "device-profiles.db"
    engine = create_engine(f"sqlite+pysqlite:///{database_path.as_posix()}", future=True)
    SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)
    Base.metadata.create_all(engine)

    def override_session() -> Iterator[Session]:
        session = SessionLocal()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_db_session] = override_session

    with TestClient(app) as test_client:
        yield test_client

    app.dependency_overrides.clear()


def test_device_profile_upsert_reuses_same_record(client: TestClient) -> None:
    payload = {
        "browser": "Chrome",
        "os": "Windows",
        "input_device_hash": "mic-123",
        "output_route": "wired-headphones",
        "requested_constraints": {"channelCount": 1},
        "applied_settings": {"sampleRate": 48000},
        "actual_sample_rate": 48000,
        "channel_count": 1,
    }

    first_response = client.post("/api/device-profiles", json=payload)
    second_response = client.post(
        "/api/device-profiles",
        json={**payload, "base_latency": 0.012, "output_latency": 0.045},
    )

    assert first_response.status_code == 200
    assert second_response.status_code == 200
    assert (
        first_response.json()["device_profile_id"]
        == second_response.json()["device_profile_id"]
    )
    assert second_response.json()["base_latency"] == 0.012


def test_device_profiles_are_listed_latest_first(client: TestClient) -> None:
    client.post(
        "/api/device-profiles",
        json={
            "browser": "Chrome",
            "os": "Windows",
            "input_device_hash": "mic-123",
            "output_route": "speaker",
        },
    )
    client.post(
        "/api/device-profiles",
        json={
            "browser": "Chrome",
            "os": "Windows",
            "input_device_hash": "mic-456",
            "output_route": "bluetooth-headphones",
        },
    )

    response = client.get("/api/device-profiles?limit=1")

    assert response.status_code == 200
    assert len(response.json()["items"]) == 1
    assert response.json()["items"][0]["input_device_hash"] == "mic-456"
