from collections.abc import Iterator
from io import BytesIO
from pathlib import Path

from botocore.exceptions import ClientError
from fastapi.testclient import TestClient
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from audio_fixtures import build_test_wav_bytes
from gigastudy_api.config import get_settings
from gigastudy_api.db.base import Base
from gigastudy_api.db.session import get_db_session
from gigastudy_api.main import app
from gigastudy_api.services import storage as storage_service


class FakeS3Client:
    def __init__(self) -> None:
        self.objects: dict[tuple[str, str], dict[str, object]] = {}

    def put_object(self, Bucket: str, Key: str, Body: bytes, ContentType: str | None = None) -> None:
        self.objects[(Bucket, Key)] = {
            "body": bytes(Body),
            "content_type": ContentType,
        }

    def get_object(self, Bucket: str, Key: str) -> dict[str, object]:
        item = self.objects.get((Bucket, Key))
        if item is None:
            raise ClientError({"Error": {"Code": "NoSuchKey", "Message": "missing"}}, "GetObject")
        return {
            "Body": BytesIO(item["body"]),
            "ContentLength": len(item["body"]),
            "ContentType": item.get("content_type"),
        }

    def head_object(self, Bucket: str, Key: str) -> dict[str, object]:
        item = self.objects.get((Bucket, Key))
        if item is None:
            raise ClientError({"Error": {"Code": "NoSuchKey", "Message": "missing"}}, "HeadObject")
        return {
            "ContentLength": len(item["body"]),
            "ContentType": item.get("content_type"),
        }


@pytest.fixture
def s3_client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[tuple[TestClient, FakeS3Client]]:
    database_path = tmp_path / "s3-guides.db"
    fake_s3 = FakeS3Client()
    monkeypatch.setenv("GIGASTUDY_API_STORAGE_BACKEND", "s3")
    monkeypatch.setenv("GIGASTUDY_API_S3_BUCKET", "gigastudy-test")
    monkeypatch.setenv("GIGASTUDY_API_S3_ENDPOINT_URL", "http://minio.test")
    monkeypatch.setenv("GIGASTUDY_API_S3_REGION", "ap-northeast-2")
    monkeypatch.setattr(storage_service, "_create_s3_client", lambda settings: fake_s3)
    get_settings.cache_clear()

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
        yield test_client, fake_s3

    app.dependency_overrides.clear()
    get_settings.cache_clear()


def test_guide_upload_roundtrip_works_with_s3_storage_backend(
    s3_client: tuple[TestClient, FakeS3Client],
) -> None:
    client, fake_s3 = s3_client
    wav_bytes = build_test_wav_bytes(duration_ms=1100, sample_rate=24000)

    project_response = client.post("/api/projects", json={"title": "S3 Guide Session"})
    project_id = project_response.json()["project_id"]

    init_response = client.post(
        f"/api/projects/{project_id}/guide/upload-url",
        json={"filename": "guide.wav", "content_type": "audio/wav"},
    )
    assert init_response.status_code == 201
    init_payload = init_response.json()

    upload_response = client.put(
        init_payload["upload_url"],
        content=wav_bytes,
        headers={"Content-Type": "audio/wav"},
    )
    assert upload_response.status_code == 204

    complete_response = client.post(
        f"/api/projects/{project_id}/guide/complete",
        json={"track_id": init_payload["track_id"], "source_format": "audio/wav"},
    )
    assert complete_response.status_code == 200

    payload = complete_response.json()
    source_response = client.get(payload["source_artifact_url"])
    canonical_response = client.get(payload["guide_wav_artifact_url"])

    assert source_response.status_code == 200
    assert source_response.content == wav_bytes
    assert canonical_response.status_code == 200
    assert canonical_response.headers["content-type"].startswith("audio/wav")
    assert any(key.endswith("-canonical.wav") for (_, key) in fake_s3.objects.keys())
    assert any(key.endswith("-frame-pitch.json") for (_, key) in fake_s3.objects.keys())
