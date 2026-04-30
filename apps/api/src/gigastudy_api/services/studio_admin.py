from __future__ import annotations

from collections.abc import Callable

from gigastudy_api.api.schemas.admin import AdminAssetSummary, AdminStudioSummary
from gigastudy_api.api.schemas.studios import Studio

NormalizeReference = Callable[[str | None], str | None]


def referenced_asset_paths(
    studio: Studio,
    *,
    normalize_reference: NormalizeReference,
) -> set[str]:
    references: set[str] = set()
    for track in studio.tracks:
        normalized = normalize_reference(track.audio_source_path)
        if normalized is not None:
            references.add(normalized)
    for candidate in studio.candidates:
        normalized = normalize_reference(candidate.audio_source_path)
        if normalized is not None:
            references.add(normalized)
    for job in studio.jobs:
        for job_path in (job.input_path, job.output_path):
            normalized = normalize_reference(job_path)
            if normalized is not None:
                references.add(normalized)
    return references


def build_admin_studio_summary(
    studio: Studio,
    *,
    asset_count: int,
    asset_bytes: int,
    assets: list[AdminAssetSummary],
) -> AdminStudioSummary:
    return AdminStudioSummary(
        studio_id=studio.studio_id,
        title=studio.title,
        bpm=studio.bpm,
        registered_track_count=sum(1 for track in studio.tracks if track.status == "registered"),
        report_count=len(studio.reports),
        candidate_count=len(studio.candidates),
        job_count=len(studio.jobs),
        asset_count=asset_count,
        asset_bytes=asset_bytes,
        created_at=studio.created_at,
        updated_at=studio.updated_at,
        assets=assets,
    )


def clear_studio_asset_references(studio: Studio, *, timestamp: str) -> None:
    for track in studio.tracks:
        if track.audio_source_path is not None:
            track.audio_source_path = None
            track.audio_source_label = None
            track.audio_mime_type = None
            track.updated_at = timestamp
    for candidate in studio.candidates:
        candidate.audio_source_path = None
        candidate.audio_source_label = None
        candidate.audio_mime_type = None
        candidate.updated_at = timestamp
    for job in studio.jobs:
        job.input_path = None
        job.output_path = None
        job.updated_at = timestamp


def clear_asset_references(
    studio: Studio,
    *,
    relative_path: str,
    timestamp: str,
    normalize_reference: NormalizeReference,
) -> bool:
    changed = False
    for track in studio.tracks:
        if normalize_reference(track.audio_source_path) == relative_path:
            track.audio_source_path = None
            track.audio_source_label = None
            track.audio_mime_type = None
            track.updated_at = timestamp
            changed = True
    for candidate in studio.candidates:
        if normalize_reference(candidate.audio_source_path) == relative_path:
            candidate.audio_source_path = None
            candidate.audio_source_label = None
            candidate.audio_mime_type = None
            candidate.updated_at = timestamp
            changed = True
    for job in studio.jobs:
        if normalize_reference(job.input_path) == relative_path:
            job.input_path = None
            job.updated_at = timestamp
            changed = True
        if normalize_reference(job.output_path) == relative_path:
            job.output_path = None
            job.updated_at = timestamp
            changed = True
    return changed
