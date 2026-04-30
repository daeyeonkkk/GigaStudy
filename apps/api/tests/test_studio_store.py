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
