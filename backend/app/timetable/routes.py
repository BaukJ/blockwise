"""Teacher-facing timetable CRUD. Student-facing read endpoints live here too."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.models import EntryMode, TimetableModel, UserModel
from app.security import get_current_user

router = APIRouter(prefix="/timetable", tags=["timetable"])


class SubjectIn(BaseModel):
    subject: str
    total_classes: int
    class_capacity: int


class TimetableCreate(BaseModel):
    name: str
    num_blocks: int = 4
    entry_mode: EntryMode = EntryMode.UI
    deadline: datetime | None = None


class TimetableUpdate(BaseModel):
    name: str | None = None
    num_blocks: int | None = None
    deadline: datetime | None = None
    subjects: list[SubjectIn] | None = None
    reassignment_enabled: bool | None = None


class TimetableOut(BaseModel):
    id: str
    owner: str
    name: str
    created_at: datetime
    deadline: datetime | None
    entry_mode: str
    num_blocks: int
    subjects: list[dict]
    finalised_job_id: str | None
    reassignment_enabled: bool


def serialize(tt: TimetableModel) -> TimetableOut:
    return TimetableOut(
        id=tt.id,
        owner=tt.owner,
        name=tt.name,
        created_at=tt.created_at,
        deadline=tt.deadline,
        entry_mode=tt.entry_mode,
        num_blocks=int(tt.num_blocks),
        subjects=list(tt.subjects or []),
        finalised_job_id=tt.finalised_job_id,
        reassignment_enabled=bool(tt.reassignment_enabled),
    )


def owned_or_404(timetable_id: str, user: UserModel) -> TimetableModel:
    try:
        tt = TimetableModel.get(timetable_id)
    except TimetableModel.DoesNotExist:
        raise HTTPException(status_code=404, detail="Timetable not found")
    if tt.owner != user.email:
        raise HTTPException(status_code=403, detail="Not your timetable")
    return tt


@router.get("", response_model=list[TimetableOut])
def list_timetables(user: UserModel = Depends(get_current_user)):
    items = TimetableModel.owner_index.query(user.email)
    return sorted(
        (serialize(t) for t in items), key=lambda t: t.created_at, reverse=True
    )


@router.post("", response_model=TimetableOut)
def create_timetable(body: TimetableCreate, user: UserModel = Depends(get_current_user)):
    tt = TimetableModel(
        id=str(uuid.uuid4()),
        owner=user.email,
        name=body.name,
        created_at=datetime.now(timezone.utc),
        deadline=body.deadline,
        entry_mode=body.entry_mode.value,
        num_blocks=body.num_blocks,
        subjects=[],
    )
    tt.save()
    return serialize(tt)


@router.get("/{timetable_id}", response_model=TimetableOut)
def get_timetable(timetable_id: str, user: UserModel = Depends(get_current_user)):
    return serialize(owned_or_404(timetable_id, user))


@router.patch("/{timetable_id}", response_model=TimetableOut)
def update_timetable(
    timetable_id: str,
    body: TimetableUpdate,
    user: UserModel = Depends(get_current_user),
):
    tt = owned_or_404(timetable_id, user)
    actions = []
    if body.name is not None:
        actions.append(TimetableModel.name.set(body.name))
    if body.num_blocks is not None:
        actions.append(TimetableModel.num_blocks.set(body.num_blocks))
    if body.deadline is not None:
        actions.append(TimetableModel.deadline.set(body.deadline))
    if body.subjects is not None:
        actions.append(
            TimetableModel.subjects.set([s.model_dump() for s in body.subjects])
        )
    if body.reassignment_enabled is not None:
        actions.append(
            TimetableModel.reassignment_enabled.set(body.reassignment_enabled)
        )
    if actions:
        tt.update(actions=actions)
    return serialize(tt)


@router.delete("/{timetable_id}")
def delete_timetable(timetable_id: str, user: UserModel = Depends(get_current_user)):
    owned_or_404(timetable_id, user).delete()
    return {"ok": True}
