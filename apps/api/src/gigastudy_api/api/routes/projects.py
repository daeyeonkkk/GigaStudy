from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from gigastudy_api.api.schemas.projects import ProjectCreateRequest, ProjectResponse
from gigastudy_api.db.session import get_db_session
from gigastudy_api.services.projects import create_project, get_project_by_id

router = APIRouter(prefix="/projects")


@router.post("", response_model=ProjectResponse, status_code=status.HTTP_201_CREATED)
def create_project_endpoint(
    payload: ProjectCreateRequest,
    session: Session = Depends(get_db_session),
) -> ProjectResponse:
    project = create_project(session, payload)
    return ProjectResponse.model_validate(project)


@router.get("/{project_id}", response_model=ProjectResponse)
def get_project_endpoint(
    project_id: UUID,
    session: Session = Depends(get_db_session),
) -> ProjectResponse:
    project = get_project_by_id(session, project_id)
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    return ProjectResponse.model_validate(project)
