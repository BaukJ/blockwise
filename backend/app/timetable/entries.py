"""Student entries within a timetable: UI rows, CSV import, email roster + progress."""
from __future__ import annotations

import csv
import io
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr

from app.models import (
    EntryMode,
    EntryModel,
    EntryStatus,
    TimetableModel,
    UserModel,
    entry_ready,
    status_for_choices,
)
from app.rules import rules_error
from app.security import get_current_user
from app.timetable.routes import owned_or_404

router = APIRouter(prefix="/timetable", tags=["entries"])


# ── Schemas ──────────────────────────────────────────────────────────────────
class EntryIn(BaseModel):
    name: str
    choices: list[str] = []
    backups: list[str] = []
    student_email: EmailStr | None = None


class ChoicesIn(BaseModel):
    choices: list[str] = []
    backups: list[str] = []


class EntryOut(BaseModel):
    student_key: str
    name: str
    student_email: str | None
    choices: list[str]
    backups: list[str]
    status: str
    submitted: bool  # derived: ready for processing
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
        backups=list(e.backups or []),
        status=e.status,
        submitted=entry_ready(e.status),
        submitted_at=e.submitted_at,
    )


def _clean(items: list[str]) -> list[str]:
    return [s.strip() for s in (items or []) if s and s.strip()]


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
    tt = owned_or_404(timetable_id, user)
    key = _key(body.name, body.student_email)
    choices = _clean(body.choices)
    required = int(tt.options_required)
    if len(choices) >= required:
        violation = rules_error(list(tt.rules or []), choices)
        if violation:
            raise HTTPException(status_code=400, detail=violation)
    entry = EntryModel(
        timetable_id=timetable_id,
        student_key=key,
        name=body.name.strip(),
        student_email=(body.student_email or None) and body.student_email.lower(),
        choices=choices,
        backups=_clean(body.backups),
        status=status_for_choices(choices, teacher=True, required=required),
        submitted_at=datetime.now(timezone.utc) if len(choices) >= required else None,
    )
    entry.save()
    return serialize(entry)


@router.patch("/{timetable_id}/entries/{student_key}", response_model=EntryOut)
def edit_choices(
    timetable_id: str,
    student_key: str,
    body: ChoicesIn,
    user: UserModel = Depends(get_current_user),
):
    """Teacher edits a student's choices. Complete → teacher_submitted, else draft."""
    tt = owned_or_404(timetable_id, user)
    try:
        entry = EntryModel.get(timetable_id, student_key)
    except EntryModel.DoesNotExist:
        raise HTTPException(status_code=404, detail="Entry not found")
    choices = _clean(body.choices)
    backups = _clean(body.backups)
    if len(set(choices + backups)) != len(choices + backups):
        raise HTTPException(status_code=400, detail="Choices and backups must be distinct")
    required = int(tt.options_required)
    # Enforce choice rules once the set is complete (drafts are exempt).
    if len(choices) >= required:
        violation = rules_error(list(tt.rules or []), choices)
        if violation:
            raise HTTPException(status_code=400, detail=violation)
    entry.update(
        actions=[
            EntryModel.choices.set(choices),
            EntryModel.backups.set(backups),
            EntryModel.status.set(status_for_choices(choices, teacher=True, required=required)),
            EntryModel.submitted_at.set(
                datetime.now(timezone.utc) if len(choices) >= required else None
            ),
        ]
    )
    return serialize(entry)


@router.post("/{timetable_id}/entries/{student_key}/revert", response_model=EntryOut)
def revert_to_draft(
    timetable_id: str, student_key: str, user: UserModel = Depends(get_current_user)
):
    """Reopen an entry for editing (by the teacher or, for roster entries, the student)."""
    owned_or_404(timetable_id, user)
    try:
        entry = EntryModel.get(timetable_id, student_key)
    except EntryModel.DoesNotExist:
        raise HTTPException(status_code=404, detail="Entry not found")
    entry.update(
        actions=[
            EntryModel.status.set(EntryStatus.DRAFT.value),
            EntryModel.submitted_at.set(None),
        ]
    )
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
    """CSV columns: student_name, choice1..choiceN, backup1..backupM (or a single
    'backup' column). Extra/blank columns are ignored."""
    tt = owned_or_404(timetable_id, user)
    reader = csv.DictReader(io.StringIO(body.csv_text))
    fields = reader.fieldnames or []
    if "student_name" not in fields:
        raise HTTPException(status_code=400, detail="CSV needs a 'student_name' column")
    choice_cols = sorted(
        (c for c in fields if c and c.startswith("choice")),
        key=lambda c: int(c[6:] or 0) if c[6:].isdigit() else 0,
    )
    backup_cols = sorted(
        (c for c in fields if c and c.startswith("backup")),
        key=lambda c: int(c[6:] or 0) if c[6:].isdigit() else 0,
    )
    required = int(tt.options_required)

    created: list[EntryModel] = []
    for row in reader:
        name = (row.get("student_name") or "").strip()
        if not name or name.startswith("#"):
            continue
        choices = _clean([row.get(c) or "" for c in choice_cols])
        backups = _clean([row.get(c) or "" for c in backup_cols])
        entry = EntryModel(
            timetable_id=timetable_id,
            student_key=_key(name, None),
            name=name,
            choices=choices,
            backups=backups,
            # Teacher-imported: complete → teacher_submitted, partial → draft.
            status=status_for_choices(choices, teacher=True, required=required),
            submitted_at=datetime.now(timezone.utc) if len(choices) >= required else None,
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
            status=EntryStatus.PENDING.value,
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
    ready = [e for e in entries if entry_ready(e.status)]
    pending = [e.name for e in entries if not entry_ready(e.status)]
    return ProgressOut(total=len(entries), submitted=len(ready), pending=sorted(pending))
