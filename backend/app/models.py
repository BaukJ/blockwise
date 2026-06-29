"""PynamoDB models for Blockwise.

Tables (all prefixed with settings.table_prefix):
  users        — one row per person, email is identity. Stores chosen role view.
  timetables   — one row per teacher timetable + its config/subjects.
  entries      — one row per student in a timetable (their choices + assignment).
  jobs         — one row per processing run (async solve) + its result.
  metadata     — schema version bookkeeping.
"""
from __future__ import annotations

import os
from enum import Enum

from pynamodb.attributes import (
    BooleanAttribute,
    JSONAttribute,
    ListAttribute,
    MapAttribute,
    NumberAttribute,
    UnicodeAttribute,
    UnicodeSetAttribute,
    UTCDateTimeAttribute,
)
from pynamodb.indexes import GlobalSecondaryIndex, AllProjection
from pynamodb.models import Model

from app.config import settings

MODEL_VERSION = 1


def _table(name: str) -> str:
    return f"{settings.table_prefix}-{name}"


class _Meta:
    region = settings.aws_region
    host = settings.dynamodb_host
    if settings.dynamodb_host:
        # Local DynamoDB ignores real credentials but the SDK still needs values.
        os.environ.setdefault("AWS_ACCESS_KEY_ID", "dummy")
        os.environ.setdefault("AWS_SECRET_ACCESS_KEY", "dummy")


class Role(str, Enum):
    TEACHER = "teacher"
    STUDENT = "student"


class LoginMethod(str, Enum):
    PASSWORD = "password"
    GOOGLE = "google"


class JobStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    DONE = "done"
    FAILED = "failed"


class EntryMode(str, Enum):
    CSV = "csv"          # teacher uploaded a CSV
    UI = "ui"            # teacher fills choices in the UI
    STUDENTS = "students"  # students fill their own choices


class UserModel(Model):
    class Meta(_Meta):
        table_name = _table("users")

    email = UnicodeAttribute(hash_key=True)
    password_hash = UnicodeAttribute(null=True)
    login_methods = UnicodeSetAttribute(null=True)  # values from LoginMethod
    # Last chosen view ("teacher"/"student"); drives post-login redirect.
    active_role = UnicodeAttribute(null=True)
    admin = BooleanAttribute(default=False)
    created_at = UTCDateTimeAttribute()


class OwnerIndex(GlobalSecondaryIndex):
    class Meta:
        index_name = "owner-index"
        projection = AllProjection()
        region = settings.aws_region
        host = settings.dynamodb_host

    owner = UnicodeAttribute(hash_key=True)


class TimetableModel(Model):
    class Meta(_Meta):
        table_name = _table("timetables")

    id = UnicodeAttribute(hash_key=True)  # UUID
    owner = UnicodeAttribute()  # teacher email
    owner_index = OwnerIndex()
    name = UnicodeAttribute()
    created_at = UTCDateTimeAttribute()
    deadline = UTCDateTimeAttribute(null=True)
    entry_mode = UnicodeAttribute(default=EntryMode.UI.value)
    num_blocks = NumberAttribute(default=4)
    # Subjects: [{"subject": str, "total_classes": int, "class_capacity": int}, ...]
    subjects = ListAttribute(default=list)
    finalised_job_id = UnicodeAttribute(null=True)
    reassignment_enabled = BooleanAttribute(default=False)


class StudentIndex(GlobalSecondaryIndex):
    class Meta:
        index_name = "student-index"
        projection = AllProjection()
        region = settings.aws_region
        host = settings.dynamodb_host

    student_email = UnicodeAttribute(hash_key=True)


class EntryModel(Model):
    """A student within a timetable. Identified by student_key (email when the
    student self-fills, otherwise a teacher-supplied name)."""

    class Meta(_Meta):
        table_name = _table("entries")

    timetable_id = UnicodeAttribute(hash_key=True)
    student_key = UnicodeAttribute(range_key=True)
    student_email = UnicodeAttribute(null=True)  # set when assigned to a real user
    student_index = StudentIndex()
    name = UnicodeAttribute()
    choices = ListAttribute(default=list)  # [c1, c2, c3, c4]
    backup = UnicodeAttribute(null=True)
    submitted = BooleanAttribute(default=False)
    submitted_at = UTCDateTimeAttribute(null=True)
    # Original choices preserved when reassignment opens them back up.
    initial_choices = ListAttribute(null=True)
    initial_backup = UnicodeAttribute(null=True)
    # Reassignment: per-student block→subject override of the finalised solution,
    # plus a snapshot of the original assignment taken on first swap.
    assignment = JSONAttribute(null=True)
    initial_assignment = JSONAttribute(null=True)


class JobModel(Model):
    class Meta(_Meta):
        table_name = _table("jobs")

    id = UnicodeAttribute(hash_key=True)  # UUID
    timetable_id = UnicodeAttribute()
    created_at = UTCDateTimeAttribute()
    status = UnicodeAttribute(default=JobStatus.PENDING.value)
    blocks_mode = UnicodeAttribute(default="auto")  # auto | custom | previous
    # Snapshot of inputs the worker solves against.
    input = JSONAttribute(null=True)
    result = JSONAttribute(null=True)  # block_classes, student_block_map, backup_users
    error = UnicodeAttribute(null=True)
    time_limit = NumberAttribute(default=120)


class MetadataModel(Model):
    class Meta(_Meta):
        table_name = _table("metadata")

    key = UnicodeAttribute(hash_key=True)
    int_value = NumberAttribute(null=True)
    str_value = UnicodeAttribute(null=True)


ALL_MODELS = [UserModel, TimetableModel, EntryModel, JobModel, MetadataModel]


def create_tables() -> None:
    for model in ALL_MODELS:
        if not model.exists():
            model.create_table(billing_mode="PAY_PER_REQUEST", wait=True)


def delete_tables() -> None:
    for model in ALL_MODELS:
        if model.exists():
            model.delete_table()
