#!/usr/bin/env -S uv run
# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "pyyaml>=6.0",
# ]
# ///
"""
Convert timetable.yaml + students.csv → per-student CSV.

Columns: student_name, choice1, choice1_block, choice2, choice2_block,
         choice3, choice3_block, choice4, choice4_block, backup, backup_block

N/A appears in the pair for whichever option was not taken:
  - backup not used  → backup / backup_block = N/A
  - backup used      → the replaced choice's pair = N/A, backup pair filled

Usage:
    uv run student_timetable.py
    uv run student_timetable.py students.csv timetable.yaml --out student_timetable.csv
"""
from __future__ import annotations

import argparse
import csv
import sys

import yaml
def load_students(path: str) -> list[dict]:
    students = []
    with open(path, newline="") as fh:
        for row in csv.DictReader(fh):
            students.append({
                "name": row["student_name"].strip(),
                "choices": [row[f"choice{i}"].strip() for i in range(1, 5)],
                "backup": row["backup"].strip(),
            })
    return students


def build_assignment_map(yaml_path: str) -> dict[str, dict[str, str]]:
    """Return {student_name: {subject: block}} from the timetable YAML."""
    with open(yaml_path) as fh:
        data = yaml.safe_load(fh)

    result: dict[str, dict[str, str]] = {}
    for block_key, subjects in (data or {}).items():
        block = block_key.replace("Block_", "")
        for subject, classes in (subjects or {}).items():
            for cls in (classes or []):
                for student in (cls or []):
                    result.setdefault(student, {})[subject] = block
    return result


def export_student_timetable(students_csv: str, timetable_yaml: str, out: str) -> int:
    """Write the per-student timetable CSV; return the number of students."""
    students = load_students(students_csv)
    assignment_map = build_assignment_map(timetable_yaml)

    headers = ["student_name"]
    for i in range(1, 5):
        headers += [f"choice{i}", f"choice{i}_block"]
    headers += ["backup", "backup_block"]

    missing: list[str] = []
    rows = []
    for stu in students:
        name = stu["name"]
        if name not in assignment_map:
            missing.append(name)
            rows.append([name] + ["N/A"] * 10)
            continue

        # Build a consumable map of subject → block for this student.
        # We pop entries in choice order so duplicates (backup == a choice)
        # are consumed by the earlier slot, leaving N/A for the later one.
        available: dict[str, str] = dict(assignment_map[name])

        row = [name]
        for subj in stu["choices"] + [stu["backup"]]:
            if subj in available:
                row += [subj, available.pop(subj)]
            else:
                row += ["N/A", "N/A"]
        rows.append(row)
    if missing:
        for m in missing:
            print(f"WARNING: '{m}' not found in YAML — all N/A", file=sys.stderr)

    with open(out, "w", newline="") as fh:
        writer = csv.writer(fh)
        writer.writerow(headers)
        writer.writerows(rows)

    return len(rows)


def main() -> None:
    parser = argparse.ArgumentParser(description="Export per-student timetable to CSV")
    parser.add_argument("students_csv", nargs="?", default="students.csv")
    parser.add_argument("timetable_yaml", nargs="?", default="timetable.yaml")
    parser.add_argument("--out", default="student_timetable.csv", metavar="PATH")
    args = parser.parse_args()

    n = export_student_timetable(args.students_csv, args.timetable_yaml, args.out)
    print(f"Wrote {args.out} ({n} students)")


if __name__ == "__main__":
    main()

