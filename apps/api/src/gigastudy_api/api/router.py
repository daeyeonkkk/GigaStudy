from fastapi import APIRouter

from gigastudy_api.api.routes.admin import router as admin_router
from gigastudy_api.api.routes.health import router as health_router
from gigastudy_api.api.routes.studios import router as studios_router

api_router = APIRouter()
api_router.include_router(health_router, tags=["health"])
api_router.include_router(studios_router, prefix="/studios", tags=["studios"])
api_router.include_router(admin_router, prefix="/admin", tags=["admin"])
