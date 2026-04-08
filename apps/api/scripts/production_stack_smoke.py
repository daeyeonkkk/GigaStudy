from __future__ import annotations

from io import BytesIO
import json
import math
import os
from pathlib import Path
import time
import wave

import boto3
from botocore.exceptions import ClientError
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
import psycopg

from gigastudy_api.config import get_settings
from gigastudy_api.main import app


SAMPLE_RATE = 32_000
DURATION_MS = 1_400


def build_test_wav_bytes(frequency_hz: float, amplitude: float = 0.22) -> bytes:
    frame_count = max(1, round(SAMPLE_RATE * (DURATION_MS / 1000)))
    pcm_frames = bytearray()
    for frame_index in range(frame_count):
        sample = math.sin((2 * math.pi * frequency_hz * frame_index) / SAMPLE_RATE)
        pcm_value = int(max(-1.0, min(1.0, sample * amplitude)) * 32767)
        pcm_frames.extend(int(pcm_value).to_bytes(2, byteorder="little", signed=True))

    buffer = BytesIO()
    with wave.open(buffer, "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(SAMPLE_RATE)
        wav_file.writeframes(bytes(pcm_frames))
    return buffer.getvalue()


def wait_for_postgres(database_url: str, timeout_seconds: int = 90) -> None:
    connect_url = database_url.replace("postgresql+psycopg://", "postgresql://", 1)
    deadline = time.time() + timeout_seconds
    last_error: Exception | None = None
    while time.time() < deadline:
        try:
            with psycopg.connect(connect_url) as connection:
                with connection.cursor() as cursor:
                    cursor.execute("select 1")
                    cursor.fetchone()
            return
        except Exception as error:  # pragma: no cover - used in infrastructure smoke only
            last_error = error
            time.sleep(2)

    raise RuntimeError("PostgreSQL did not become ready in time.") from last_error


def ensure_bucket(settings) -> None:
    client = boto3.client(
        "s3",
        endpoint_url=settings.s3_endpoint_url,
        region_name=settings.s3_region,
        aws_access_key_id=settings.s3_access_key_id,
        aws_secret_access_key=settings.s3_secret_access_key,
        aws_session_token=settings.s3_session_token,
    )
    assert settings.s3_bucket is not None

    try:
        client.head_bucket(Bucket=settings.s3_bucket)
        return
    except ClientError:
        pass

    create_kwargs: dict[str, object] = {"Bucket": settings.s3_bucket}
    if settings.s3_region and settings.s3_region != "us-east-1":
        create_kwargs["CreateBucketConfiguration"] = {"LocationConstraint": settings.s3_region}
    client.create_bucket(**create_kwargs)


def run_migrations() -> None:
    alembic_config = Config("alembic.ini")
    command.upgrade(alembic_config, "head")


def upload_guide(client: TestClient, project_id: str, wav_bytes: bytes) -> dict[str, object]:
    init_response = client.post(
        f"/api/projects/{project_id}/guide/upload-url",
        json={"filename": "guide.wav", "content_type": "audio/wav"},
    )
    init_response.raise_for_status()
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
    complete_response.raise_for_status()
    return complete_response.json()


def upload_take(client: TestClient, project_id: str, wav_bytes: bytes) -> dict[str, object]:
    create_response = client.post(
        f"/api/projects/{project_id}/tracks",
        json={"part_type": "LEAD"},
    )
    create_response.raise_for_status()
    track_id = create_response.json()["track_id"]

    init_response = client.post(
        f"/api/tracks/{track_id}/upload-url",
        json={"filename": "take.wav", "content_type": "audio/wav"},
    )
    init_response.raise_for_status()
    init_payload = init_response.json()

    upload_response = client.put(
        init_payload["upload_url"],
        content=wav_bytes,
        headers={"Content-Type": "audio/wav"},
    )
    assert upload_response.status_code == 204

    complete_response = client.post(
        f"/api/tracks/{track_id}/complete",
        json={"source_format": "audio/wav"},
    )
    complete_response.raise_for_status()
    return complete_response.json()


def main() -> None:
    settings = get_settings()
    if not settings.database_url.startswith("postgresql"):
        raise RuntimeError("Production stack smoke requires a PostgreSQL database URL.")
    if settings.storage_backend != "s3":
        raise RuntimeError("Production stack smoke requires GIGASTUDY_API_STORAGE_BACKEND=s3.")

    wait_for_postgres(settings.database_url)
    ensure_bucket(settings)
    run_migrations()

    with TestClient(app) as client:
        project_response = client.post(
            "/api/projects",
            json={"title": "Production stack smoke", "bpm": 92, "base_key": "A"},
        )
        project_response.raise_for_status()
        project_payload = project_response.json()
        project_id = project_payload["project_id"]

        guide_payload = upload_guide(client, project_id, build_test_wav_bytes(440.0))
        take_payload = upload_take(client, project_id, build_test_wav_bytes(440.0))
        track_id = take_payload["track_id"]

        analysis_response = client.post(f"/api/projects/{project_id}/tracks/{track_id}/analysis")
        analysis_response.raise_for_status()
        analysis_payload = analysis_response.json()

        melody_response = client.post(f"/api/projects/{project_id}/tracks/{track_id}/melody")
        melody_response.raise_for_status()
        melody_payload = melody_response.json()

        arrangement_response = client.post(
            f"/api/projects/{project_id}/arrangements/generate",
            json={"melody_draft_id": melody_payload["melody_draft_id"], "candidate_count": 2},
        )
        arrangement_response.raise_for_status()
        arrangement_payload = arrangement_response.json()

        studio_response = client.get(f"/api/projects/{project_id}/studio")
        studio_response.raise_for_status()
        studio_payload = studio_response.json()

        first_candidate = arrangement_payload["items"][0]

        musicxml_response = client.get(first_candidate["musicxml_artifact_url"])
        musicxml_response.raise_for_status()
        midi_response = client.get(first_candidate["midi_artifact_url"])
        midi_response.raise_for_status()
        guide_wav_response = client.get(guide_payload["guide_wav_artifact_url"])
        guide_wav_response.raise_for_status()

        summary = {
            "project_id": project_id,
            "database_url": settings.database_url,
            "storage_backend": settings.storage_backend,
            "guide_track_id": guide_payload["track_id"],
            "take_track_id": track_id,
            "analysis_model_version": analysis_payload["latest_job"]["model_version"],
            "pitch_quality_mode": analysis_payload["latest_score"]["pitch_quality_mode"],
            "melody_model_version": melody_payload["model_version"],
            "arrangement_candidate_count": len(arrangement_payload["items"]),
            "studio_take_count": len(studio_payload["takes"]),
            "guide_wav_bytes": len(guide_wav_response.content),
            "musicxml_bytes": len(musicxml_response.content),
            "midi_bytes": len(midi_response.content),
        }
        print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
