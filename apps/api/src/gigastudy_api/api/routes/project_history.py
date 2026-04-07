from uuid import UUID

from fastapi import APIRouter, Depends, Request, status
from sqlalchemy.orm import Session

from gigastudy_api.api.schemas.project_history import (
    ProjectVersionCreateRequest,
    ProjectVersionListResponse,
    ProjectVersionResponse,
    ShareLinkCreateRequest,
    ShareLinkListResponse,
    ShareLinkResponse,
    SharedProjectResponse,
)
from gigastudy_api.db.session import get_db_session
from gigastudy_api.services.project_history import (
    create_project_version,
    create_share_link,
    deactivate_share_link,
    get_shared_project_response,
    list_project_versions,
    list_share_links,
)


router = APIRouter()


@router.post(
    "/projects/{project_id}/versions",
    response_model=ProjectVersionResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_project_version_endpoint(
    project_id: UUID,
    payload: ProjectVersionCreateRequest,
    request: Request,
    session: Session = Depends(get_db_session),
) -> ProjectVersionResponse:
    return create_project_version(session, project_id, payload, request)


@router.get(
    "/projects/{project_id}/versions",
    response_model=ProjectVersionListResponse,
)
def list_project_versions_endpoint(
    project_id: UUID,
    session: Session = Depends(get_db_session),
) -> ProjectVersionListResponse:
    return list_project_versions(session, project_id)


@router.post(
    "/projects/{project_id}/share-links",
    response_model=ShareLinkResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_share_link_endpoint(
    project_id: UUID,
    payload: ShareLinkCreateRequest,
    request: Request,
    session: Session = Depends(get_db_session),
) -> ShareLinkResponse:
    return create_share_link(session, project_id, payload, request)


@router.get(
    "/projects/{project_id}/share-links",
    response_model=ShareLinkListResponse,
)
def list_share_links_endpoint(
    project_id: UUID,
    request: Request,
    session: Session = Depends(get_db_session),
) -> ShareLinkListResponse:
    return list_share_links(session, project_id, request)


@router.post(
    "/share-links/{share_link_id}/deactivate",
    response_model=ShareLinkResponse,
)
def deactivate_share_link_endpoint(
    share_link_id: UUID,
    request: Request,
    session: Session = Depends(get_db_session),
) -> ShareLinkResponse:
    return deactivate_share_link(session, share_link_id, request)


@router.get(
    "/shared/{token}",
    response_model=SharedProjectResponse,
)
def get_shared_project_endpoint(
    token: str,
    session: Session = Depends(get_db_session),
) -> SharedProjectResponse:
    return get_shared_project_response(session, token)
