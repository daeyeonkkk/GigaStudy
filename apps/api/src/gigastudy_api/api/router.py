from fastapi import APIRouter

from gigastudy_api.api.routes.health import router as health_router
from gigastudy_api.api.routes.projects import router as projects_router

api_router = APIRouter()
api_router.include_router(health_router, tags=["health"])
api_router.include_router(projects_router, tags=["projects"])
