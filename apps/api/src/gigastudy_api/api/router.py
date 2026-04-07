from fastapi import APIRouter

from gigastudy_api.api.routes.device_profiles import router as device_profiles_router
from gigastudy_api.api.routes.guides import router as guides_router
from gigastudy_api.api.routes.health import router as health_router
from gigastudy_api.api.routes.projects import router as projects_router
from gigastudy_api.api.routes.takes import router as takes_router

api_router = APIRouter()
api_router.include_router(device_profiles_router, tags=["device-profiles"])
api_router.include_router(guides_router, tags=["guides"])
api_router.include_router(health_router, tags=["health"])
api_router.include_router(projects_router, tags=["projects"])
api_router.include_router(takes_router, tags=["tracks"])
