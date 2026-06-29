from fastapi import APIRouter

from app.timetable import routes, entries

router = APIRouter()
router.include_router(routes.router)
router.include_router(entries.router)
