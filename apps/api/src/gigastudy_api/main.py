from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from gigastudy_api import __version__
from gigastudy_api.api.router import api_router
from gigastudy_api.config import get_settings


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
