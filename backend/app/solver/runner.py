"""Execute a queued solve job. Called inline (local) or by the worker Lambda."""
from __future__ import annotations

import os

from app.models import JobModel, JobStatus
from app.solver.core import SolverError, solve, solve_fixed_blocks, solve_partial


def run_job(job_id: str) -> None:
    try:
        job = JobModel.get(job_id)
    except JobModel.DoesNotExist:
        print(f"[solver] job {job_id} not found")
        return

    job.update(actions=[JobModel.status.set(JobStatus.RUNNING.value)])
    inp = job.input or {}
    students = inp.get("students", [])
    time_limit = int(job.time_limit or 120)
    threads = os.cpu_count() or 1

    try:
        if job.blocks_mode == "layout":
            # Drag-and-drop layout: classes with an optional pinned block.
            result = solve_partial(
                inp.get("classes", []),
                students,
                int(inp.get("n_blocks", 4)),
                time_limit,
                threads,
            )
        elif job.blocks_mode == "auto":
            subjects = {k: list(v) for k, v in inp.get("subjects", {}).items()}
            result = solve(
                subjects, students, int(inp.get("n_blocks", 4)), time_limit, threads
            )
        else:  # custom | previous — both arrive as a fixed block layout
            blocks = {
                b: {s: list(caps) for s, caps in subjs.items()}
                for b, subjs in inp.get("blocks", {}).items()
            }
            result = solve_fixed_blocks(blocks, students, time_limit, threads)
        job.update(
            actions=[
                JobModel.status.set(JobStatus.DONE.value),
                JobModel.result.set(result),
            ]
        )
    except SolverError as exc:
        job.update(
            actions=[
                JobModel.status.set(JobStatus.FAILED.value),
                JobModel.error.set(str(exc)),
            ]
        )
    except Exception as exc:  # noqa: BLE001
        job.update(
            actions=[
                JobModel.status.set(JobStatus.FAILED.value),
                JobModel.error.set(f"Unexpected error: {exc}"),
            ]
        )
