from datetime import datetime, timezone

from sqlalchemy import Select, select
from sqlalchemy.orm import Session

from gigastudy_api.api.schemas.device_profiles import DeviceProfileUpsertRequest
from gigastudy_api.db.models import DeviceProfile
from gigastudy_api.services.projects import get_or_create_default_user


def upsert_device_profile(
    session: Session,
    payload: DeviceProfileUpsertRequest,
) -> DeviceProfile:
    user = get_or_create_default_user(session)
    now = datetime.now(timezone.utc)

    profile = session.scalar(
        select(DeviceProfile).where(
            DeviceProfile.user_id == user.user_id,
            DeviceProfile.browser == payload.browser,
            DeviceProfile.os == payload.os,
            DeviceProfile.input_device_hash == payload.input_device_hash,
            DeviceProfile.output_route == payload.output_route,
        )
    )

    if profile is None:
        profile = DeviceProfile(
            user=user,
            browser=payload.browser,
            os=payload.os,
            input_device_hash=payload.input_device_hash,
            output_route=payload.output_route,
            created_at=now,
            updated_at=now,
        )
        session.add(profile)
    else:
        profile.updated_at = now

    profile.requested_constraints_json = payload.requested_constraints
    profile.applied_settings_json = payload.applied_settings
    profile.browser_user_agent = payload.browser_user_agent
    profile.capabilities_json = payload.capabilities
    profile.diagnostic_flags_json = payload.diagnostic_flags
    profile.actual_sample_rate = payload.actual_sample_rate
    profile.channel_count = payload.channel_count
    profile.input_latency_est = payload.input_latency_est
    profile.base_latency = payload.base_latency
    profile.output_latency = payload.output_latency
    profile.calibration_method = payload.calibration_method
    profile.calibration_confidence = payload.calibration_confidence

    session.commit()
    session.refresh(profile)
    return profile


def list_device_profiles(
    session: Session,
    *,
    browser: str | None,
    os: str | None,
    input_device_hash: str | None,
    output_route: str | None,
    limit: int,
) -> list[DeviceProfile]:
    user = get_or_create_default_user(session)

    query: Select[tuple[DeviceProfile]] = select(DeviceProfile).where(
        DeviceProfile.user_id == user.user_id
    )

    if browser:
        query = query.where(DeviceProfile.browser == browser)
    if os:
        query = query.where(DeviceProfile.os == os)
    if input_device_hash:
        query = query.where(DeviceProfile.input_device_hash == input_device_hash)
    if output_route:
        query = query.where(DeviceProfile.output_route == output_route)

    query = query.order_by(DeviceProfile.updated_at.desc()).limit(limit)

    return list(session.scalars(query).all())
