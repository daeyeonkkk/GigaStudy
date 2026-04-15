from collections.abc import Iterator
from pathlib import Path

from fastapi.testclient import TestClient
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from gigastudy_api.config import get_settings
from gigastudy_api.db.base import Base
from gigastudy_api.db.session import get_db_session
from gigastudy_api.main import app


@pytest.fixture
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    database_path = tmp_path / "runtime-events.db"
    storage_root = tmp_path / "storage"
    monkeypatch.setenv("GIGASTUDY_API_STORAGE_ROOT", storage_root.as_posix())
    get_settings.cache_clear()

    engine = create_engine(f"sqlite+pysqlite:///{database_path.as_posix()}", future=True)
    session_local = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)
    Base.metadata.create_all(engine)

    def override_session() -> Iterator[Session]:
        session = session_local()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_db_session] = override_session

    with TestClient(app) as test_client:
        yield test_client

    app.dependency_overrides.clear()
    get_settings.cache_clear()


def test_health_endpoint_sets_request_id_header(client: TestClient) -> None:
    response = client.get("/api/health")

    assert response.status_code == 200
    assert response.headers["x-request-id"]


def test_runtime_events_can_be_created_and_visible_in_ops(client: TestClient) -> None:
    project_id = client.post("/api/projects", json={"title": "Runtime Capture"}).json()["project_id"]

    create_response = client.post(
        "/api/runtime-events",
        json={
            "source": "client",
            "severity": "error",
            "event_type": "fetch_failure",
            "message": "운영 개요를 불러오지 못했습니다.",
            "project_id": project_id,
            "surface": "ops",
            "route_path": "/ops",
            "request_method": "GET",
            "request_path": "/api/admin/ops",
            "status_code": 503,
            "details": {"network": "down"},
        },
        headers={"X-Request-ID": "req-client-001"},
    )

    assert create_response.status_code == 201
    assert create_response.json()["request_id"] == "req-client-001"

    ops_response = client.get("/api/admin/ops")
    assert ops_response.status_code == 200
    payload = ops_response.json()

    assert payload["runtime_log_summary"]["total_event_count"] >= 1
    assert payload["runtime_log_summary"]["client_error_event_count"] >= 1
    assert any(item["event_type"] == "fetch_failure" for item in payload["recent_runtime_events"])
