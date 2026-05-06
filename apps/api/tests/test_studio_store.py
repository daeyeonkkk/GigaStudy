from gigastudy_api.services.studio_store import PostgresStudioStore, _merge_concurrent_studio_payload


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
