import base64

from fastapi import APIRouter, Depends, Header, HTTPException, status

from gigastudy_api.api.schemas.admin import AdminDeleteResult, AdminStorageSummary
from gigastudy_api.config import get_settings
from gigastudy_api.services.studio_repository import StudioRepository, get_studio_repository

router = APIRouter()


def require_admin_credentials(
    x_gigastudy_admin_token: str | None = Header(default=None),
    x_gigastudy_admin_user: str | None = Header(default=None),
    x_gigastudy_admin_password: str | None = Header(default=None),
    x_gigastudy_admin_password_b64: str | None = Header(default=None),
) -> None:
    settings = get_settings()
    configured_token = settings.admin_token
    if configured_token and x_gigastudy_admin_token == configured_token:
        return

    submitted_password = x_gigastudy_admin_password
    if x_gigastudy_admin_password_b64 is not None:
        submitted_password = _decode_admin_password(x_gigastudy_admin_password_b64)

    if (
        x_gigastudy_admin_user == settings.admin_username
        and submitted_password == settings.admin_password
    ):
        return

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid admin credentials.",
    )


def _decode_admin_password(encoded_password: str) -> str | None:
    try:
        return base64.b64decode(encoded_password, validate=True).decode("utf-8")
    except (ValueError, UnicodeDecodeError):
        return None


@router.get("/storage", response_model=AdminStorageSummary)
def get_admin_storage_summary(
    _: None = Depends(require_admin_credentials),
    repository: StudioRepository = Depends(get_studio_repository),
) -> AdminStorageSummary:
    return repository.get_admin_storage_summary()


@router.delete("/studios/{studio_id}", response_model=AdminDeleteResult)
def delete_admin_studio(
    studio_id: str,
    _: None = Depends(require_admin_credentials),
    repository: StudioRepository = Depends(get_studio_repository),
) -> AdminDeleteResult:
    return repository.delete_admin_studio(studio_id)


@router.delete("/studios/{studio_id}/assets", response_model=AdminDeleteResult)
def delete_admin_studio_assets(
    studio_id: str,
    _: None = Depends(require_admin_credentials),
    repository: StudioRepository = Depends(get_studio_repository),
) -> AdminDeleteResult:
    return repository.delete_admin_studio_assets(studio_id)


@router.delete("/assets/{asset_id}", response_model=AdminDeleteResult)
def delete_admin_asset(
    asset_id: str,
    _: None = Depends(require_admin_credentials),
    repository: StudioRepository = Depends(get_studio_repository),
) -> AdminDeleteResult:
    return repository.delete_admin_asset(asset_id)
