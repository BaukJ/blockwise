"""AWS Lambda entrypoint for the API. Creates tables on cold start."""
from mangum import Mangum

from app import app
from app.models import create_tables

try:
    create_tables()
except Exception as exc:  # noqa: BLE001 — never block the handler on table setup
    print(f"[startup] create_tables skipped: {exc}")

lambda_handler = Mangum(app, lifespan="off")
