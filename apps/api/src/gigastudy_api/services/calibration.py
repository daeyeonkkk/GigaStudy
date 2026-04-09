from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from datetime import datetime, timezone
import os
from pathlib import Path
from tempfile import TemporaryDirectory

from fastapi.testclient import TestClient
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from gigastudy_api.config import get_settings
from gigastudy_api.db.base import Base
from gigastudy_api.db.session import get_db_session, get_engine, get_session_factory
from gigastudy_api.main import app
from gigastudy_api.services.audio_fixture_library import build_named_audio_fixture


DEFAULT_CENTERED_CENTS = 8.0


class AudioSourceSpec(BaseModel):
    source_kind: str = "named_fixture"
    fixture_name: str | None = None
    wav_path: str | None = None
    filename: str = "sample.wav"
    content_type: str = "audio/wav"

    @model_validator(mode="after")
    def validate_source(self) -> "AudioSourceSpec":
        if self.source_kind == "named_fixture" and not self.fixture_name:
            raise ValueError("fixture_name is required when source_kind is 'named_fixture'.")
        if self.source_kind == "wav_path" and not self.wav_path:
            raise ValueError("wav_path is required when source_kind is 'wav_path'.")
        if self.source_kind not in {"named_fixture", "wav_path"}:
            raise ValueError("source_kind must be either 'named_fixture' or 'wav_path'.")
        return self


class CalibrationExpectation(BaseModel):
    note_index: int = 0
    attack_direction: str = "any"
    sustain_direction: str = "any"
    min_confidence: float | None = None
    min_abs_attack_cents: float | None = None
    max_abs_sustain_cents: float | None = None
    min_note_score: float | None = None
    message_contains: str | None = None
    expected_pitch_quality_mode: str | None = None
    expected_harmony_reference_mode: str | None = None


class HumanRatingNote(BaseModel):
    note_index: int = 0
    attack_direction: str | None = None
    sustain_direction: str | None = None
    acceptability_label: str | None = None
    notes: str | None = None
    rater_count: int | None = None

    @model_validator(mode="after")
    def validate_labels(self) -> "HumanRatingNote":
        directional_values = {"sharp", "centered", "flat", "unclear"}
        acceptability_values = {"in_tune", "review", "corrective", "unclear"}

        if self.attack_direction is not None and self.attack_direction not in directional_values:
            raise ValueError("attack_direction must be one of sharp, centered, flat, unclear.")
        if self.sustain_direction is not None and self.sustain_direction not in directional_values:
            raise ValueError("sustain_direction must be one of sharp, centered, flat, unclear.")
        if self.acceptability_label is not None and self.acceptability_label not in acceptability_values:
            raise ValueError("acceptability_label must be one of in_tune, review, corrective, unclear.")
        return self


class CalibrationCase(BaseModel):
    case_id: str
    description: str
    project_title: str
    base_key: str = "C"
    bpm: int = 90
    chord_timeline_json: list[dict[str, object]] | None = None
    guide_source: AudioSourceSpec
    take_source: AudioSourceSpec
    expectation: CalibrationExpectation | None = None
    human_ratings: list[HumanRatingNote] = Field(default_factory=list)
    minimum_human_agreement_ratio: float | None = None

    @model_validator(mode="after")
    def validate_human_rating_controls(self) -> "CalibrationCase":
        if self.minimum_human_agreement_ratio is None:
            return self

        if not 0.0 <= self.minimum_human_agreement_ratio <= 1.0:
            raise ValueError("minimum_human_agreement_ratio must be between 0.0 and 1.0.")
        if not self.human_ratings:
            raise ValueError("human_ratings are required when minimum_human_agreement_ratio is set.")
        return self


class CalibrationCorpus(BaseModel):
    corpus_id: str
    description: str
    evidence_kind: str = "synthetic_vocal_baseline"
    cases: list[CalibrationCase]


class CalibrationCaseResult(BaseModel):
    case_id: str
    description: str
    passed: bool
    failures: list[str]
    pitch_quality_mode: str | None = None
    harmony_reference_mode: str | None = None
    note_feedback: dict[str, object] | None = None
    analysis_model_version: str | None = None
    human_rating_summary: dict[str, object] | None = None


class CalibrationRunSummary(BaseModel):
    corpus_id: str
    description: str
    evidence_kind: str
    manifest_path: str | None = None
    run_at: datetime
    total_cases: int
    passed_cases: int
    failed_cases: int
    all_passed: bool
    cases: list[CalibrationCaseResult]
    rated_case_count: int = 0
    rated_note_count: int = 0
    human_rating_agreement_ratio: float | None = None


def load_calibration_corpus(manifest_path: Path) -> CalibrationCorpus:
    return CalibrationCorpus.model_validate_json(manifest_path.read_text(encoding="utf-8"))


def _resolve_audio_source_bytes(source: AudioSourceSpec, base_dir: Path | None = None) -> bytes:
    if source.source_kind == "named_fixture":
        assert source.fixture_name is not None
        return build_named_audio_fixture(source.fixture_name)

    assert source.wav_path is not None
    wav_path = Path(source.wav_path)
    if not wav_path.is_absolute():
        if base_dir is None:
            wav_path = Path.cwd() / wav_path
        else:
            wav_path = base_dir / wav_path
    return wav_path.read_bytes()


def _restore_env(previous_values: dict[str, str | None]) -> None:
    for key, previous_value in previous_values.items():
        if previous_value is None:
            os.environ.pop(key, None)
        else:
            os.environ[key] = previous_value


@contextmanager
def isolated_calibration_client() -> Iterator[TestClient]:
    with TemporaryDirectory(prefix="gigastudy-calibration-") as temp_dir:
        temp_root = Path(temp_dir)
        database_path = temp_root / "calibration.db"
        storage_root = temp_root / "storage"
        storage_root.mkdir(parents=True, exist_ok=True)

        env_overrides = {
            "GIGASTUDY_API_DATABASE_URL": f"sqlite+pysqlite:///{database_path.as_posix()}",
            "GIGASTUDY_API_STORAGE_BACKEND": "local",
            "GIGASTUDY_API_STORAGE_ROOT": storage_root.as_posix(),
        }
        previous_values = {key: os.environ.get(key) for key in env_overrides}
        engine = None
        session_local = None

        try:
            for key, value in env_overrides.items():
                os.environ[key] = value

            get_settings.cache_clear()
            get_engine.cache_clear()
            get_session_factory.cache_clear()

            engine = create_engine(env_overrides["GIGASTUDY_API_DATABASE_URL"], future=True)
            session_local = sessionmaker(
                bind=engine,
                autoflush=False,
                autocommit=False,
                expire_on_commit=False,
            )
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
        finally:
            app.dependency_overrides.clear()
            if engine is not None:
                engine.dispose()
            _restore_env(previous_values)
            get_settings.cache_clear()
            get_engine.cache_clear()
            get_session_factory.cache_clear()


def _upload_guide(client: TestClient, project_id: str, source: AudioSourceSpec, base_dir: Path | None) -> dict[str, object]:
    wav_bytes = _resolve_audio_source_bytes(source, base_dir)
    init_response = client.post(
        f"/api/projects/{project_id}/guide/upload-url",
        json={"filename": source.filename, "content_type": source.content_type},
    )
    init_response.raise_for_status()
    init_payload = init_response.json()

    upload_response = client.put(
        init_payload["upload_url"],
        content=wav_bytes,
        headers={"Content-Type": source.content_type},
    )
    if upload_response.status_code != 204:
        raise RuntimeError(f"Guide upload failed with status {upload_response.status_code}.")

    complete_response = client.post(
        f"/api/projects/{project_id}/guide/complete",
        json={"track_id": init_payload["track_id"], "source_format": source.content_type},
    )
    complete_response.raise_for_status()
    return complete_response.json()


def _upload_take(
    client: TestClient,
    project_id: str,
    source: AudioSourceSpec,
    base_dir: Path | None,
) -> str:
    wav_bytes = _resolve_audio_source_bytes(source, base_dir)
    create_response = client.post(
        f"/api/projects/{project_id}/tracks",
        json={"part_type": "LEAD"},
    )
    create_response.raise_for_status()
    track_id = create_response.json()["track_id"]

    init_response = client.post(
        f"/api/tracks/{track_id}/upload-url",
        json={"filename": source.filename, "content_type": source.content_type},
    )
    init_response.raise_for_status()
    init_payload = init_response.json()

    upload_response = client.put(
        init_payload["upload_url"],
        content=wav_bytes,
        headers={"Content-Type": source.content_type},
    )
    if upload_response.status_code != 204:
        raise RuntimeError(f"Take upload failed with status {upload_response.status_code}.")

    complete_response = client.post(
        f"/api/tracks/{track_id}/complete",
        json={"source_format": source.content_type},
    )
    complete_response.raise_for_status()
    return track_id


def _classify_direction(value: float | int | None, centered_cents: float = DEFAULT_CENTERED_CENTS) -> str:
    if value is None:
        return "missing"
    numeric_value = float(value)
    if abs(numeric_value) <= centered_cents:
        return "centered"
    return "sharp" if numeric_value > 0 else "flat"


def _classify_acceptability_label(value: float | int | None) -> str:
    if value is None:
        return "missing"

    numeric_value = abs(float(value))
    if numeric_value <= 8.0:
        return "in_tune"
    if numeric_value <= 20.0:
        return "review"
    return "corrective"


def _evaluate_expectation(
    expectation: CalibrationExpectation,
    latest_score: dict[str, object],
) -> tuple[dict[str, object], list[str]]:
    note_feedback_items = latest_score.get("note_feedback_json")
    if not isinstance(note_feedback_items, list) or len(note_feedback_items) <= expectation.note_index:
        return {}, [f"Missing note feedback for note index {expectation.note_index}."]

    note_feedback = note_feedback_items[expectation.note_index]
    if not isinstance(note_feedback, dict):
        return {}, [f"Unexpected note feedback payload at index {expectation.note_index}."]

    failures: list[str] = []
    attack_direction = _classify_direction(note_feedback.get("attack_signed_cents"))
    sustain_direction = _classify_direction(note_feedback.get("sustain_median_cents"))

    if expectation.attack_direction != "any" and attack_direction != expectation.attack_direction:
        failures.append(
            f"Expected attack_direction={expectation.attack_direction}, got {attack_direction}."
        )
    if expectation.sustain_direction != "any" and sustain_direction != expectation.sustain_direction:
        failures.append(
            f"Expected sustain_direction={expectation.sustain_direction}, got {sustain_direction}."
        )

    if expectation.min_confidence is not None:
        confidence = float(note_feedback.get("confidence") or 0.0)
        if confidence < expectation.min_confidence:
            failures.append(
                f"Expected confidence >= {expectation.min_confidence}, got {round(confidence, 3)}."
            )

    if expectation.min_abs_attack_cents is not None:
        attack_cents = abs(float(note_feedback.get("attack_signed_cents") or 0.0))
        if attack_cents < expectation.min_abs_attack_cents:
            failures.append(
                f"Expected abs(attack_signed_cents) >= {expectation.min_abs_attack_cents}, got {round(attack_cents, 2)}."
            )

    if expectation.max_abs_sustain_cents is not None:
        sustain_cents = abs(float(note_feedback.get("sustain_median_cents") or 0.0))
        if sustain_cents > expectation.max_abs_sustain_cents:
            failures.append(
                f"Expected abs(sustain_median_cents) <= {expectation.max_abs_sustain_cents}, got {round(sustain_cents, 2)}."
            )

    if expectation.min_note_score is not None:
        note_score = float(note_feedback.get("note_score") or 0.0)
        if note_score < expectation.min_note_score:
            failures.append(
                f"Expected note_score >= {expectation.min_note_score}, got {round(note_score, 2)}."
            )

    if expectation.message_contains:
        message = str(note_feedback.get("message") or "").lower()
        if expectation.message_contains.lower() not in message:
            failures.append(
                f"Expected message to include '{expectation.message_contains}', got '{note_feedback.get('message')}'."
            )

    if expectation.expected_pitch_quality_mode:
        actual_mode = latest_score.get("pitch_quality_mode")
        if actual_mode != expectation.expected_pitch_quality_mode:
            failures.append(
                f"Expected pitch_quality_mode={expectation.expected_pitch_quality_mode}, got {actual_mode}."
            )

    if expectation.expected_harmony_reference_mode:
        actual_mode = latest_score.get("harmony_reference_mode")
        if actual_mode != expectation.expected_harmony_reference_mode:
            failures.append(
                f"Expected harmony_reference_mode={expectation.expected_harmony_reference_mode}, got {actual_mode}."
            )

    return note_feedback, failures


def _evaluate_human_ratings(
    human_ratings: list[HumanRatingNote],
    latest_score: dict[str, object],
) -> tuple[dict[str, object] | None, list[str]]:
    if not human_ratings:
        return None, []

    note_feedback_items = latest_score.get("note_feedback_json")
    if not isinstance(note_feedback_items, list):
        return {
            "rated_note_count": len(human_ratings),
            "matched_axes": 0,
            "total_axes": 0,
            "agreement_ratio": None,
            "note_results": [],
        }, ["Missing note_feedback_json for human rating comparison."]

    total_axes = 0
    matched_axes = 0
    note_results: list[dict[str, object]] = []
    failures: list[str] = []

    for rating in human_ratings:
        actual_note = note_feedback_items[rating.note_index] if len(note_feedback_items) > rating.note_index else None
        actual_attack_direction = None
        actual_sustain_direction = None
        actual_acceptability_label = None
        note_total_axes = 0
        note_matched_axes = 0

        if isinstance(actual_note, dict):
            actual_attack_direction = _classify_direction(actual_note.get("attack_signed_cents"))
            actual_sustain_direction = _classify_direction(actual_note.get("sustain_median_cents"))
            actual_acceptability_label = _classify_acceptability_label(actual_note.get("sustain_median_cents"))
        else:
            failures.append(f"Missing note feedback for human-rated note index {rating.note_index}.")

        comparison_result: dict[str, object] = {
            "note_index": rating.note_index,
            "human_attack_direction": rating.attack_direction,
            "actual_attack_direction": actual_attack_direction,
            "actual_attack_signed_cents": (
                actual_note.get("attack_signed_cents") if isinstance(actual_note, dict) else None
            ),
            "attack_matches": None,
            "human_sustain_direction": rating.sustain_direction,
            "actual_sustain_direction": actual_sustain_direction,
            "actual_sustain_median_cents": (
                actual_note.get("sustain_median_cents") if isinstance(actual_note, dict) else None
            ),
            "sustain_matches": None,
            "human_acceptability_label": rating.acceptability_label,
            "actual_acceptability_label": actual_acceptability_label,
            "actual_confidence": actual_note.get("confidence") if isinstance(actual_note, dict) else None,
            "actual_note_score": actual_note.get("note_score") if isinstance(actual_note, dict) else None,
            "acceptability_matches": None,
            "rater_count": rating.rater_count,
            "notes": rating.notes,
        }

        if rating.attack_direction is not None and rating.attack_direction != "unclear":
            note_total_axes += 1
            attack_matches = actual_attack_direction == rating.attack_direction
            comparison_result["attack_matches"] = attack_matches
            if attack_matches:
                note_matched_axes += 1

        if rating.sustain_direction is not None and rating.sustain_direction != "unclear":
            note_total_axes += 1
            sustain_matches = actual_sustain_direction == rating.sustain_direction
            comparison_result["sustain_matches"] = sustain_matches
            if sustain_matches:
                note_matched_axes += 1

        if rating.acceptability_label is not None and rating.acceptability_label != "unclear":
            note_total_axes += 1
            acceptability_matches = actual_acceptability_label == rating.acceptability_label
            comparison_result["acceptability_matches"] = acceptability_matches
            if acceptability_matches:
                note_matched_axes += 1

        total_axes += note_total_axes
        matched_axes += note_matched_axes
        comparison_result["matched_axes"] = note_matched_axes
        comparison_result["total_axes"] = note_total_axes
        comparison_result["agreement_ratio"] = (
            round(note_matched_axes / note_total_axes, 4) if note_total_axes else None
        )
        note_results.append(comparison_result)

    agreement_ratio = round(matched_axes / total_axes, 4) if total_axes else None
    return {
        "rated_note_count": len(human_ratings),
        "matched_axes": matched_axes,
        "total_axes": total_axes,
        "agreement_ratio": agreement_ratio,
        "note_results": note_results,
    }, failures


def run_calibration_corpus(
    corpus: CalibrationCorpus,
    *,
    manifest_path: Path | None = None,
) -> CalibrationRunSummary:
    case_results: list[CalibrationCaseResult] = []
    manifest_dir = manifest_path.parent if manifest_path is not None else None

    with isolated_calibration_client() as client:
        for case in corpus.cases:
            project_response = client.post(
                "/api/projects",
                json={
                    "title": case.project_title,
                    "base_key": case.base_key,
                    "bpm": case.bpm,
                    "chord_timeline_json": case.chord_timeline_json,
                },
            )
            project_response.raise_for_status()
            project_id = project_response.json()["project_id"]

            _upload_guide(client, project_id, case.guide_source, manifest_dir)
            take_id = _upload_take(client, project_id, case.take_source, manifest_dir)

            analysis_response = client.post(f"/api/projects/{project_id}/tracks/{take_id}/analysis")
            analysis_response.raise_for_status()
            analysis_payload = analysis_response.json()
            latest_score = analysis_payload["latest_score"]
            failures: list[str] = []
            note_feedback: dict[str, object] | None = None
            if case.expectation is not None:
                note_feedback, expectation_failures = _evaluate_expectation(case.expectation, latest_score)
                failures.extend(expectation_failures)

            human_rating_summary, human_rating_failures = _evaluate_human_ratings(case.human_ratings, latest_score)
            failures.extend(human_rating_failures)
            if (
                case.minimum_human_agreement_ratio is not None
                and human_rating_summary is not None
                and human_rating_summary.get("agreement_ratio") is not None
                and float(human_rating_summary["agreement_ratio"]) < case.minimum_human_agreement_ratio
            ):
                failures.append(
                    "Expected human_rating_agreement_ratio >= "
                    f"{case.minimum_human_agreement_ratio}, got {human_rating_summary['agreement_ratio']}."
                )

            case_results.append(
                CalibrationCaseResult(
                    case_id=case.case_id,
                    description=case.description,
                    passed=not failures,
                    failures=failures,
                    pitch_quality_mode=latest_score.get("pitch_quality_mode"),
                    harmony_reference_mode=latest_score.get("harmony_reference_mode"),
                    note_feedback=note_feedback,
                    analysis_model_version=analysis_payload["latest_job"].get("model_version"),
                    human_rating_summary=human_rating_summary,
                )
            )

    passed_cases = sum(1 for case_result in case_results if case_result.passed)
    failed_cases = len(case_results) - passed_cases
    rated_case_count = sum(1 for case_result in case_results if case_result.human_rating_summary is not None)
    rated_note_count = sum(
        int(case_result.human_rating_summary.get("rated_note_count", 0))
        for case_result in case_results
        if case_result.human_rating_summary is not None
    )
    matched_axes = sum(
        int(case_result.human_rating_summary.get("matched_axes", 0))
        for case_result in case_results
        if case_result.human_rating_summary is not None
    )
    total_axes = sum(
        int(case_result.human_rating_summary.get("total_axes", 0))
        for case_result in case_results
        if case_result.human_rating_summary is not None
    )
    return CalibrationRunSummary(
        corpus_id=corpus.corpus_id,
        description=corpus.description,
        evidence_kind=corpus.evidence_kind,
        manifest_path=(str(manifest_path) if manifest_path is not None else None),
        run_at=datetime.now(timezone.utc),
        total_cases=len(case_results),
        passed_cases=passed_cases,
        failed_cases=failed_cases,
        all_passed=failed_cases == 0,
        cases=case_results,
        rated_case_count=rated_case_count,
        rated_note_count=rated_note_count,
        human_rating_agreement_ratio=(round(matched_axes / total_axes, 4) if total_axes else None),
    )


def render_calibration_summary_markdown(summary: CalibrationRunSummary) -> str:
    lines = [
        f"# Calibration Run: {summary.corpus_id}",
        "",
        f"- Description: {summary.description}",
        f"- Evidence kind: {summary.evidence_kind}",
        f"- Run at: {summary.run_at.isoformat()}",
        f"- Manifest: {summary.manifest_path or 'inline'}",
        f"- Result: {summary.passed_cases}/{summary.total_cases} cases passed",
    ]
    if summary.human_rating_agreement_ratio is not None:
        lines.append(
            "- Human-rating agreement: "
            f"{summary.human_rating_agreement_ratio} across {summary.rated_note_count} rated notes "
            f"in {summary.rated_case_count} cases"
        )
    lines.extend(
        [
            "",
            "## Cases",
            "",
        ]
    )

    for case_result in summary.cases:
        lines.append(f"### {case_result.case_id}")
        lines.append(f"- Status: {'PASS' if case_result.passed else 'FAIL'}")
        lines.append(f"- Description: {case_result.description}")
        if case_result.analysis_model_version:
            lines.append(f"- Analysis model: {case_result.analysis_model_version}")
        if case_result.pitch_quality_mode:
            lines.append(f"- Pitch quality mode: {case_result.pitch_quality_mode}")
        if case_result.harmony_reference_mode:
            lines.append(f"- Harmony reference mode: {case_result.harmony_reference_mode}")
        if case_result.note_feedback:
            note = case_result.note_feedback
            lines.append(
                "- Note feedback: "
                f"attack={note.get('attack_signed_cents')}, "
                f"sustain={note.get('sustain_median_cents')}, "
                f"confidence={note.get('confidence')}, "
                f"message={note.get('message')}"
            )
        if case_result.human_rating_summary:
            lines.append(
                "- Human-rating agreement: "
                f"{case_result.human_rating_summary.get('agreement_ratio')} "
                f"({case_result.human_rating_summary.get('matched_axes')}/"
                f"{case_result.human_rating_summary.get('total_axes')} axes)"
            )
        if case_result.failures:
            lines.append("- Failures:")
            for failure in case_result.failures:
                lines.append(f"  - {failure}")
        lines.append("")

    return "\n".join(lines).strip() + "\n"
