"""Worker Lambda: solves one job. Invoked async with {"job_id": "..."}."""
from app.solver import run_job


def lambda_handler(event, _context):
    job_id = event.get("job_id")
    if not job_id:
        return {"ok": False, "error": "missing job_id"}
    run_job(job_id)
    return {"ok": True, "job_id": job_id}
