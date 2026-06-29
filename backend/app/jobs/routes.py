"""Processing jobs: kick off a solve, poll status, review + finalise solutions."""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel

from app.config import settings
from app.models import (
    EntryModel,
    JobModel,
    JobStatus,
    TimetableModel,
    UserModel,
    entry_ready,
)
from app.security import get_current_user
from app.solver import run_job
from app.timetable.routes import owned_or_404

router = APIRouter(tags=["jobs"])


class CustomBlockRow(BaseModel):
    block: str
    subject: str
    capacity: int


class ProcessIn(BaseModel):
    blocks_mode: str = "auto"  # auto | custom | previous
    time_limit: int = 120
    custom_blocks: list[CustomBlockRow] | None = None
    previous_job_id: str | None = None


class JobOut(BaseModel):
    id: str
    timetable_id: str
    created_at: datetime
    status: str
    blocks_mode: str
    error: str | None
    result: dict | None


def serialize(j: JobModel) -> JobOut:
    return JobOut(
        id=j.id,
        timetable_id=j.timetable_id,
        created_at=j.created_at,
        status=j.status,
        blocks_mode=j.blocks_mode,
        error=j.error,
        result=j.result,
    )


def _subjects_dict(tt: TimetableModel) -> dict[str, list[int]]:
    """tt.subjects rows → {subject: [capacity per class]}."""
    out: dict[str, list[int]] = {}
    for row in tt.subjects or []:
        out.setdefault(row["subject"], []).extend(
            [int(row["class_capacity"])] * int(row["total_classes"])
        )
    return out


def _students(timetable_id: str) -> list[dict]:
    students = []
    for e in EntryModel.query(timetable_id):
        if not entry_ready(e.status):
            continue
        students.append(
            {"name": e.name, "choices": list(e.choices or []), "backup": e.backup}
        )
    return students


def _blocks_from_custom(rows: list[CustomBlockRow]) -> dict:
    blocks: dict[str, dict[str, list[int]]] = {}
    for r in rows:
        blocks.setdefault(r.block, {}).setdefault(r.subject, []).append(int(r.capacity))
    return blocks


def _trigger(job_id: str, background: BackgroundTasks) -> None:
    """Invoke the worker Lambda async, or run inline when running locally."""
    if settings.solver_function_name:
        import boto3

        boto3.client("lambda", region_name=settings.aws_region).invoke(
            FunctionName=settings.solver_function_name,
            InvocationType="Event",
            Payload=json.dumps({"job_id": job_id}).encode(),
        )
    else:
        background.add_task(run_job, job_id)


@router.post("/timetable/{timetable_id}/process", response_model=JobOut)
def process(
    timetable_id: str,
    body: ProcessIn,
    background: BackgroundTasks,
    user: UserModel = Depends(get_current_user),
):
    tt = owned_or_404(timetable_id, user)
    students = _students(timetable_id)
    if not students:
        raise HTTPException(status_code=400, detail="No submitted student choices yet")

    inp: dict = {"students": students, "time_limit": body.time_limit}
    if body.blocks_mode == "auto":
        inp["n_blocks"] = int(tt.num_blocks)
        inp["subjects"] = _subjects_dict(tt)
    elif body.blocks_mode == "custom":
        if not body.custom_blocks:
            raise HTTPException(status_code=400, detail="custom_blocks required")
        inp["blocks"] = _blocks_from_custom(body.custom_blocks)
    elif body.blocks_mode == "previous":
        if not body.previous_job_id:
            raise HTTPException(status_code=400, detail="previous_job_id required")
        try:
            prev = JobModel.get(body.previous_job_id)
        except JobModel.DoesNotExist:
            raise HTTPException(status_code=404, detail="Previous job not found")
        if not prev.result:
            raise HTTPException(status_code=400, detail="Previous job has no solution")
        inp["blocks"] = prev.result["block_classes"]
    else:
        raise HTTPException(status_code=400, detail="Invalid blocks_mode")

    job = JobModel(
        id=str(uuid.uuid4()),
        timetable_id=timetable_id,
        created_at=datetime.now(timezone.utc),
        status=JobStatus.PENDING.value,
        blocks_mode=body.blocks_mode,
        input=inp,
        time_limit=body.time_limit,
    )
    job.save()
    _trigger(job.id, background)
    return serialize(job)


@router.get("/timetable/{timetable_id}/jobs", response_model=list[JobOut])
def list_jobs(timetable_id: str, user: UserModel = Depends(get_current_user)):
    owned_or_404(timetable_id, user)
    jobs = JobModel.scan(JobModel.timetable_id == timetable_id)
    return sorted(
        (serialize(j) for j in jobs), key=lambda j: j.created_at, reverse=True
    )


@router.get("/jobs/{job_id}", response_model=JobOut)
def get_job(job_id: str, user: UserModel = Depends(get_current_user)):
    try:
        job = JobModel.get(job_id)
    except JobModel.DoesNotExist:
        raise HTTPException(status_code=404, detail="Job not found")
    owned_or_404(job.timetable_id, user)
    return serialize(job)


class FinaliseIn(BaseModel):
    job_id: str


@router.post("/timetable/{timetable_id}/finalise", response_model=JobOut)
def finalise(
    timetable_id: str,
    body: FinaliseIn,
    user: UserModel = Depends(get_current_user),
):
    owned_or_404(timetable_id, user)
    try:
        job = JobModel.get(body.job_id)
    except JobModel.DoesNotExist:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.timetable_id != timetable_id or job.status != JobStatus.DONE.value:
        raise HTTPException(status_code=400, detail="Job is not a completed solution")
    TimetableModel.get(timetable_id).update(
        actions=[TimetableModel.finalised_job_id.set(body.job_id)]
    )
    return serialize(job)
