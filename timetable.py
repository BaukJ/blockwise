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
Timetable block grouping optimizer.

Two modes:

1. Auto mode (default): given subjects.csv + students.csv, decides which
   subjects go in which of 4 blocks (A-D) AND assigns students. Minimises
   students who fall back to their backup; first two choices always honoured.

2. Fixed-blocks mode (--blocks-csv blocks.csv): the block layout is given.
   Only assigns students into the predefined slots, still minimising backup.

subjects.csv columns : subject, total_classes, class_capacity
                       (one row adds `total_classes` parallel classes of that
                        capacity; repeat the subject on multiple rows to declare
                        classes with different capacities, e.g. one 35-seat and
                        one 30-seat Geography class)
students.csv columns : student_name, choice1, choice2, choice3, choice4, backup
                       (backup may be left empty — those students will accept
                        any subject the solver picks to fill the slot, with the
                        solver still preferring to give them their top 4 choices
                        where possible)
blocks.csv   columns : block, subject, child_limit
                       (one row per parallel class; repeat the (block,subject)
                        pair on multiple rows for multiple parallel classes)

Usage:
    uv run timetable.py
    uv run timetable.py subjects.csv students.csv --out-csv out.csv --out-yaml out.yaml
    uv run timetable.py students.csv --blocks-csv blocks.csv
    uv run timetable.py --time-limit 600 --threads 8 --duplicate-backup=ignore
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

import pulp
import yaml

import parse

DEFAULT_BLOCKS = ["A", "B", "C", "D"]


# ── Input loading ─────────────────────────────────────────────────────────────

def load_subjects(path: str) -> dict[str, list[int]]:
    """
    Load subjects.csv (subject, total_classes, class_capacity) → {subject: [cap, ...]}.

    Each row contributes `total_classes` parallel classes of `class_capacity`.
    Multiple rows for the same subject are concatenated, so a subject can have
    classes of different sizes (e.g. one Geography row with 1×35 and another
    with 1×30 yields a 35-seat class and a 30-seat class).
    """
    subjects: dict[str, list[int]] = {}
    with open(path, newline="") as fh:
        for row in csv.DictReader(fh):
            if row["subject"].startswith("#"):
                # Alllow comments in the file
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
            students.append({
                "name": row["student_name"].strip(),
                "choices": [row[f"choice{i}"].strip() for i in range(1, 5)],
                "backup": backup if backup else None,
            })
    return students


def load_blocks(path: str) -> dict[str, dict[str, list[int]]]:
    """
    Load blocks.csv (block, subject, child_limit) → {block: {subject: [cap, ...]}}.
    Each row is one parallel class with that capacity; repeated (block, subject)
    rows mean multiple parallel classes of that subject within the block.
    Block order is preserved as first seen.
    """
    blocks: dict[str, dict[str, list[int]]] = {}
    with open(path, newline="") as fh:
        for row in csv.DictReader(fh):
            block = row["block"].strip()
            subject = row["subject"].strip()
            limit = int(row["child_limit"])
            blocks.setdefault(block, {}).setdefault(subject, []).append(limit)
    return blocks


# ── Validation ────────────────────────────────────────────────────────────────

def _validate_student_options(
    students: list,
    known: set[str],
    duplicate_backup: str,
) -> list[str]:
    """
    duplicate_backup controls what happens when a student's backup duplicates
    one of their choices:
      - "error"  : refuse to solve
      - "ignore" : warn and treat the backup as unavailable (4-choices-only)
      - "any"    : warn and replace the backup with a wildcard (the solver may
                   pick any subject for the slot if needed)
    Note: with "any", this function mutates `stu["backup"]` to None in place.
    """
    errors: list[str] = []
    for stu in students:
        choices = stu["choices"]
        backup = stu["backup"]  # may be None
        for opt in choices:
            if opt not in known:
                errors.append(f"Student '{stu['name']}': unknown subject '{opt}'")
        if backup is not None and backup not in known:
            errors.append(f"Student '{stu['name']}': unknown subject '{backup}'")
        seen: set[str] = set()
        for opt in choices:
            if opt in seen:
                errors.append(f"Student '{stu['name']}': duplicate subject '{opt}' in choices")
            seen.add(opt)
        if backup is not None and backup in seen:
            msg = f"Student '{stu['name']}': backup '{backup}' duplicates a chosen subject"
            if duplicate_backup == "ignore":
                print(f"WARNING: {msg} — backup will be unavailable", file=sys.stderr)
            elif duplicate_backup == "any":
                print(f"WARNING: {msg} — backup replaced with any-subject wildcard",
                      file=sys.stderr)
                stu["backup"] = None
            else:
                errors.append(msg)
    return errors


def validate(subjects: dict, students: list, duplicate_backup: str = "error") -> None:
    errors = _validate_student_options(students, set(subjects), duplicate_backup)
    if errors:
        for e in errors:
            print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)


def validate_blocks(
    blocks: dict[str, dict[str, list[int]]],
    students: list,
    duplicate_backup: str = "error",
) -> None:
    known: set[str] = set()
    for subjs in blocks.values():
        known.update(subjs.keys())
    errors = _validate_student_options(students, known, duplicate_backup)

    # Each student's first two choices must be offered in at least one block,
    # otherwise the model is infeasible by construction.
    subj_blocks: dict[str, set[str]] = defaultdict(set)
    for b, subjs in blocks.items():
        for s in subjs:
            subj_blocks[s].add(b)
    for stu in students:
        for i in (0, 1):
            subj = stu["choices"][i]
            if subj in known and not subj_blocks.get(subj):
                errors.append(
                    f"Student '{stu['name']}': mandatory choice{i+1} '{subj}' "
                    f"is not offered in any block"
                )

    if errors:
        for e in errors:
            print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)


# ── Solver helper ─────────────────────────────────────────────────────────────

def _pick_solver(time_limit: int, threads: int):
    available = pulp.listSolvers(onlyAvailable=True)
    if "HiGHS" in available:
        return pulp.HiGHS(msg=True, timeLimit=time_limit, threads=threads,
                          parallel="on")
    if "HiGHS_CMD" in available:
        return pulp.HiGHS_CMD(msg=True, timeLimit=time_limit, threads=threads,
                              options=["parallel=on"])
    return pulp.PULP_CBC_CMD(msg=True, timeLimit=time_limit, threads=threads)


def _check_solve_status(prob, fixed: bool) -> None:
    sol = getattr(prob, "sol_status", None)
    if sol == -1 or prob.status == pulp.LpStatusInfeasible:
        if fixed:
            print(
                "ERROR: No feasible assignment exists with these fixed blocks.\n"
                "       Check that block child_limits are sufficient and that each\n"
                "       student's mandatory choices appear in at least one block.",
                file=sys.stderr,
            )
        else:
            print(
                "ERROR: No feasible timetable exists with these subjects and student choices.\n"
                "       Check that total capacity (total_classes × class_capacity) per subject\n"
                "       is sufficient, and that mandatory choices don't create impossible block\n"
                "       conflicts.",
                file=sys.stderr,
            )
        sys.exit(1)
    if sol == 0 or sol is None:
        print(
            "ERROR: Solver found no complete integer solution within the time limit.\n"
            "       Try increasing --time-limit (e.g. --time-limit 300).",
            file=sys.stderr,
        )
        sys.exit(1)
    if sol == 2:
        print(
            "WARNING: Time limit reached before proving optimality.\n"
            "         Proceeding with best solution found — backup count may not be minimal.",
            file=sys.stderr,
        )


# ── ILP model: auto mode ──────────────────────────────────────────────────────

def solve(subjects: dict[str, list[int]], students: list,
          time_limit: int = 300, threads: int = 1) -> dict:
    """
    Decision variables
    ------------------
    y[s][k][b]   binary        — class k of subject s lives in block b
                                 (one binary per class; each class lands in exactly
                                  one block, but its capacity carries with it)
    a[p][i][b]   binary        — student p takes option i in block b
                                 i=0..3 → choice 1-4,  i=4 → backup
    w[p][s][b]   binary        — only for students with no backup specified:
                                 1 iff that student takes subject s in block b
                                 as their wildcard "anything" pick. Linked to
                                 a[p][4][b] so existing per-student constraints
                                 still apply uniformly.
    """
    prob = pulp.LpProblem("timetable", pulp.LpMinimize)
    n = len(students)
    subj_names = list(subjects.keys())
    blocks = DEFAULT_BLOCKS

    y = {
        s: {
            k: {b: pulp.LpVariable(f"y_{s}_{k}_{b}", cat="Binary") for b in blocks}
            for k in range(len(subjects[s]))
        }
        for s in subj_names
    }
    a = {
        p: {
            i: {b: pulp.LpVariable(f"a_{p}_{i}_{b}", cat="Binary") for b in blocks}
            for i in range(5)
        }
        for p in range(n)
    }
    # Wildcard backup vars for no-backup students
    w: dict[int, dict[str, dict[str, pulp.LpVariable]]] = {}
    for p, stu in enumerate(students):
        if stu["backup"] is None:
            candidates = [s for s in subj_names if s not in stu["choices"]]
            w[p] = {
                s: {b: pulp.LpVariable(f"w_{p}_{s}_{b}", cat="Binary") for b in blocks}
                for s in candidates
            }

    prob += pulp.lpSum(a[p][4][b] for p in range(n) for b in blocks), "minimise_backup"

    # Each class of each subject must land in exactly one block
    for s in subj_names:
        for k in range(len(subjects[s])):
            prob += (
                pulp.lpSum(y[s][k][b] for b in blocks) == 1,
                f"class_assigned_{s}_{k}",
            )

    for p, stu in enumerate(students):
        for i in (0, 1):
            prob += (
                pulp.lpSum(a[p][i][b] for b in blocks) == 1,
                f"mandatory_{p}_{i}",
            )

        for b in blocks:
            prob += (
                pulp.lpSum(a[p][i][b] for i in range(5)) == 1,
                f"one_per_block_{p}_{b}",
            )

        prob += (
            pulp.lpSum(a[p][i][b] for i in (2, 3, 4) for b in blocks) == 2,
            f"optional_{p}",
        )

        for i in range(5):
            prob += (
                pulp.lpSum(a[p][i][b] for b in blocks) <= 1,
                f"once_{p}_{i}",
            )

        # Link wildcard vars to a[p][4][b] for no-backup students
        if stu["backup"] is None:
            for b in blocks:
                prob += (
                    a[p][4][b] == pulp.lpSum(w[p][s][b] for s in w[p]),
                    f"wildcard_link_{p}_{b}",
                )

        # No duplicate subjects (when backup duplicates a choice). With no backup
        # specified, only choice-vs-choice dups could exist and validation already
        # rejects them — so this only fires when backup is present.
        subj_to_opts: dict[str, list[int]] = defaultdict(list)
        for i, subj in enumerate(stu["choices"]):
            subj_to_opts[subj].append(i)
        if stu["backup"] is not None:
            subj_to_opts[stu["backup"]].append(4)
        for subj, opts in subj_to_opts.items():
            if len(opts) > 1:
                prob += (
                    pulp.lpSum(a[p][i][b] for i in opts for b in blocks) <= 1,
                    f"nodup_{p}_{subj}",
                )

    for s in subj_names:
        caps = subjects[s]
        for b in blocks:
            terms = []
            for p, stu in enumerate(students):
                for i, opt in enumerate(stu["choices"]):
                    if opt == s:
                        terms.append(a[p][i][b])
                if stu["backup"] == s:
                    terms.append(a[p][4][b])
                elif stu["backup"] is None and s in w.get(p, {}):
                    terms.append(w[p][s][b])
            if terms:
                prob += (
                    pulp.lpSum(terms)
                    <= pulp.lpSum(y[s][k][b] * caps[k] for k in range(len(caps))),
                    f"cap_{s}_{b}",
                )

    prob.solve(_pick_solver(time_limit, threads))
    _check_solve_status(prob, fixed=False)

    # Build block_classes: {block: {subject: [class_capacity, ...]}}.
    # Each class k of subject s contributes its own capacity to the block it lands in.
    block_classes: dict[str, dict[str, list[int]]] = {b: {} for b in blocks}
    for s in subj_names:
        for k, cap in enumerate(subjects[s]):
            for b in blocks:
                if (pulp.value(y[s][k][b]) or 0) > 0.5:
                    block_classes[b].setdefault(s, []).append(cap)
                    break

    student_block_map, backup_users = _extract_assignments(a, w, students, blocks)

    return {
        "block_classes": block_classes,
        "student_block_map": student_block_map,
        "backup_users": backup_users,
        "block_names": list(blocks),
    }


# ── ILP model: fixed-blocks mode ──────────────────────────────────────────────

def solve_fixed_blocks(
    blocks: dict[str, dict[str, list[int]]],
    students: list,
    time_limit: int = 300,
    threads: int = 1,
) -> dict:
    """
    Block layout (which subjects in which block, and their capacities) is fixed.
    Only the student → (block, option) assignment is decided.

    Decision variable
    -----------------
    a[p][i][b]   binary   — student p takes option i in block b
                            i=0..3 → choice 1-4,  i=4 → backup
    """
    prob = pulp.LpProblem("timetable_fixed", pulp.LpMinimize)
    n = len(students)
    block_names = list(blocks.keys())

    # Total capacity per (block, subject) = sum of parallel-class caps
    total_cap: dict[str, dict[str, int]] = {
        b: {s: sum(caps) for s, caps in subjs.items()}
        for b, subjs in blocks.items()
    }

    # All subjects offered in any block — wildcard candidates draw from here.
    all_subjects: set[str] = set()
    for subjs in blocks.values():
        all_subjects.update(subjs.keys())

    a = {
        p: {
            i: {b: pulp.LpVariable(f"a_{p}_{i}_{b}", cat="Binary") for b in block_names}
            for i in range(5)
        }
        for p in range(n)
    }
    # Wildcard backup vars for no-backup students: only created for (s, b) where
    # subject s is actually offered in block b.
    w: dict[int, dict[str, dict[str, pulp.LpVariable]]] = {}
    for p, stu in enumerate(students):
        if stu["backup"] is None:
            candidates = [s for s in all_subjects if s not in stu["choices"]]
            w[p] = {
                s: {
                    b: pulp.LpVariable(f"w_{p}_{s}_{b}", cat="Binary")
                    for b in block_names if s in blocks[b]
                }
                for s in candidates
            }

    prob += pulp.lpSum(a[p][4][b] for p in range(n) for b in block_names), "minimise_backup"

    for p, stu in enumerate(students):
        # First two choices mandatory (placed in exactly one block)
        for i in (0, 1):
            prob += (
                pulp.lpSum(a[p][i][b] for b in block_names) == 1,
                f"mandatory_{p}_{i}",
            )

        # Exactly one option per block (fills all n_blocks slots)
        for b in block_names:
            prob += (
                pulp.lpSum(a[p][i][b] for i in range(5)) == 1,
                f"one_per_block_{p}_{b}",
            )

        # Each option used at most once across blocks
        for i in range(5):
            prob += (
                pulp.lpSum(a[p][i][b] for b in block_names) <= 1,
                f"once_{p}_{i}",
            )

        # An option can only sit in a block that actually offers that subject.
        # Skip i=4 when backup is None — the wildcard logic handles routing.
        choices = stu["choices"]
        backup = stu["backup"]
        for i, subj in enumerate(choices):
            for b in block_names:
                if subj not in blocks[b]:
                    prob += (a[p][i][b] == 0, f"notoffered_{p}_{i}_{b}")
        if backup is not None:
            for b in block_names:
                if backup not in blocks[b]:
                    prob += (a[p][4][b] == 0, f"notoffered_{p}_4_{b}")
        else:
            # Link a[p][4][b] to wildcard subject vars
            for b in block_names:
                wild_terms = [w[p][s][b] for s in w[p] if b in w[p][s]]
                prob += (
                    a[p][4][b] == pulp.lpSum(wild_terms),
                    f"wildcard_link_{p}_{b}",
                )

        # No duplicate subjects (only meaningful when backup is present)
        subj_to_opts: dict[str, list[int]] = defaultdict(list)
        for i, subj in enumerate(choices):
            subj_to_opts[subj].append(i)
        if backup is not None:
            subj_to_opts[backup].append(4)
        for subj, opts in subj_to_opts.items():
            if len(opts) > 1:
                prob += (
                    pulp.lpSum(a[p][i][b] for i in opts for b in block_names) <= 1,
                    f"nodup_{p}_{subj}",
                )

    # Capacity per (block, subject)
    for b in block_names:
        for s, cap in total_cap[b].items():
            terms = []
            for p, stu in enumerate(students):
                for i, opt in enumerate(stu["choices"]):
                    if opt == s:
                        terms.append(a[p][i][b])
                if stu["backup"] == s:
                    terms.append(a[p][4][b])
                elif stu["backup"] is None and s in w.get(p, {}) and b in w[p][s]:
                    terms.append(w[p][s][b])
            if terms:
                prob += (pulp.lpSum(terms) <= cap, f"cap_{s}_{b}")

    prob.solve(_pick_solver(time_limit, threads))
    _check_solve_status(prob, fixed=True)

    student_block_map, backup_users = _extract_assignments(a, w, students, block_names)

    return {
        "block_classes": {b: dict(subjs) for b, subjs in blocks.items()},
        "student_block_map": student_block_map,
        "backup_users": backup_users,
        "block_names": block_names,
    }


def _extract_assignments(a, w, students, block_names) -> tuple[dict, list]:
    student_block_map: dict[str, dict[str, str]] = {}
    backup_users: list[dict] = []

    for p, stu in enumerate(students):
        choices = stu["choices"]
        backup = stu["backup"]
        assignment: dict[str, str] = {}
        backup_block: str | None = None

        for b in block_names:
            for i in range(5):
                if (pulp.value(a[p][i][b]) or 0) > 0.5:
                    if i == 4:
                        backup_block = b
                        if backup is None:
                            picked = "?"
                            for s, var_per_b in w.get(p, {}).items():
                                if b in var_per_b and (pulp.value(var_per_b[b]) or 0) > 0.5:
                                    picked = s
                                    break
                            assignment[b] = picked
                        else:
                            assignment[b] = backup
                    else:
                        assignment[b] = choices[i]
                    break

        if backup_block is not None:
            assigned_set = set(assignment.values())
            dropped = [c for c in choices[2:] if c not in assigned_set]
            backup_users.append({
                "name": stu["name"],
                "dropped": dropped[0] if dropped else "?",
                "backup": assignment[backup_block],
                # True when the student had no usable backup (none given, or a
                # duplicate backup ignored/replaced) and the solver picked any
                # available subject as a wildcard substitute.
                "is_wildcard": backup is None,
            })

        student_block_map[stu["name"]] = assignment

    return student_block_map, backup_users


# ── Output writers ────────────────────────────────────────────────────────────

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
    """
    Write the solved block layout as a blocks.csv (block, subject, child_limit)
    that can be fed straight back into the script via --blocks-csv to re-run the
    student assignment against this fixed layout. One row per parallel class.
    """
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
                # Solver should have respected capacity, but absorb stragglers if
                # somehow over-assigned.
                classes[-1].extend(roster[idx:])
            output[block_key][subj] = classes

    with open(out_path, "w") as fh:
        yaml.dump(output, fh, default_flow_style=False, allow_unicode=True, sort_keys=False)


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Timetable block grouping optimizer",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "subjects_csv",
        nargs="?",
        default=None,
        help="CSV with columns: subject, total_classes, class_capacity "
             "(default: subjects.csv). Repeat the subject on multiple rows to "
             "declare classes with different capacities. Ignored in --blocks-csv "
             "mode if the file is missing. In --blocks-csv mode you can pass just "
             "one positional, which is then interpreted as the students CSV.",
    )
    parser.add_argument(
        "students_csv",
        nargs="?",
        default=None,
        help="CSV with columns: student_name, choice1, choice2, choice3, choice4, backup "
             "(default: students.csv)",
    )
    parser.add_argument("--blocks-csv", default=None, metavar="PATH",
                        help="Optional CSV with columns: block, subject, child_limit. "
                             "When provided, the block layout is taken as fixed and only "
                             "student assignment is solved.")
    parser.add_argument("--out-csv", default="timetable.csv", metavar="PATH",
                        help="Output CSV path (default: timetable.csv)")
    parser.add_argument("--out-yaml", default="timetable.yaml", metavar="PATH",
                        help="Output YAML path (default: timetable.yaml)")
    parser.add_argument("--output-dir", default=None, metavar="DIR",
                        help="Write timetable.yml, timetable.csv and blocks.csv "
                             "into this directory (created if needed). blocks.csv "
                             "captures the solved layout and can be passed back via "
                             "--blocks-csv. Overrides --out-csv/--out-yaml.")
    parser.add_argument("--time-limit", type=int, default=300, metavar="SECONDS",
                        help="Solver time limit in seconds (default: 300)")
    parser.add_argument("--threads", type=int, default=os.cpu_count() or 1, metavar="N",
                        help=f"Solver threads (default: all cores = {os.cpu_count() or 1})")
    parser.add_argument("--duplicate-backup", choices=["error", "ignore", "any"],
                        default="error",
                        help="What to do when a student's backup duplicates one of their "
                             "choices. 'error' (default): refuse to solve. 'ignore': warn and "
                             "treat the backup as unavailable, so the student gets only their "
                             "4 choices. 'any': warn and replace the backup with an "
                             "any-subject wildcard, letting the solver pick a substitute if "
                             "one is needed.")
    args = parser.parse_args()

    if args.output_dir is not None:
        os.makedirs(args.output_dir, exist_ok=True)
        args.out_csv = os.path.join(args.output_dir, "timetable.csv")
        args.out_yaml = os.path.join(args.output_dir, "timetable.yml")

    fixed_mode = args.blocks_csv is not None

    # In fixed mode the subjects CSV is optional; if the user passes only one
    # positional, treat it as the students file rather than the subjects file.
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

    if fixed_mode:
        print(f"Loading {args.blocks_csv} …")
        blocks = load_blocks(args.blocks_csv)
        n_classes = sum(len(caps) for subjs in blocks.values() for caps in subjs.values())
        n_subjects = len({s for subjs in blocks.values() for s in subjs})
        print(f"  {len(blocks)} blocks, {n_subjects} subjects, "
              f"{n_classes} classes, {len(students)} students")
        validate_blocks(blocks, students, duplicate_backup=args.duplicate_backup)
    else:
        assert subjects is not None
        print(f"  {len(subjects)} subjects, {len(students)} students")
        validate(subjects, students, duplicate_backup=args.duplicate_backup)

    available = pulp.listSolvers(onlyAvailable=True)
    solver_name = "HiGHS" if ("HiGHS" in available or "HiGHS_CMD" in available) else "CBC"
    mode_label = "fixed-blocks" if fixed_mode else "auto"
    print(
        f"\nSolving with {solver_name} ILP ({mode_label} mode, {args.threads} thread(s), "
        f"time limit: {args.time_limit}s) …\n"
    )

    solve_start = time.perf_counter()
    if fixed_mode:
        result = solve_fixed_blocks(blocks, students,
                                    time_limit=args.time_limit, threads=args.threads)
    else:
        result = solve(subjects, students,
                       time_limit=args.time_limit, threads=args.threads)
    solve_elapsed = time.perf_counter() - solve_start

    # ── Summary ───────────────────────────────────────────────────────────────
    # Build the summary as a list of lines so the exact same content can be both
    # printed and written to the log file.
    summary: list[str] = []
    summary.append("═" * 60)
    summary.append("BLOCK LAYOUT")
    summary.append("═" * 60)
    for b in result["block_names"]:
        subjs = result["block_classes"].get(b, {})
        parts = [f"{s} ×{len(caps)}" if len(caps) > 1 else s for s, caps in subjs.items()]
        summary.append(f"  {_block_key(b)}: {', '.join(parts) or '(empty)'}")

    backup_users = result["backup_users"]
    real_backup = [e for e in backup_users if not e.get("is_wildcard")]
    wildcard = [e for e in backup_users if e.get("is_wildcard")]
    n_backup = len(backup_users)
    summary.append("")
    summary.append("═" * 60)
    summary.append(f"BACKUP USAGE: {n_backup} student(s)")
    summary.append("═" * 60)
    if backup_users:
        summary.append(f"\n  Got their backup ({len(real_backup)}):")
        if real_backup:
            for entry in real_backup:
                summary.append(
                    f"    {entry['name']}: dropped '{entry['dropped']}'"
                    f" → using backup '{entry['backup']}'"
                )
        else:
            summary.append("    (none)")

        summary.append(f"\n  Got a wildcard — no usable backup ({len(wildcard)}):")
        if wildcard:
            for entry in wildcard:
                summary.append(
                    f"    {entry['name']}: dropped '{entry['dropped']}'"
                    f" → assigned wildcard '{entry['backup']}'"
                )
        else:
            summary.append("    (none)")
    else:
        summary.append("  All students received their top 4 choices.")

    print("\n" + "\n".join(summary))

    print()
    write_csv(result, args.out_csv)
    print(f"Wrote {args.out_csv}")
    write_yaml(result, args.out_yaml)
    print(f"Wrote {args.out_yaml}")
    if args.output_dir is not None:
        blocks_path = os.path.join(args.output_dir, "blocks.csv")
        write_blocks_csv(result, blocks_path)
        print(f"Wrote {blocks_path}")

        student_tt_path = os.path.join(args.output_dir, "student_timetable.csv")
        n = parse.export_student_timetable(args.students_csv, args.out_yaml,
                                           student_tt_path)
        print(f"Wrote {student_tt_path} ({n} students)")

        # Copy the input files alongside the outputs for a self-contained record.
        for src in (args.subjects_csv, args.students_csv):
            if src and os.path.exists(src):
                dst = os.path.join(args.output_dir, os.path.basename(src))
                if os.path.abspath(src) != os.path.abspath(dst):
                    shutil.copy(src, dst)
                    print(f"Copied {src} → {dst}")

        log_path = os.path.join(args.output_dir, "run.log")
        params = [
            "═" * 60,
            "RUN LOG",
            "═" * 60,
            f"  Timestamp        : {datetime.now().isoformat(timespec='seconds')}",
            f"  Mode             : {mode_label}",
            f"  Solver           : {solver_name}",
            f"  Students         : {len(students)}",
        ]
        if fixed_mode:
            params.append(f"  Blocks CSV       : {args.blocks_csv}")
            params.append(f"  Blocks/subjects  : {len(blocks)} blocks, "
                          f"{n_subjects} subjects, {n_classes} classes")
        else:
            params.append(f"  Subjects CSV     : {args.subjects_csv}")
            params.append(f"  Subjects         : {len(subjects)}")
        params += [
            f"  Students CSV     : {args.students_csv}",
            f"  Threads          : {args.threads}",
            f"  Time limit       : {args.time_limit}s",
            f"  Duplicate backup : {args.duplicate_backup}",
            f"  Solve time       : {solve_elapsed:.2f}s",
            f"  Backups used     : {n_backup} ({len(real_backup)} real, "
            f"{len(wildcard)} wildcard)",
            "",
        ]
        with open(log_path, "w") as fh:
            fh.write("\n".join(params + summary) + "\n")
        print(f"Wrote {log_path}")


if __name__ == "__main__":
    main()
