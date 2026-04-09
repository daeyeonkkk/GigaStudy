from fastapi import APIRouter, Depends
from fastapi.responses import PlainTextResponse
from sqlalchemy.orm import Session

from gigastudy_api.api.schemas.ops import (
    EnvironmentValidationClaimGateResponse,
    EnvironmentValidationImportPreviewResponse,
    EnvironmentValidationImportRequest,
    EnvironmentValidationImportResultResponse,
    EnvironmentValidationRunCreateRequest,
    EnvironmentValidationRunListResponse,
    EnvironmentValidationPacketResponse,
    EnvironmentValidationRunResponse,
    OpsOverviewResponse,
)
from gigastudy_api.db.session import get_db_session
from gigastudy_api.services.ops import (
    build_environment_validation_packet,
    build_environment_validation_claim_gate,
    build_environment_validation_run_response,
    create_environment_validation_run,
    get_ops_overview,
    import_environment_validation_runs_from_text,
    list_environment_validation_runs,
    preview_environment_validation_import,
    render_environment_validation_claim_gate,
    render_environment_validation_release_notes,
)


router = APIRouter(prefix="/admin")


@router.get("/ops", response_model=OpsOverviewResponse)
def get_ops_overview_endpoint(
    session: Session = Depends(get_db_session),
) -> OpsOverviewResponse:
    return get_ops_overview(session)


@router.get("/environment-validation-packet", response_model=EnvironmentValidationPacketResponse)
def get_environment_validation_packet_endpoint(
    session: Session = Depends(get_db_session),
) -> EnvironmentValidationPacketResponse:
    return build_environment_validation_packet(session)


@router.get("/environment-validation-release-notes", response_class=PlainTextResponse)
def get_environment_validation_release_notes_endpoint(
    session: Session = Depends(get_db_session),
) -> str:
    packet = build_environment_validation_packet(session)
    return render_environment_validation_release_notes(packet)


@router.get("/environment-validation-claim-gate", response_model=EnvironmentValidationClaimGateResponse)
def get_environment_validation_claim_gate_endpoint(
    session: Session = Depends(get_db_session),
) -> EnvironmentValidationClaimGateResponse:
    return build_environment_validation_claim_gate(session)


@router.get("/environment-validation-claim-gate.md", response_class=PlainTextResponse)
def get_environment_validation_claim_gate_markdown_endpoint(
    session: Session = Depends(get_db_session),
) -> str:
    return render_environment_validation_claim_gate(session)


@router.get("/environment-validations", response_model=EnvironmentValidationRunListResponse)
def list_environment_validation_runs_endpoint(
    session: Session = Depends(get_db_session),
) -> EnvironmentValidationRunListResponse:
    items = list_environment_validation_runs(session, limit=20)
    return EnvironmentValidationRunListResponse(
        items=[build_environment_validation_run_response(item) for item in items]
    )


@router.post("/environment-validations", response_model=EnvironmentValidationRunResponse)
def create_environment_validation_run_endpoint(
    payload: EnvironmentValidationRunCreateRequest,
    session: Session = Depends(get_db_session),
) -> EnvironmentValidationRunResponse:
    item = create_environment_validation_run(session, payload)
    return build_environment_validation_run_response(item)


@router.post(
    "/environment-validations/import-preview",
    response_model=EnvironmentValidationImportPreviewResponse,
)
def preview_environment_validation_import_endpoint(
    payload: EnvironmentValidationImportRequest,
) -> EnvironmentValidationImportPreviewResponse:
    return preview_environment_validation_import(payload.csv_text)


@router.post(
    "/environment-validations/import",
    response_model=EnvironmentValidationImportResultResponse,
)
def import_environment_validation_runs_endpoint(
    payload: EnvironmentValidationImportRequest,
    session: Session = Depends(get_db_session),
) -> EnvironmentValidationImportResultResponse:
    return import_environment_validation_runs_from_text(session, payload.csv_text)
