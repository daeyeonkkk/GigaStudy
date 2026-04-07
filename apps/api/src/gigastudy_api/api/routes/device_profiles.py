from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from gigastudy_api.api.schemas.device_profiles import (
    DeviceProfileListResponse,
    DeviceProfileResponse,
    DeviceProfileUpsertRequest,
)
from gigastudy_api.db.session import get_db_session
from gigastudy_api.services.device_profiles import list_device_profiles, upsert_device_profile

router = APIRouter(prefix="/device-profiles")


@router.post("", response_model=DeviceProfileResponse)
def upsert_device_profile_endpoint(
    payload: DeviceProfileUpsertRequest,
    session: Session = Depends(get_db_session),
) -> DeviceProfileResponse:
    profile = upsert_device_profile(session, payload)
    return DeviceProfileResponse.model_validate(profile)


@router.get("", response_model=DeviceProfileListResponse)
def list_device_profiles_endpoint(
    browser: str | None = Query(default=None),
    os: str | None = Query(default=None),
    input_device_hash: str | None = Query(default=None),
    output_route: str | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=50),
    session: Session = Depends(get_db_session),
) -> DeviceProfileListResponse:
    profiles = list_device_profiles(
        session,
        browser=browser,
        os=os,
        input_device_hash=input_device_hash,
        output_route=output_route,
        limit=limit,
    )
    return DeviceProfileListResponse(
        items=[DeviceProfileResponse.model_validate(profile) for profile in profiles]
    )
