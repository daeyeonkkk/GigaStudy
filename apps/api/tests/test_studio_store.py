from __future__ import annotations

import copy
import json

from gigastudy_api.services.asset_registry import AssetRecord, S3AssetRegistry
from gigastudy_api.services.engine_queue import EngineQueueJob, S3EngineQueueStore
from gigastudy_api.services.studio_store import (
    PostgresStudioStore,
    S3StudioStore,
    _merge_concurrent_studio_payload,
)


class FakeJsonObjectStore:
    label = "s3://gigastudy-test/metadata"

    def __init__(self) -> None:
        self.data = {}

    def read_json(self, relative_path, default):
        return copy.deepcopy(self.data.get(relative_path, default))

    def write_json(self, relative_path, payload) -> None:
        self.data[relative_path] = copy.deepcopy(payload)

    def delete_prefix(self, relative_prefix):
        prefix = relative_prefix.strip().strip("/") + "/"
        keys = [key for key in self.data if key.startswith(prefix)]
        for key in keys:
            self.data.pop(key, None)
        return len(keys), 0

    def estimate_prefix_bytes(self, relative_prefix=""):
        prefix = relative_prefix.strip().strip("/")
        return sum(
            len(json.dumps(value).encode("utf-8"))
            for key, value in self.data.items()
            if not prefix or key.startswith(prefix)
        )


def test_postgres_store_reuses_connection_between_operations(monkeypatch) -> None:
    connections = []

    class FakeConnection:
        closed = False

        def __init__(self) -> None:
            self.commits = 0
            self.rollbacks = 0

        def commit(self) -> None:
            self.commits += 1

        def rollback(self) -> None:
            self.rollbacks += 1

    def fake_connect(*args, **kwargs):
        connection = FakeConnection()
        connections.append(connection)
        return connection

    monkeypatch.setattr("psycopg.connect", fake_connect)
    store = PostgresStudioStore("postgresql://example/studios")

    with store._connect() as first_connection:
        pass
    with store._connect() as second_connection:
        pass

    assert first_connection is second_connection
    assert connections == [first_connection]
    assert first_connection.commits == 2
    assert first_connection.rollbacks == 0


def test_s3_studio_store_roundtrips_base_payload_and_sidecars() -> None:
    objects = FakeJsonObjectStore()
    store = S3StudioStore(objects)
    payload = {
        "studio_id": "studio-1",
        "title": "R2",
        "updated_at": "2026-05-07T00:00:00+00:00",
        "tracks": [],
        "regions": [],
        "jobs": [],
        "reports": [{"report_id": "report-1"}],
        "candidates": [{"candidate_id": "candidate-1", "status": "pending"}],
        "track_material_archives": [{"archive_id": "archive-1"}],
    }

    store.save_one_raw("studio-1", payload)

    index_entry = objects.data["studios/index.json"]["studio-1"]
    assert "regions" not in index_entry
    assert "tracks" not in index_entry
    assert index_entry["registered_track_count"] == 0
    assert index_entry["report_count"] == 1
    assert index_entry["_sidecar_counts"] == {
        "reports": 1,
        "candidates": 1,
        "track_material_archives": 1,
    }
    assert objects.data["studios/studio-1/base.json"]["reports"] == []
    assert objects.data["studios/studio-1/reports.json"] == [{"report_id": "report-1"}]
    summary_rows = store.list_summary_raw(limit=10, offset=0)
    assert summary_rows == [("studio-1", index_entry)]
    loaded = store.load_one_raw("studio-1")
    assert loaded["reports"] == [{"report_id": "report-1"}]
    activity = store.load_activity_raw("studio-1")
    assert activity["_activity_counts"] == {"pending_candidate_count": 1, "report_count": 1}


def test_s3_studio_store_reads_legacy_full_index_payload() -> None:
    objects = FakeJsonObjectStore()
    store = S3StudioStore(objects)
    objects.data["studios/index.json"] = {
        "studio-1": {
            "studio_id": "studio-1",
            "title": "Legacy",
            "updated_at": "2026-05-07T00:00:00+00:00",
            "tracks": [{"slot_id": 1, "status": "registered"}],
            "regions": [{"region_id": "r1"}],
            "jobs": [],
            "reports": [],
            "candidates": [],
            "track_material_archives": [],
            "_sidecar_counts": {"reports": 1, "candidates": 0, "track_material_archives": 0},
        }
    }
    objects.data["studios/studio-1/reports.json"] = [{"report_id": "report-1"}]

    loaded = store.load_one_raw("studio-1")
    assert loaded["regions"] == [{"region_id": "r1"}]
    assert loaded["reports"] == [{"report_id": "report-1"}]

    store.save_one_raw("studio-1", loaded)

    index_entry = objects.data["studios/index.json"]["studio-1"]
    assert "regions" not in index_entry
    assert objects.data["studios/studio-1/base.json"]["regions"] == [{"region_id": "r1"}]


def test_s3_engine_queue_claims_and_completes_jobs() -> None:
    objects = FakeJsonObjectStore()
    store = S3EngineQueueStore(objects)
    job = EngineQueueJob(
        job_id="job-1",
        studio_id="studio-1",
        slot_id=1,
        job_type="voice",
        status="queued",
        payload={"asset_path": "uploads/studio-1/1/take.wav"},
        attempt_count=0,
        max_attempts=3,
        locked_until=None,
        message=None,
        created_at="2026-05-07T00:00:00+00:00",
        updated_at="2026-05-07T00:00:00+00:00",
    )

    store.enqueue(job)
    claimed = store.claim_next(max_active=1, lease_seconds=60)
    assert claimed is not None
    assert claimed.status == "running"
    assert claimed.attempt_count == 1

    store.complete("job-1")

    completed = store.get("job-1")
    assert completed is not None
    assert completed.status == "completed"


def test_s3_asset_registry_persists_asset_summary() -> None:
    objects = FakeJsonObjectStore()
    registry = S3AssetRegistry(objects)
    registry.upsert(
        AssetRecord(
            relative_path="uploads/studio-1/1/take.wav",
            studio_id="studio-1",
            kind="upload",
            filename="take.wav",
            size_bytes=128,
            updated_at="2026-05-07T00:00:00+00:00",
        )
    )

    assert registry.summarize_all() == (1, 128)
    assert registry.summarize_studio("studio-1") == (1, 128)
    assert registry.list_studio_assets("studio-1", limit=10, offset=0)[0].filename == "take.wav"

    registry.mark_prefix_deleted("uploads/studio-1/")

    assert registry.summarize_all() == (0, 0)


def test_postgres_store_skips_unchanged_sidecar_upserts() -> None:
    class FakeConnection:
        def __init__(self) -> None:
            self.calls = []

        def execute(self, query, params=None):
            self.calls.append((str(query), params))

    store = PostgresStudioStore("postgresql://example/studios")
    connection = FakeConnection()
    existing_candidate = {
        "candidate_id": "existing",
        "updated_at": "2026-04-30T12:00:00+00:00",
        "payload": {"events": [1, 2, 3]},
    }
    new_candidate = {
        "candidate_id": "new",
        "updated_at": "2026-04-30T12:01:00+00:00",
        "payload": {"events": [4]},
    }

    store._sync_sidecar_rows(
        connection,
        table_name="studio_candidates",
        id_column="candidate_id",
        id_key="candidate_id",
        studio_id="studio-1",
        items=[existing_candidate, new_candidate],
        existing_items=[dict(existing_candidate)],
    )

    upsert_calls = [call for call in connection.calls if "INSERT INTO studio_candidates" in call[0]]
    assert len(upsert_calls) == 1
    assert upsert_calls[0][1][1] == "new"


def test_merge_concurrent_studio_payload_preserves_newer_jobs_and_tracks() -> None:
    existing = {
        "studio_id": "studio-1",
        "title": "Race",
        "updated_at": "2026-04-30T12:00:37+00:00",
        "tracks": [
            {"slot_id": 3, "status": "extracting", "updated_at": "2026-04-30T11:59:34+00:00"},
            {"slot_id": 5, "status": "extracting", "updated_at": "2026-04-30T12:00:37+00:00"},
        ],
        "jobs": [
            {"job_id": "tenor", "status": "running", "updated_at": "2026-04-30T11:59:40+00:00"},
            {"job_id": "bass", "status": "queued", "updated_at": "2026-04-30T12:00:37+00:00"},
        ],
        "reports": [],
        "candidates": [],
    }
    incoming = {
        "studio_id": "studio-1",
        "title": "Race",
        "updated_at": "2026-04-30T12:00:40+00:00",
        "tracks": [
            {"slot_id": 3, "status": "registered", "updated_at": "2026-04-30T12:00:40+00:00"},
            {"slot_id": 5, "status": "empty", "updated_at": "2026-04-30T11:59:00+00:00"},
        ],
        "jobs": [
            {"job_id": "tenor", "status": "completed", "updated_at": "2026-04-30T12:00:40+00:00"},
        ],
        "reports": [],
        "candidates": [],
    }

    merged = _merge_concurrent_studio_payload(existing, incoming)

    tracks = {track["slot_id"]: track for track in merged["tracks"]}
    jobs = {job["job_id"]: job for job in merged["jobs"]}
    assert tracks[3]["status"] == "registered"
    assert tracks[5]["status"] == "extracting"
    assert jobs["tenor"]["status"] == "completed"
    assert jobs["bass"]["status"] == "queued"


def test_merge_concurrent_studio_payload_preserves_region_list() -> None:
    existing = {
        "updated_at": "2026-04-30T12:00:37+00:00",
        "tracks": [],
        "regions": [
            {"region_id": "track-1-region-1", "track_slot_id": 1, "updated_at": "2026-04-30T12:00:37+00:00"}
        ],
        "jobs": [],
        "reports": [],
        "candidates": [],
    }
    incoming = {
        "updated_at": "2026-04-30T12:00:40+00:00",
        "tracks": [],
        "regions": [
            {"region_id": "track-2-region-1", "track_slot_id": 2, "updated_at": "2026-04-30T12:00:40+00:00"}
        ],
        "jobs": [],
        "reports": [],
        "candidates": [],
    }

    merged = _merge_concurrent_studio_payload(existing, incoming)

    regions = {region["region_id"]: region for region in merged["regions"]}
    assert set(regions) == {"track-1-region-1", "track-2-region-1"}


def test_merge_concurrent_studio_payload_preserves_archives_by_id() -> None:
    existing = {
        "updated_at": "2026-04-30T12:00:37+00:00",
        "tracks": [],
        "regions": [],
        "jobs": [],
        "reports": [],
        "candidates": [],
        "track_material_archives": [
            {"archive_id": "original", "archived_at": "2026-04-30T12:00:37+00:00"}
        ],
    }
    incoming = {
        "updated_at": "2026-04-30T12:00:40+00:00",
        "tracks": [],
        "regions": [],
        "jobs": [],
        "reports": [],
        "candidates": [],
        "track_material_archives": [
            {"archive_id": "before-overwrite", "archived_at": "2026-04-30T12:00:40+00:00"}
        ],
    }

    merged = _merge_concurrent_studio_payload(existing, incoming)

    archives = {archive["archive_id"]: archive for archive in merged["track_material_archives"]}
    assert set(archives) == {"original", "before-overwrite"}


def test_merge_concurrent_studio_payload_keeps_newer_existing_item_update() -> None:
    existing = {
        "updated_at": "2026-04-30T12:00:50+00:00",
        "tracks": [{"slot_id": 1, "status": "registered", "updated_at": "2026-04-30T12:00:50+00:00"}],
        "jobs": [{"job_id": "voice", "status": "completed", "updated_at": "2026-04-30T12:00:50+00:00"}],
        "reports": [],
        "candidates": [],
    }
    incoming = {
        "updated_at": "2026-04-30T12:00:40+00:00",
        "tracks": [{"slot_id": 1, "status": "extracting", "updated_at": "2026-04-30T12:00:40+00:00"}],
        "jobs": [{"job_id": "voice", "status": "running", "updated_at": "2026-04-30T12:00:40+00:00"}],
        "reports": [],
        "candidates": [],
    }

    merged = _merge_concurrent_studio_payload(existing, incoming)

    assert merged["tracks"][0]["status"] == "registered"
    assert merged["jobs"][0]["status"] == "completed"
    assert merged["updated_at"] == existing["updated_at"]
