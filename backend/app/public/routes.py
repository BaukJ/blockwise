"""Public magic-link endpoints: let a student fill in their choices via a signed,
time-boxed link without signing in. The link works only until they submit (one-time)."""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.models import EntryModel, EntryStatus, TimetableModel, entry_ready
from app.rules import rules_error
from app.security import read_timed_token
from app.timetable.entries import MAGIC_SALT

router = APIRouter(prefix="/public", tags=["public"])

MAGIC_MAX_AGE = 7 * 24 * 3600  # 7 days


class FillOut(BaseModel):
    timetable_name: str
    subjects: list[dict]
    options_required: int
    backups_allowed: int
    rules: list[dict]
    my_choices: list[str]
    my_backups: list[str]
    submitted: bool


class FillIn(BaseModel):
    choices: list[str]
    backups: list[str] = []


def _resolve(token: str) -> tuple[TimetableModel, EntryModel]:
    data = read_timed_token(token, MAGIC_SALT, max_age=MAGIC_MAX_AGE)
    try:
        tt = TimetableModel.get(data["tid"])
        entry = EntryModel.get(data["tid"], data["key"])
    except (TimetableModel.DoesNotExist, EntryModel.DoesNotExist):
        raise HTTPException(status_code=404, detail="This link is no longer valid")
    return tt, entry


def _serialize(tt: TimetableModel, entry: EntryModel) -> FillOut:
    return FillOut(
        timetable_name=tt.name,
        subjects=list(tt.subjects or []),
        options_required=int(tt.options_required),
        backups_allowed=int(tt.backups_allowed),
        rules=list(tt.rules or []),
        my_choices=list(entry.choices or []),
        my_backups=list(entry.backups or []),
        submitted=entry_ready(entry.status),
    )


@router.get("/fill/{token}", response_model=FillOut)
def get_fill(token: str):
    tt, entry = _resolve(token)
    return _serialize(tt, entry)


@router.post("/fill/{token}", response_model=FillOut)
def submit_fill(token: str, body: FillIn):
    tt, entry = _resolve(token)
    if entry_ready(entry.status):
        raise HTTPException(status_code=409, detail="Choices have already been submitted")

    choices = [c.strip() for c in body.choices if c.strip()]
    backups = [b.strip() for b in body.backups if b.strip()]
    required = int(tt.options_required)
    if len(choices) != required:
        raise HTTPException(status_code=400, detail=f"Please rank {required} choices")
    if len(backups) > int(tt.backups_allowed):
        raise HTTPException(status_code=400, detail="Too many backups")
    if len(set(choices + backups)) != len(choices + backups):
        raise HTTPException(status_code=400, detail="Choices and backups must be distinct")
    violation = rules_error(list(tt.rules or []), choices)
    if violation:
        raise HTTPException(status_code=400, detail=violation)

    entry.update(
        actions=[
            EntryModel.choices.set(choices),
            EntryModel.backups.set(backups),
            EntryModel.status.set(EntryStatus.SUBMITTED.value),
            EntryModel.submitted_at.set(datetime.now(timezone.utc)),
        ]
    )
    return _serialize(tt, entry)
