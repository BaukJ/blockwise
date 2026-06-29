"""FastAPI app factory for Blockwise. All routes live under /api."""
from __future__ import annotations

import logging

from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.sessions import SessionMiddleware

from app.config import settings
from app.auth import router as auth_router
from app.timetable import router as timetable_router
from app.jobs import router as jobs_router
from app.student import router as student_router

logging.basicConfig(level=settings.log_level)


def create_app() -> FastAPI:
    app = FastAPI(title="Blockwise API")

    # Session middleware backs Authlib's OAuth state during the Google flow.
    app.add_middleware(SessionMiddleware, secret_key=settings.secret_key)

    if settings.is_local:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=["http://localhost", "http://localhost:5173"],
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )

    api = APIRouter(prefix="/api")
    api.include_router(auth_router)
    api.include_router(timetable_router)
    api.include_router(jobs_router)
    api.include_router(student_router)

    if settings.admin_endpoints_enabled:
        from app.admin import router as admin_router

        api.include_router(admin_router)

    @api.get("/health")
    def health():
        return {"ok": True}

    app.include_router(api)
    return app


app = create_app()
