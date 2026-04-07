from fastapi import APIRouter

from gigastudy_api.api.routes.analysis import router as analysis_router
from gigastudy_api.api.routes.device_profiles import router as device_profiles_router
from gigastudy_api.api.routes.guides import router as guides_router
from gigastudy_api.api.routes.health import router as health_router
from gigastudy_api.api.routes.mixdowns import router as mixdowns_router
from gigastudy_api.api.routes.processing import router as processing_router
from gigastudy_api.api.routes.projects import router as projects_router
from gigastudy_api.api.routes.studio import router as studio_router
from gigastudy_api.api.routes.takes import router as takes_router

api_router = APIRouter()
api_router.include_router(analysis_router, tags=["analysis"])
api_router.include_router(device_profiles_router, tags=["device-profiles"])
api_router.include_router(guides_router, tags=["guides"])
api_router.include_router(health_router, tags=["health"])
api_router.include_router(mixdowns_router, tags=["mixdowns"])
api_router.include_router(processing_router, tags=["processing"])
api_router.include_router(projects_router, tags=["projects"])
api_router.include_router(studio_router, tags=["studio"])
api_router.include_router(takes_router, tags=["tracks"])
