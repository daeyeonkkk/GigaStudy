from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from gigastudy_api.api.schemas.device_profiles import DeviceProfileResponse
from gigastudy_api.api.schemas.projects import ProjectResponse
from gigastudy_api.api.schemas.studio import StudioMixdownSummary, StudioSnapshotResponse
from gigastudy_api.db.session import get_db_session
from gigastudy_api.services.guides import build_guide_response
from gigastudy_api.services.studio import get_studio_snapshot
from gigastudy_api.services.takes import build_take_response

router = APIRouter(prefix="/projects")


@router.get("/{project_id}/studio", response_model=StudioSnapshotResponse)
def get_studio_snapshot_endpoint(
    project_id: UUID,
    request: Request,
    session: Session = Depends(get_db_session),
) -> StudioSnapshotResponse:
    snapshot = get_studio_snapshot(session, project_id)
    if snapshot is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    return StudioSnapshotResponse(
        project=ProjectResponse.model_validate(snapshot.project),
        guide=build_guide_response(snapshot.guide, request) if snapshot.guide else None,
        takes=[build_take_response(track, request) for track in snapshot.takes],
        latest_device_profile=(
            DeviceProfileResponse.model_validate(snapshot.latest_device_profile)
            if snapshot.latest_device_profile
            else None
        ),
        mixdown=(
            StudioMixdownSummary(
                track_id=snapshot.mixdown.track_id,
                track_status=snapshot.mixdown.track_status.value,
                updated_at=snapshot.mixdown.updated_at,
            )
            if snapshot.mixdown
            else None
        ),
    )
