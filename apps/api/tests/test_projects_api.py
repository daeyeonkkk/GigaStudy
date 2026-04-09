from collections.abc import Iterator
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient
import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker

from gigastudy_api.db.base import Base
from gigastudy_api.db.models import Project, User
from gigastudy_api.db.session import get_db_session
from gigastudy_api.config import get_settings
from gigastudy_api.main import app
from gigastudy_api.services.projects import get_or_create_default_user


@pytest.fixture
def client(tmp_path: Path) -> Iterator[TestClient]:
    database_path = tmp_path / "projects-api.db"
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


def test_create_and_get_project(client: TestClient) -> None:
    create_response = client.post(
        "/api/projects",
        json={
            "title": "Morning Warmup",
            "bpm": 104,
            "base_key": "G",
            "time_signature": "4/4",
            "mode": "practice",
            "chord_timeline_json": [
                {
                    "start_ms": 0,
                    "end_ms": 2000,
                    "label": "Gmaj7",
                    "root": "G",
                    "quality": "maj7",
                }
            ],
        },
    )

    assert create_response.status_code == 201
    created_project = create_response.json()
    assert created_project["title"] == "Morning Warmup"
    assert created_project["bpm"] == 104
    assert created_project["chord_timeline_json"][0]["label"] == "Gmaj7"

    get_response = client.get(f"/api/projects/{created_project['project_id']}")

    assert get_response.status_code == 200
    assert get_response.json()["project_id"] == created_project["project_id"]
    assert get_response.json()["chord_timeline_json"][0]["root"] == "G"


def test_project_creation_reuses_default_user(client: TestClient, tmp_path: Path) -> None:
    client.post("/api/projects", json={"title": "Session A"})
    client.post("/api/projects", json={"title": "Session B"})

    database_path = tmp_path / "projects-api.db"
    engine = create_engine(f"sqlite+pysqlite:///{database_path.as_posix()}", future=True)

    with Session(engine) as session:
        users = session.scalars(select(User)).all()
        projects = session.scalars(select(Project)).all()

    assert len(users) == 1
    assert len(projects) == 2


def test_get_or_create_default_user_recovers_from_insert_race(tmp_path: Path) -> None:
    database_path = tmp_path / "projects-race.db"
    engine = create_engine(f"sqlite+pysqlite:///{database_path.as_posix()}", future=True)
    SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)
    Base.metadata.create_all(engine)
    settings = get_settings()

    with SessionLocal() as session:
        original_flush = session.flush

        def racing_flush(*args: object, **kwargs: object) -> None:
            with SessionLocal() as competing_session:
                competing_session.add(User(nickname=settings.default_user_nickname))
                competing_session.commit()

            original_flush(*args, **kwargs)

        with patch.object(session, "flush", side_effect=racing_flush):
            user = get_or_create_default_user(session)

        assert user.nickname == settings.default_user_nickname

    with SessionLocal() as verification_session:
        users = verification_session.scalars(select(User)).all()

    assert len(users) == 1


def test_get_project_returns_404_for_unknown_id(client: TestClient) -> None:
    response = client.get("/api/projects/2afef2ab-15ef-4584-a951-7b22fd0dc2e6")

    assert response.status_code == 404


def test_create_project_rejects_blank_title(client: TestClient) -> None:
    response = client.post("/api/projects", json={"title": "   "})

    assert response.status_code == 422


def test_patch_project_updates_chord_timeline(client: TestClient) -> None:
    project_id = client.post("/api/projects", json={"title": "Chord Draft"}).json()["project_id"]

    patch_response = client.patch(
        f"/api/projects/{project_id}",
        json={
            "base_key": "A",
            "chord_timeline_json": [
                {
                    "start_ms": 0,
                    "end_ms": 1500,
                    "label": "A",
                    "root": "A",
                    "quality": "major",
                },
                {
                    "start_ms": 1500,
                    "end_ms": 3000,
                    "label": "D",
                    "root": "D",
                    "quality": "major",
                },
            ],
        },
    )

    assert patch_response.status_code == 200
    payload = patch_response.json()
    assert payload["base_key"] == "A"
    assert len(payload["chord_timeline_json"]) == 2
    assert payload["chord_timeline_json"][1]["label"] == "D"
