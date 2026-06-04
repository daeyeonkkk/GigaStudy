import logging
from time import perf_counter
from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from gigastudy_api import __version__
from gigastudy_api.api.router import api_router
from gigastudy_api.config import get_settings
from gigastudy_api.services.performance import begin_request_metrics, end_request_metrics

REQUEST_ID_HEADER = "X-Request-ID"
SLOW_REQUEST_THRESHOLD_MS = 500.0
logger = logging.getLogger("gigastudy_api.requests")


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
        started_at = perf_counter()
        metrics_token = begin_request_metrics()

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

        elapsed_ms = (perf_counter() - started_at) * 1000
        metrics = end_request_metrics(metrics_token)
        response.headers[REQUEST_ID_HEADER] = request_id
        response.headers["X-Response-Time-ms"] = f"{elapsed_ms:.1f}"
        if elapsed_ms >= SLOW_REQUEST_THRESHOLD_MS:
            logger.info(
                "slow_request method=%s path=%s status=%s total_ms=%.1f store_load_ms=%.1f store_save_ms=%.1f response_build_ms=%.1f engine_job_ms=%.1f request_length=%s response_length=%s request_id=%s",
                request.method,
                request.url.path,
                response.status_code,
                elapsed_ms,
                metrics.get("store_load_ms", 0.0),
                metrics.get("store_save_ms", 0.0),
                metrics.get("response_build_ms", 0.0),
                metrics.get("engine_job_ms", 0.0),
                request.headers.get("content-length", "-"),
                response.headers.get("content-length", "-"),
                request_id,
            )
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
