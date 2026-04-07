from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from gigastudy_api.api.schemas.ops import OpsOverviewResponse
from gigastudy_api.db.session import get_db_session
from gigastudy_api.services.ops import get_ops_overview


router = APIRouter(prefix="/admin")


@router.get("/ops", response_model=OpsOverviewResponse)
def get_ops_overview_endpoint(
    session: Session = Depends(get_db_session),
) -> OpsOverviewResponse:
    return get_ops_overview(session)
