from __future__ import annotations

from collections.abc import Iterable

from fastapi import HTTPException

from gigastudy_api.api.schemas.studios import Studio

ACTIVE_EXTRACTION_JOB_STATUSES = {"queued", "running"}


def active_extraction_job_slot_ids(
    studio: Studio,
    *,
    ignore_job_id: str | None = None,
) -> set[int]:
    slot_ids: set[int] = set()
    for job in studio.jobs:
        if ignore_job_id is not None and job.job_id == ignore_job_id:
            continue
        if job.status not in ACTIVE_EXTRACTION_JOB_STATUSES:
            continue
        if job.parse_all_parts:
            slot_ids.update(track.slot_id for track in studio.tracks if track.slot_id <= 5)
        else:
            slot_ids.add(job.slot_id)
    return slot_ids


def ensure_no_active_extraction_jobs(
    studio: Studio,
    slot_ids: Iterable[int],
    *,
    action_label: str,
    ignore_job_id: str | None = None,
) -> None:
    requested_slot_ids = set(slot_ids)
    if not requested_slot_ids:
        return
    locked_slot_ids = active_extraction_job_slot_ids(studio, ignore_job_id=ignore_job_id) & requested_slot_ids
    if not locked_slot_ids:
        return
    locked_slots = ", ".join(str(slot_id) for slot_id in sorted(locked_slot_ids))
    raise HTTPException(
        status_code=409,
        detail=f"{action_label} cannot run while extraction is queued or running for track slot(s): {locked_slots}.",
    )
