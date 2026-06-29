"""Student-facing endpoints: assigned timetables, submitting choices, reassignment."""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.models import (
    EntryModel,
    EntryStatus,
    JobModel,
    TimetableModel,
    UserModel,
    entry_ready,
)
from app.security import get_current_user

router = APIRouter(prefix="/student", tags=["student"])


# ── Schemas ──────────────────────────────────────────────────────────────────
class AssignedOut(BaseModel):
    timetable_id: str
    name: str
    deadline: datetime | None
    submitted: bool
    finalised: bool
    reassignment_enabled: bool


class SubmitIn(BaseModel):
    choices: list[str]
    backup: str | None = None


class ReassignIn(BaseModel):
    block: str
    subject: str


class StudentTimetableOut(BaseModel):
    timetable_id: str
    name: str
    deadline: datetime | None
    subjects: list[dict]
    num_blocks: int
    my_choices: list[str]
    my_backup: str | None
    submitted: bool
    finalised: bool
    reassignment_enabled: bool
    # Present only once finalised:
    my_assignment: dict | None  # {block: subject}
    available_swaps: dict | None  # {block: [{"subject": s, "free": n}]}
    initial_assignment: dict | None


# ── Helpers ──────────────────────────────────────────────────────────────────
def _my_entry(timetable_id: str, email: str) -> EntryModel:
    try:
        entry = EntryModel.get(timetable_id, email)
    except EntryModel.DoesNotExist:
        raise HTTPException(status_code=404, detail="You are not on this timetable")
    if entry.student_email != email:
        raise HTTPException(status_code=403, detail="Not your entry")
    return entry


def _finalised_job(tt: TimetableModel) -> JobModel | None:
    if not tt.finalised_job_id:
        return None
    try:
        job = JobModel.get(tt.finalised_job_id)
    except JobModel.DoesNotExist:
        return None
    return job if job.result else None


def _effective_assignments(timetable_id: str, base: dict) -> dict[str, dict]:
    """Base solution map overlaid with any per-student reassignment overrides."""
    effective = {name: dict(amap) for name, amap in base.items()}
    for e in EntryModel.query(timetable_id):
        if e.assignment:
            effective[e.name] = dict(e.assignment)
    return effective


def _free_spaces(result: dict, effective: dict[str, dict]) -> dict[str, dict[str, int]]:
    """capacity - occupancy per (block, subject)."""
    block_classes = result["block_classes"]
    free: dict[str, dict[str, int]] = {}
    for b, subjs in block_classes.items():
        free[b] = {s: sum(caps) for s, caps in subjs.items()}
    for amap in effective.values():
        for b, s in amap.items():
            if b in free and s in free[b]:
                free[b][s] -= 1
    return free


# ── Endpoints ──────────────────────────────────────────────────────────────────
@router.get("/timetables", response_model=list[AssignedOut])
def my_timetables(user: UserModel = Depends(get_current_user)):
    out: list[AssignedOut] = []
    for e in EntryModel.student_index.query(user.email):
        try:
            tt = TimetableModel.get(e.timetable_id)
        except TimetableModel.DoesNotExist:
            continue
        out.append(
            AssignedOut(
                timetable_id=tt.id,
                name=tt.name,
                deadline=tt.deadline,
                submitted=entry_ready(e.status),
                finalised=bool(tt.finalised_job_id),
                reassignment_enabled=bool(tt.reassignment_enabled),
            )
        )
    return sorted(out, key=lambda a: (a.submitted, a.name.lower()))


@router.get("/timetable/{timetable_id}", response_model=StudentTimetableOut)
def get_one(timetable_id: str, user: UserModel = Depends(get_current_user)):
    entry = _my_entry(timetable_id, user.email)
    tt = TimetableModel.get(timetable_id)
    job = _finalised_job(tt)

    my_assignment = available_swaps = initial_assignment = None
    if job:
        result = job.result
        effective = _effective_assignments(timetable_id, result["student_block_map"])
        my_assignment = effective.get(entry.name, {})
        initial_assignment = entry.initial_assignment or result["student_block_map"].get(
            entry.name, {}
        )
        if tt.reassignment_enabled:
            free = _free_spaces(result, effective)
            available_swaps = {}
            for b, current in my_assignment.items():
                opts = [
                    {"subject": s, "free": n}
                    for s, n in free.get(b, {}).items()
                    if n > 0 and s != current
                ]
                if opts:
                    available_swaps[b] = opts

    return StudentTimetableOut(
        timetable_id=tt.id,
        name=tt.name,
        deadline=tt.deadline,
        subjects=list(tt.subjects or []),
        num_blocks=int(tt.num_blocks),
        my_choices=list(entry.choices or []),
        my_backup=entry.backup,
        submitted=entry_ready(entry.status),
        finalised=bool(job),
        reassignment_enabled=bool(tt.reassignment_enabled),
        my_assignment=my_assignment,
        available_swaps=available_swaps,
        initial_assignment=initial_assignment,
    )


@router.post("/timetable/{timetable_id}/submit", response_model=StudentTimetableOut)
def submit(
    timetable_id: str, body: SubmitIn, user: UserModel = Depends(get_current_user)
):
    entry = _my_entry(timetable_id, user.email)
    if entry_ready(entry.status):
        raise HTTPException(status_code=409, detail="Choices already submitted")
    choices = [c.strip() for c in body.choices if c.strip()]
    if len(choices) != 4:
        raise HTTPException(status_code=400, detail="Please rank four choices")
    if len(choices) != len(set(choices)):
        raise HTTPException(status_code=400, detail="Choices must be distinct")
    entry.update(
        actions=[
            EntryModel.choices.set(choices),
            EntryModel.backup.set((body.backup or "").strip() or None),
            EntryModel.status.set(EntryStatus.SUBMITTED.value),
            EntryModel.submitted_at.set(datetime.now(timezone.utc)),
        ]
    )
    return get_one(timetable_id, user)


@router.post("/timetable/{timetable_id}/reassign", response_model=StudentTimetableOut)
def reassign(
    timetable_id: str, body: ReassignIn, user: UserModel = Depends(get_current_user)
):
    entry = _my_entry(timetable_id, user.email)
    tt = TimetableModel.get(timetable_id)
    if not tt.reassignment_enabled:
        raise HTTPException(status_code=403, detail="Reassignment is not open")
    job = _finalised_job(tt)
    if not job:
        raise HTTPException(status_code=400, detail="No finalised solution")

    result = job.result
    effective = _effective_assignments(timetable_id, result["student_block_map"])
    mine = effective.get(entry.name)
    if not mine or body.block not in mine:
        raise HTTPException(status_code=400, detail="You have no class in that block")
    if body.subject not in result["block_classes"].get(body.block, {}):
        raise HTTPException(status_code=400, detail="Subject not offered in that block")

    free = _free_spaces(result, effective)
    if free.get(body.block, {}).get(body.subject, 0) <= 0:
        raise HTTPException(status_code=409, detail="That class is full")

    # Snapshot the original assignment once, before the first swap.
    initial = entry.initial_assignment or result["student_block_map"].get(entry.name, {})
    new_assignment = dict(mine)
    new_assignment[body.block] = body.subject
    entry.update(
        actions=[
            EntryModel.initial_assignment.set(initial),
            EntryModel.assignment.set(new_assignment),
        ]
    )
    return get_one(timetable_id, user)
