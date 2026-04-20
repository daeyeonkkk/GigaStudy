from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from gigastudy_api import __version__
from gigastudy_api.api.router import api_router
from gigastudy_api.config import get_settings

REQUEST_ID_HEADER = "X-Request-ID"


def create_app() -> FastAPI:
    settings = get_settings()

    app = FastAPI(
        title=settings.app_name,
        version=__version__,
        summary="Six-track a cappella studio API for GigaStudy.",
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
            response = JSONResponse(
                status_code=500,
                content={
                    "detail": str(exc) or exc.__class__.__name__,
                    "request_id": request_id,
                },
            )

        response.headers[REQUEST_ID_HEADER] = request_id
        return response

    app.include_router(api_router, prefix=settings.api_prefix)

    @app.get("/", tags=["meta"])
    def read_root() -> dict[str, str]:
        return {
            "service": "gigastudy-six-track-api",
            "status": "ok",
            "version": __version__,
        }

    return app


app = create_app()
