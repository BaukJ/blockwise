"""Student entries within a timetable: UI rows, CSV import, email roster + progress."""
from __future__ import annotations

import csv
import io
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr

from app.models import EntryMode, EntryModel, TimetableModel, UserModel
from app.security import get_current_user
from app.timetable.routes import owned_or_404

router = APIRouter(prefix="/timetable", tags=["entries"])


# ── Schemas ──────────────────────────────────────────────────────────────────
class EntryIn(BaseModel):
    name: str
    choices: list[str] = []
    backup: str | None = None
    student_email: EmailStr | None = None


class EntryOut(BaseModel):
    student_key: str
    name: str
    student_email: str | None
    choices: list[str]
    backup: str | None
    submitted: bool
    submitted_at: datetime | None


class CsvIn(BaseModel):
    csv_text: str


class EmailsIn(BaseModel):
    emails: list[EmailStr]


class ProgressOut(BaseModel):
    total: int
    submitted: int
    pending: list[str]


def _key(name: str, email: str | None) -> str:
    return (email or name).strip().lower()


def serialize(e: EntryModel) -> EntryOut:
    return EntryOut(
        student_key=e.student_key,
        name=e.name,
        student_email=e.student_email,
        choices=list(e.choices or []),
        backup=e.backup,
        submitted=bool(e.submitted),
        submitted_at=e.submitted_at,
    )


def _list(timetable_id: str) -> list[EntryModel]:
    return list(EntryModel.query(timetable_id))


# ── Endpoints ──────────────────────────────────────────────────────────────────
@router.get("/{timetable_id}/entries", response_model=list[EntryOut])
def list_entries(timetable_id: str, user: UserModel = Depends(get_current_user)):
    owned_or_404(timetable_id, user)
    return [serialize(e) for e in sorted(_list(timetable_id), key=lambda e: e.name.lower())]


@router.post("/{timetable_id}/entries", response_model=EntryOut)
def upsert_entry(
    timetable_id: str, body: EntryIn, user: UserModel = Depends(get_current_user)
):
    owned_or_404(timetable_id, user)
    key = _key(body.name, body.student_email)
    entry = EntryModel(
        timetable_id=timetable_id,
        student_key=key,
        name=body.name.strip(),
        student_email=(body.student_email or None) and body.student_email.lower(),
        choices=[c.strip() for c in body.choices if c.strip()],
        backup=(body.backup or "").strip() or None,
        submitted=False,
    )
    entry.save()
    return serialize(entry)


@router.delete("/{timetable_id}/entries/{student_key}")
def delete_entry(
    timetable_id: str, student_key: str, user: UserModel = Depends(get_current_user)
):
    owned_or_404(timetable_id, user)
    try:
        EntryModel.get(timetable_id, student_key).delete()
    except EntryModel.DoesNotExist:
        raise HTTPException(status_code=404, detail="Entry not found")
    return {"ok": True}


@router.post("/{timetable_id}/entries/csv", response_model=list[EntryOut])
def import_csv(
    timetable_id: str, body: CsvIn, user: UserModel = Depends(get_current_user)
):
    """CSV columns: student_name, choice1..choice4, backup (backup optional)."""
    owned_or_404(timetable_id, user)
    reader = csv.DictReader(io.StringIO(body.csv_text))
    if not reader.fieldnames or "student_name" not in reader.fieldnames:
        raise HTTPException(status_code=400, detail="CSV needs a 'student_name' column")

    created: list[EntryModel] = []
    for row in reader:
        name = (row.get("student_name") or "").strip()
        if not name or name.startswith("#"):
            continue
        choices = [
            (row.get(f"choice{i}") or "").strip()
            for i in range(1, 5)
            if (row.get(f"choice{i}") or "").strip()
        ]
        backup = (row.get("backup") or "").strip() or None
        entry = EntryModel(
            timetable_id=timetable_id,
            student_key=_key(name, None),
            name=name,
            choices=choices,
            backup=backup,
            submitted=bool(choices),  # CSV rows arrive already filled in
            submitted_at=datetime.now(timezone.utc) if choices else None,
        )
        entry.save()
        created.append(entry)
    return [serialize(e) for e in created]


@router.post("/{timetable_id}/entries/emails", response_model=list[EntryOut])
def add_emails(
    timetable_id: str, body: EmailsIn, user: UserModel = Depends(get_current_user)
):
    """Seed pending entries for students to fill out themselves."""
    tt = owned_or_404(timetable_id, user)
    if tt.entry_mode != EntryMode.STUDENTS.value:
        tt.update(actions=[TimetableModel.entry_mode.set(EntryMode.STUDENTS.value)])

    created: list[EntryModel] = []
    for email in body.emails:
        addr = str(email).lower()
        try:
            existing = EntryModel.get(timetable_id, addr)
            created.append(existing)
            continue
        except EntryModel.DoesNotExist:
            pass
        entry = EntryModel(
            timetable_id=timetable_id,
            student_key=addr,
            name=addr,
            student_email=addr,
            choices=[],
            submitted=False,
        )
        entry.save()
        created.append(entry)
    return [serialize(e) for e in created]


@router.post("/{timetable_id}/subjects/csv")
def import_subjects_csv(
    timetable_id: str, body: CsvIn, user: UserModel = Depends(get_current_user)
):
    """CSV columns: subject, total_classes, class_capacity. Repeat a subject row
    for differently-sized parallel classes — they're merged into one entry whose
    total_classes counts the rows."""
    tt = owned_or_404(timetable_id, user)
    reader = csv.DictReader(io.StringIO(body.csv_text))
    if not reader.fieldnames or "subject" not in reader.fieldnames:
        raise HTTPException(status_code=400, detail="CSV needs a 'subject' column")
    subjects: list[dict] = []
    for row in reader:
        name = (row.get("subject") or "").strip()
        if not name or name.startswith("#"):
            continue
        subjects.append(
            {
                "subject": name,
                "total_classes": int(row.get("total_classes") or 1),
                "class_capacity": int(row.get("class_capacity") or 30),
            }
        )
    tt.update(actions=[TimetableModel.subjects.set(subjects)])
    return {"ok": True, "subjects": subjects}


@router.get("/{timetable_id}/progress", response_model=ProgressOut)
def progress(timetable_id: str, user: UserModel = Depends(get_current_user)):
    owned_or_404(timetable_id, user)
    entries = _list(timetable_id)
    submitted = [e for e in entries if e.submitted]
    pending = [e.name for e in entries if not e.submitted]
    return ProgressOut(total=len(entries), submitted=len(submitted), pending=sorted(pending))
