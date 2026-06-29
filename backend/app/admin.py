"""Diagnostic / setup endpoints, enabled only when ADMIN_ENDPOINTS_ENABLED=true."""
from __future__ import annotations

from fastapi import APIRouter

from app.models import create_tables, delete_tables

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/create-tables")
def create():
    create_tables()
    return {"ok": True}


@router.get("/recreate-tables")
def recreate():
    delete_tables()
    create_tables()
    return {"ok": True}
