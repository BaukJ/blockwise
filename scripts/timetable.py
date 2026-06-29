#!/usr/bin/env -S uv run
# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "pulp>=2.7",
#   "highspy>=1.5",
#   "pyyaml>=6.0",
# ]
# ///
"""
Timetable block grouping optimiser — command-line interface.

This is the original CLI, refactored to call the SHARED solver that the web app
uses (``backend/app/solver/core.py``). The CLI owns only the file IO, CSV/YAML
formats and reporting; the actual ILP lives in one place.

Two modes:

1. Auto mode (default): given subjects.csv + students.csv, decide which subjects go
   in which block AND assign students. First two choices always honoured; backup use
   minimised.
2. Fixed-blocks mode (--blocks-csv blocks.csv): the block layout is given. Only the
   student assignment is solved.

subjects.csv columns : subject, total_classes, class_capacity
students.csv columns : student_name, choice1, choice2, choice3, choice4, backup
blocks.csv   columns : block, subject, child_limit

Usage:
    uv run scripts/timetable.py
    uv run scripts/timetable.py subjects.csv students.csv
    uv run scripts/timetable.py students.csv --blocks-csv blocks.csv
    uv run scripts/timetable.py --time-limit 600 --threads 8 --duplicate-backup=any
"""
from __future__ import annotations

import argparse
import csv
import os
import shutil
import sys
import time
from collections import defaultdict
from datetime import datetime
from pathlib import Path

import yaml

# Import the shared solver directly from its file so we only pull in pulp — not the
# FastAPI app package (app/__init__.py and friends).
_SOLVER_DIR = Path(__file__).resolve().parent.parent / "backend" / "app" / "solver"
sys.path.insert(0, str(_SOLVER_DIR))
import core  # noqa: E402  (shared solver: solve, solve_fixed_blocks, SolverError)


# ── Input loading ─────────────────────────────────────────────────────────────
def load_subjects(path: str) -> dict[str, list[int]]:
    subjects: dict[str, list[int]] = {}
    with open(path, newline="") as fh:
        for row in csv.DictReader(fh):
            if row["subject"].startswith("#"):
                continue
            name = row["subject"].strip()
            n = int(row["total_classes"])
            cap = int(row["class_capacity"])
            subjects.setdefault(name, []).extend([cap] * n)
    return subjects


def load_students(path: str) -> list[dict]:
    students: list[dict] = []
    with open(path, newline="") as fh:
        for row in csv.DictReader(fh):
            backup = row["backup"].strip()
            students.append(
                {
                    "name": row["student_name"].strip(),
                    "choices": [row[f"choice{i}"].strip() for i in range(1, 5)],
                    "backup": backup or None,
                }
            )
    return students


def load_blocks(path: str) -> dict[str, dict[str, list[int]]]:
    blocks: dict[str, dict[str, list[int]]] = {}
    with open(path, newline="") as fh:
        for row in csv.DictReader(fh):
            block = row["block"].strip()
            subject = row["subject"].strip()
            limit = int(row["child_limit"])
            blocks.setdefault(block, {}).setdefault(subject, []).append(limit)
    return blocks


# ── Duplicate-backup policy (CLI-only preprocessing) ────────────────────────────
def apply_duplicate_backup(students: list[dict], policy: str) -> None:
    """Mirror the original CLI behaviour for a backup that repeats a choice:
      error  : refuse to solve
      ignore : leave it (the model's no-duplicate rule makes it effectively unused)
      any    : replace it with the any-subject wildcard (backup=None)
    Mutates students in place; exits on `error`.
    """
    errors: list[str] = []
    for stu in students:
        backup = stu["backup"]
        if backup and backup in stu["choices"]:
            msg = f"Student '{stu['name']}': backup '{backup}' duplicates a chosen subject"
            if policy == "ignore":
                print(f"WARNING: {msg} — backup will be effectively unused", file=sys.stderr)
            elif policy == "any":
                print(f"WARNING: {msg} — backup replaced with any-subject wildcard",
                      file=sys.stderr)
                stu["backup"] = None
            else:
                errors.append(msg)
    if errors:
        for e in errors:
            print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)


# ── Output writers ──────────────────────────────────────────────────────────────
def _block_key(name: str) -> str:
    return name if name.startswith("Block_") else f"Block_{name}"


def write_csv(result: dict, out_path: str) -> None:
    block_names = result["block_names"]
    block_classes = result["block_classes"]
    columns: dict[str, list[str]] = {}
    for b in block_names:
        col: list[str] = []
        for subj, caps in block_classes.get(b, {}).items():
            col.extend([subj] * len(caps))
        columns[b] = col
    max_rows = max((len(v) for v in columns.values()), default=0)
    with open(out_path, "w", newline="") as fh:
        writer = csv.writer(fh)
        writer.writerow([_block_key(b) for b in block_names])
        for i in range(max_rows):
            writer.writerow(
                [columns[b][i] if i < len(columns[b]) else "" for b in block_names]
            )


def write_blocks_csv(result: dict, out_path: str) -> None:
    block_names = result["block_names"]
    block_classes = result["block_classes"]
    with open(out_path, "w", newline="") as fh:
        writer = csv.writer(fh)
        writer.writerow(["block", "subject", "child_limit"])
        for b in block_names:
            for subj, caps in block_classes.get(b, {}).items():
                for cap in caps:
                    writer.writerow([_block_key(b), subj, cap])


def write_yaml(result: dict, out_path: str) -> None:
    block_classes = result["block_classes"]
    student_block_map = result["student_block_map"]
    block_names = result["block_names"]
    rosters: dict[str, dict[str, list[str]]] = defaultdict(lambda: defaultdict(list))
    for student_name, block_map in student_block_map.items():
        for b, subj in block_map.items():
            rosters[b][subj].append(student_name)
    output: dict = {}
    for b in block_names:
        block_key = _block_key(b)
        output[block_key] = {}
        for subj, caps in block_classes.get(b, {}).items():
            roster = sorted(rosters[b].get(subj, []))
            classes: list[list[str]] = []
            idx = 0
            for cap in caps:
                classes.append(roster[idx : idx + cap])
                idx += cap
            if idx < len(roster):
                classes[-1].extend(roster[idx:])
            output[block_key][subj] = classes
    with open(out_path, "w") as fh:
        yaml.dump(output, fh, default_flow_style=False, allow_unicode=True, sort_keys=False)


def write_student_timetable(result: dict, students: list[dict], out_path: str) -> int:
    """Per-student CSV: each choice + backup and which block it landed in."""
    student_block_map = result["student_block_map"]
    headers = ["student_name"]
    for i in range(1, 5):
        headers += [f"choice{i}", f"choice{i}_block"]
    headers += ["backup", "backup_block"]

    rows = []
    for stu in students:
        name = stu["name"]
        # {subject: block} for this student; consumed in choice order so a backup
        # that repeats a choice leaves N/A for the later slot.
        available = {subj: b for b, subj in student_block_map.get(name, {}).items()}
        row = [name]
        for subj in stu["choices"] + [stu["backup"] or ""]:
            if subj and subj in available:
                row += [subj, available.pop(subj)]
            else:
                row += ["N/A", "N/A"]
        rows.append(row)
    with open(out_path, "w", newline="") as fh:
        writer = csv.writer(fh)
        writer.writerow(headers)
        writer.writerows(rows)
    return len(rows)


# ── Main ──────────────────────────────────────────────────────────────────────
def main() -> None:
    parser = argparse.ArgumentParser(
        description="Timetable block grouping optimiser (CLI over the shared solver)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("subjects_csv", nargs="?", default=None,
                        help="CSV: subject, total_classes, class_capacity (default subjects.csv)")
    parser.add_argument("students_csv", nargs="?", default=None,
                        help="CSV: student_name, choice1..choice4, backup (default students.csv)")
    parser.add_argument("--blocks-csv", default=None, metavar="PATH",
                        help="Fixed block layout CSV: block, subject, child_limit")
    parser.add_argument("--out-csv", default="timetable.csv", metavar="PATH")
    parser.add_argument("--out-yaml", default="timetable.yaml", metavar="PATH")
    parser.add_argument("--output-dir", default=None, metavar="DIR",
                        help="Write all outputs into this directory (created if needed)")
    parser.add_argument("--num-blocks", type=int, default=4, metavar="N",
                        help="Number of blocks in auto mode (2-5, default 4)")
    parser.add_argument("--time-limit", type=int, default=300, metavar="SECONDS")
    parser.add_argument("--threads", type=int, default=os.cpu_count() or 1, metavar="N")
    parser.add_argument("--duplicate-backup", choices=["error", "ignore", "any"],
                        default="error",
                        help="What to do when a student's backup duplicates a choice")
    parser.add_argument("--quiet", action="store_true",
                        help="Suppress the HiGHS solver progress log")
    args = parser.parse_args()

    if args.output_dir is not None:
        os.makedirs(args.output_dir, exist_ok=True)
        args.out_csv = os.path.join(args.output_dir, "timetable.csv")
        args.out_yaml = os.path.join(args.output_dir, "timetable.yml")

    fixed_mode = args.blocks_csv is not None

    # In fixed mode a single positional is the students file.
    if fixed_mode and args.subjects_csv is not None and args.students_csv is None:
        args.students_csv = args.subjects_csv
        args.subjects_csv = None
    if args.subjects_csv is None:
        args.subjects_csv = "subjects.csv"
    if args.students_csv is None:
        args.students_csv = "students.csv"

    subjects: dict | None = None
    if not fixed_mode or os.path.exists(args.subjects_csv):
        print(f"Loading {args.subjects_csv} …")
        subjects = load_subjects(args.subjects_csv)

    print(f"Loading {args.students_csv} …")
    students = load_students(args.students_csv)
    apply_duplicate_backup(students, args.duplicate_backup)

    if fixed_mode:
        print(f"Loading {args.blocks_csv} …")
        blocks = load_blocks(args.blocks_csv)
        n_classes = sum(len(caps) for subjs in blocks.values() for caps in subjs.values())
        n_subjects = len({s for subjs in blocks.values() for s in subjs})
        print(f"  {len(blocks)} blocks, {n_subjects} subjects, "
              f"{n_classes} classes, {len(students)} students")
    else:
        assert subjects is not None
        print(f"  {len(subjects)} subjects, {len(students)} students")

    mode_label = "fixed-blocks" if fixed_mode else "auto"
    print(f"\nSolving ({mode_label} mode, {args.threads} thread(s), "
          f"time limit {args.time_limit}s) …\n")

    # The shared solver takes an ordered preference list (choices then backup) plus
    # the count of leading "real" choices.
    for stu in students:
        stu["options"] = stu["choices"] + ([stu["backup"]] if stu.get("backup") else [])
        stu["n_choices"] = len(stu["choices"])

    solve_start = time.perf_counter()
    try:
        if fixed_mode:
            result = core.solve_fixed_blocks(
                blocks, students, time_limit=args.time_limit, threads=args.threads,
                verbose=not args.quiet,
            )
        else:
            result = core.solve(
                subjects, students, n_blocks=args.num_blocks,
                time_limit=args.time_limit, threads=args.threads,
                verbose=not args.quiet,
            )
    except core.SolverError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
    solve_elapsed = time.perf_counter() - solve_start

    # ── Summary ────────────────────────────────────────────────────────────────
    summary: list[str] = ["=" * 60, "BLOCK LAYOUT", "=" * 60]
    for b in result["block_names"]:
        subjs = result["block_classes"].get(b, {})
        parts = [f"{s} ×{len(caps)}" if len(caps) > 1 else s for s, caps in subjs.items()]
        summary.append(f"  {_block_key(b)}: {', '.join(parts) or '(empty)'}")

    backup_users = result["backup_users"]
    real_backup = [e for e in backup_users if not e.get("is_wildcard")]
    wildcard = [e for e in backup_users if e.get("is_wildcard")]
    summary += ["", "=" * 60, f"BACKUP USAGE: {len(backup_users)} student(s)", "=" * 60]
    if backup_users:
        summary.append(f"\n  Got their backup ({len(real_backup)}):")
        summary += [f"    {e['name']}: dropped '{e['dropped']}' → using backup '{e['backup']}'"
                    for e in real_backup] or ["    (none)"]
        summary.append(f"\n  Got a wildcard — no usable backup ({len(wildcard)}):")
        summary += [f"    {e['name']}: dropped '{e['dropped']}' → assigned wildcard '{e['backup']}'"
                    for e in wildcard] or ["    (none)"]
    else:
        summary.append("  All students received their top choices.")

    print("\n" + "\n".join(summary) + "\n")

    write_csv(result, args.out_csv)
    print(f"Wrote {args.out_csv}")
    write_yaml(result, args.out_yaml)
    print(f"Wrote {args.out_yaml}")

    if args.output_dir is not None:
        blocks_path = os.path.join(args.output_dir, "blocks.csv")
        write_blocks_csv(result, blocks_path)
        print(f"Wrote {blocks_path}")

        student_tt_path = os.path.join(args.output_dir, "student_timetable.csv")
        n = write_student_timetable(result, students, student_tt_path)
        print(f"Wrote {student_tt_path} ({n} students)")

        for src in (args.subjects_csv, args.students_csv):
            if src and os.path.exists(src):
                dst = os.path.join(args.output_dir, os.path.basename(src))
                if os.path.abspath(src) != os.path.abspath(dst):
                    shutil.copy(src, dst)
                    print(f"Copied {src} → {dst}")

        log_path = os.path.join(args.output_dir, "run.log")
        params = [
            "=" * 60, "RUN LOG", "=" * 60,
            f"  Timestamp        : {datetime.now().isoformat(timespec='seconds')}",
            f"  Mode             : {mode_label}",
            f"  Students         : {len(students)}",
        ]
        if fixed_mode:
            params.append(f"  Blocks CSV       : {args.blocks_csv}")
        else:
            params.append(f"  Subjects CSV     : {args.subjects_csv}")
            params.append(f"  Num blocks       : {args.num_blocks}")
        params += [
            f"  Students CSV     : {args.students_csv}",
            f"  Threads          : {args.threads}",
            f"  Time limit       : {args.time_limit}s",
            f"  Duplicate backup : {args.duplicate_backup}",
            f"  Solve time       : {solve_elapsed:.2f}s",
            f"  Backups used     : {len(backup_users)} "
            f"({len(real_backup)} real, {len(wildcard)} wildcard)",
            "",
        ]
        with open(log_path, "w") as fh:
            fh.write("\n".join(params + summary) + "\n")
        print(f"Wrote {log_path}")


if __name__ == "__main__":
    main()
