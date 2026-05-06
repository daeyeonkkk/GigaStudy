from email.utils import formatdate
from pathlib import Path

from fastapi import APIRouter, Depends, Request
from fastapi.responses import FileResponse

from gigastudy_api.api.schemas.admin import PlaybackInstrumentConfig
from gigastudy_api.services.playback_instrument import (
    PlaybackInstrumentService,
    get_playback_instrument_service,
)

router = APIRouter()


def _asset_file_headers(path: Path, *, cache_control: str) -> dict[str, str]:
    stat = path.stat()
    return {
        "Cache-Control": cache_control,
        "ETag": f'W/"{stat.st_mtime_ns}-{stat.st_size}"',
        "Last-Modified": formatdate(stat.st_mtime, usegmt=True),
    }


@router.get("/playback-instrument", response_model=PlaybackInstrumentConfig)
def get_playback_instrument(
    request: Request,
    service: PlaybackInstrumentService = Depends(get_playback_instrument_service),
) -> PlaybackInstrumentConfig:
    return service.get_config(audio_url=str(request.url_for("get_playback_instrument_audio")))


@router.get("/playback-instrument/audio")
def get_playback_instrument_audio(
    service: PlaybackInstrumentService = Depends(get_playback_instrument_service),
) -> FileResponse:
    path, media_type, filename = service.get_audio_file()
    return FileResponse(
        path,
        media_type=media_type,
        filename=filename,
        headers=_asset_file_headers(path, cache_control="private, max-age=300"),
    )
