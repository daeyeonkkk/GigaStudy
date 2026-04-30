from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import HTTPException

from gigastudy_api.services.engine.pdf_export import ScorePdfExportError, build_studio_score_pdf
from gigastudy_api.services.engine.score_preview import ScorePreviewError, render_score_source_preview
from gigastudy_api.services.studio_assets import StudioAssetService
from gigastudy_api.services.upload_policy import guess_audio_mime_type


class StudioResourceCommands:
    def __init__(
        self,
        *,
        assets: StudioAssetService,
        repository: Any,
    ) -> None:
        self._assets = assets
        self._repository = repository

    def export_score_pdf(self, studio_id: str, *, owner_token: str | None = None) -> tuple[str, bytes]:
        studio = self._repository.get_studio(studio_id, owner_token=owner_token, enforce_owner=True)
        try:
            return f"{studio.studio_id}-score.pdf", build_studio_score_pdf(studio)
        except ScorePdfExportError as error:
            raise HTTPException(status_code=409, detail=str(error)) from error

    def get_track_audio(
        self,
        studio_id: str,
        slot_id: int,
        *,
        owner_token: str | None = None,
    ) -> tuple[Path, str, str]:
        studio = self._repository.get_studio(studio_id, owner_token=owner_token, enforce_owner=True)
        track = self._repository._find_track(studio, slot_id)
        if track.status != "registered" or track.audio_source_path is None:
            raise HTTPException(status_code=404, detail="Track audio source not found.")

        source_path = self._assets.resolve_data_asset_path(track.audio_source_path)
        if not source_path.exists() or not source_path.is_file():
            raise HTTPException(status_code=404, detail="Track audio source file is missing.")

        media_type = track.audio_mime_type or guess_audio_mime_type(source_path.name)
        filename = track.audio_source_label or track.source_label or source_path.name
        return source_path, media_type, filename

    def get_omr_source_preview(
        self,
        studio_id: str,
        job_id: str,
        *,
        page_index: int = 0,
        owner_token: str | None = None,
    ) -> tuple[bytes, str]:
        studio = self._repository.get_studio(studio_id, owner_token=owner_token, enforce_owner=True)
        job = next((item for item in studio.jobs if item.job_id == job_id), None)
        if job is None:
            raise HTTPException(status_code=404, detail="Extraction job not found.")
        if job.job_type != "omr":
            raise HTTPException(status_code=409, detail="Only OMR jobs have score previews.")
        if job.input_path is None:
            raise HTTPException(status_code=404, detail="OMR source file is missing.")

        source_path = self._assets.resolve_data_asset_path(job.input_path)
        try:
            content = render_score_source_preview(source_path, page_index=page_index)
        except ScorePreviewError as error:
            raise HTTPException(status_code=409, detail=str(error)) from error

        filename_root = Path(job.source_label or job.job_id).stem or job.job_id
        safe_filename_root = "".join(
            char for char in filename_root if char.isalnum() or char in {"-", "_", "."}
        ) or job.job_id
        return content, f"{safe_filename_root}-page-{page_index + 1}.png"
