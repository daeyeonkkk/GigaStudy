from __future__ import annotations

from fastapi import HTTPException

from gigastudy_api.api.schemas.admin import AdminLimitSummary
from gigastudy_api.config import get_settings


def build_admin_limit_summary(*, studio_count: int, asset_bytes: int) -> AdminLimitSummary:
    settings = get_settings()
    studio_warning = studio_count >= settings.studio_soft_limit
    studio_limit_reached = studio_count >= settings.studio_hard_limit
    asset_warning = asset_bytes >= settings.asset_warning_bytes
    asset_limit_reached = asset_bytes >= settings.asset_hard_bytes
    warnings: list[str] = []
    if studio_warning:
        warnings.append(f"Studio warning line reached: {studio_count}/{settings.studio_soft_limit}.")
    if studio_limit_reached:
        warnings.append(f"Studio hard limit reached: {studio_count}/{settings.studio_hard_limit}.")
    if asset_warning:
        warnings.append(
            f"Asset storage warning line reached: {asset_bytes}/{settings.asset_warning_bytes} bytes."
        )
    if asset_limit_reached:
        warnings.append(f"Asset hard limit reached: {asset_bytes}/{settings.asset_hard_bytes} bytes.")
    return AdminLimitSummary(
        studio_soft_limit=settings.studio_soft_limit,
        studio_hard_limit=settings.studio_hard_limit,
        asset_warning_bytes=settings.asset_warning_bytes,
        asset_hard_bytes=settings.asset_hard_bytes,
        max_upload_bytes=settings.max_upload_bytes,
        max_active_engine_jobs=settings.max_active_engine_jobs,
        studio_warning=studio_warning,
        studio_limit_reached=studio_limit_reached,
        asset_warning=asset_warning,
        asset_limit_reached=asset_limit_reached,
        warnings=warnings,
    )


def ensure_studio_capacity(studio_count: int) -> None:
    settings = get_settings()
    if settings.studio_hard_limit <= 0:
        return
    if studio_count >= settings.studio_hard_limit:
        raise HTTPException(
            status_code=409,
            detail=(
                "Studio creation is temporarily capped for the alpha environment "
                f"({studio_count}/{settings.studio_hard_limit})."
            ),
        )


def ensure_asset_capacity(*, current_bytes: int, incoming_bytes: int) -> None:
    settings = get_settings()
    if settings.asset_hard_bytes <= 0:
        return
    if current_bytes + incoming_bytes > settings.asset_hard_bytes:
        raise HTTPException(
            status_code=507,
            detail=(
                "Stored asset capacity is temporarily capped for the alpha environment "
                f"({current_bytes + incoming_bytes}/{settings.asset_hard_bytes} bytes)."
            ),
        )
