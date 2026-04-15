from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from gigastudy_api import __version__
from gigastudy_api.api.router import api_router
from gigastudy_api.api.schemas.runtime_events import RuntimeEventCreateRequest
from gigastudy_api.config import get_settings
from gigastudy_api.db.session import get_session_factory
from gigastudy_api.services.runtime_events import create_runtime_event

REQUEST_ID_HEADER = "X-Request-ID"


def _record_server_exception(request: Request, exc: Exception) -> None:
    try:
        session = get_session_factory()()
        try:
            create_runtime_event(
                session,
                RuntimeEventCreateRequest(
                    source="server",
                    severity="error",
                    event_type="server_exception",
                    surface="api",
                    route_path=str(request.url.path),
                    request_id=getattr(request.state, "request_id", None),
                    request_method=request.method,
                    request_path=str(request.url),
                    message=str(exc) or exc.__class__.__name__,
                    user_agent=request.headers.get("user-agent"),
                    details={"exception_type": exc.__class__.__name__},
                ),
                request_id=getattr(request.state, "request_id", None),
            )
        finally:
            session.close()
    except Exception:
        return


def create_app() -> FastAPI:
    settings = get_settings()

    app = FastAPI(
        title=settings.app_name,
        version=__version__,
        summary="Bootstrap API for the GigaStudy studio stack.",
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.middleware("http")
    async def attach_request_id(request: Request, call_next):
        request_id = request.headers.get(REQUEST_ID_HEADER) or uuid4().hex
        request.state.request_id = request_id

        try:
            response = await call_next(request)
        except Exception as exc:
            _record_server_exception(request, exc)
            response = JSONResponse(
                status_code=500,
                content={
                    "detail": "예상하지 못한 오류가 발생했습니다.",
                    "request_id": request_id,
                },
            )

        response.headers[REQUEST_ID_HEADER] = request_id
        return response

    app.include_router(api_router, prefix=settings.api_prefix)

    @app.get("/", tags=["meta"])
    def read_root() -> dict[str, str]:
        return {
            "service": "gigastudy-api",
            "status": "ok",
            "version": __version__,
        }

    return app


app = create_app()
