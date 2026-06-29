from fastapi import APIRouter

from app.auth import routes, native_routes, google_routes

router = APIRouter(prefix="/auth", tags=["auth"])
router.include_router(routes.router)
router.include_router(native_routes.router, prefix="/native")
router.include_router(google_routes.router, prefix="/google")
