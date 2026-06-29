"""Teacher-facing timetable CRUD. Student-facing read endpoints live here too."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.models import (
    EntryMode,
    EntryModel,
    EntryStatus,
    JobModel,
    TimetableModel,
    UserModel,
    status_for_choices,
)
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
    options_required: int | None = None
    backups_allowed: int | None = None
    deadline: datetime | None = None
    subjects: list[SubjectIn] | None = None
    rules: list[dict] | None = None
    reassignment_enabled: bool | None = None


class TimetableOut(BaseModel):
    id: str
    owner: str
    name: str
    created_at: datetime
    deadline: datetime | None
    entry_mode: str
    num_blocks: int
    options_required: int
    backups_allowed: int
    subjects: list[dict]
    rules: list[dict]
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
        options_required=int(tt.options_required),
        backups_allowed=int(tt.backups_allowed),
        subjects=list(tt.subjects or []),
        rules=list(tt.rules or []),
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

    # Validate the blocks/options/backups relationship against the resulting values.
    num_blocks = body.num_blocks if body.num_blocks is not None else int(tt.num_blocks)
    options_required = (
        body.options_required
        if body.options_required is not None
        else int(tt.options_required)
    )
    if not (1 <= num_blocks <= 8):
        raise HTTPException(status_code=400, detail="Blocks must be between 1 and 8")
    if options_required < 1:
        raise HTTPException(status_code=400, detail="Students need at least 1 option")
    if options_required > num_blocks:
        raise HTTPException(
            status_code=400, detail="Options per student cannot exceed the number of blocks"
        )
    if body.backups_allowed is not None and body.backups_allowed < 0:
        raise HTTPException(status_code=400, detail="Backups cannot be negative")

    actions = []
    if body.name is not None:
        actions.append(TimetableModel.name.set(body.name))
    if body.num_blocks is not None:
        actions.append(TimetableModel.num_blocks.set(body.num_blocks))
    if body.options_required is not None:
        actions.append(TimetableModel.options_required.set(body.options_required))
    if body.backups_allowed is not None:
        actions.append(TimetableModel.backups_allowed.set(body.backups_allowed))
    if body.deadline is not None:
        actions.append(TimetableModel.deadline.set(body.deadline))
    if body.subjects is not None:
        actions.append(
            TimetableModel.subjects.set([s.model_dump() for s in body.subjects])
        )
    if body.rules is not None:
        actions.append(TimetableModel.rules.set(body.rules))
    if body.reassignment_enabled is not None:
        actions.append(
            TimetableModel.reassignment_enabled.set(body.reassignment_enabled)
        )
    if actions:
        tt.update(actions=actions)
    return serialize(tt)


class CloneIn(BaseModel):
    name: str
    include_subjects: bool = True
    include_students: bool = False
    include_choices: bool = False


@router.post("/{timetable_id}/clone", response_model=TimetableOut)
def clone_timetable(
    timetable_id: str, body: CloneIn, user: UserModel = Depends(get_current_user)
):
    """Copy a timetable. Config (blocks/options/backups) is always copied; subjects,
    students and their choices are opt-in. Choices require students AND subjects so
    the copied choices still reference real subjects."""
    src = owned_or_404(timetable_id, user)
    if body.include_choices and not (body.include_students and body.include_subjects):
        raise HTTPException(
            status_code=400,
            detail="Copying choices needs students and subjects copied too",
        )

    new_id = str(uuid.uuid4())
    # Rules reference subjects, so they ride along with the subjects option.
    clone = TimetableModel(
        id=new_id,
        owner=user.email,
        name=body.name,
        created_at=datetime.now(timezone.utc),
        entry_mode=src.entry_mode,
        num_blocks=src.num_blocks,
        options_required=src.options_required,
        backups_allowed=src.backups_allowed,
        subjects=list(src.subjects or []) if body.include_subjects else [],
        rules=list(src.rules or []) if body.include_subjects else [],
    )
    clone.save()

    if body.include_students:
        required = int(src.options_required)
        for e in EntryModel.query(timetable_id):
            choices = list(e.choices or []) if body.include_choices else []
            backups = list(e.backups or []) if body.include_choices else []
            if body.include_choices and choices:
                status = status_for_choices(choices, teacher=True, required=required)
            else:
                status = (
                    EntryStatus.PENDING.value
                    if e.student_email
                    else EntryStatus.DRAFT.value
                )
            EntryModel(
                timetable_id=new_id,
                student_key=e.student_key,
                student_email=e.student_email,
                name=e.name,
                choices=choices,
                backups=backups,
                status=status,
            ).save()

    return serialize(clone)


@router.delete("/{timetable_id}")
def delete_timetable(timetable_id: str, user: UserModel = Depends(get_current_user)):
    tt = owned_or_404(timetable_id, user)
    # Cascade: remove student entries and processing jobs first.
    for e in EntryModel.query(timetable_id):
        e.delete()
    for j in JobModel.scan(JobModel.timetable_id == timetable_id):
        j.delete()
    tt.delete()
    return {"ok": True}
