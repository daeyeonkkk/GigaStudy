from fastapi import APIRouter, Depends

from gigastudy_api import __version__
from gigastudy_api.config import Settings, get_settings

router = APIRouter()


@router.get("/health")
def read_health(settings: Settings = Depends(get_settings)) -> dict[str, str]:
    return {
        "service": "gigastudy-api",
        "status": "ok",
        "env": settings.app_env,
        "version": __version__,
    }
