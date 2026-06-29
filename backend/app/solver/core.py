"""ILP timetable block solver.

Ported from the original `timetable.py` CLI. File/stdout IO and process exits are
gone: inputs are plain dicts/lists, results are returned, and infeasibility raises
`SolverError` (the worker turns that into a FAILED job with a readable message).

Two modes:
  solve()              — auto: decide which subjects go in which block AND assign
                         students. First two choices always honoured; backup use
                         minimised.
  solve_fixed_blocks() — block layout is given; only student assignment is solved.

Student shape: {"name": str, "choices": [c1, c2, c3, c4], "backup": str | None}
Subjects shape (auto): {subject_name: [class_capacity, ...]}  (one entry per class)
Blocks shape (fixed):  {block_name: {subject_name: [class_capacity, ...]}}
"""
from __future__ import annotations

from collections import defaultdict

import pulp


class SolverError(Exception):
    """Raised on invalid input or infeasible/unsolved models."""


def _block_letters(n: int) -> list[str]:
    return [chr(ord("A") + i) for i in range(n)]


def _pick_solver(time_limit: int, threads: int, msg: bool = False):
    available = pulp.listSolvers(onlyAvailable=True)
    if "HiGHS" in available:
        return pulp.HiGHS(msg=msg, timeLimit=time_limit, threads=threads, parallel="on")
    if "HiGHS_CMD" in available:
        return pulp.HiGHS_CMD(msg=msg, timeLimit=time_limit, threads=threads)
    return pulp.PULP_CBC_CMD(msg=msg, timeLimit=time_limit, threads=threads)


def _check_status(prob, fixed: bool) -> None:
    sol = getattr(prob, "sol_status", None)
    if sol == -1 or prob.status == pulp.LpStatusInfeasible:
        raise SolverError(
            "No feasible assignment exists with these fixed blocks."
            if fixed
            else "No feasible timetable exists — check subject capacity and that "
            "mandatory choices don't create impossible conflicts."
        )
    if sol == 0 or sol is None:
        raise SolverError(
            "Solver found no complete solution within the time limit; raise it and retry."
        )


def validate_students(students: list[dict], known: set[str]) -> None:
    errors: list[str] = []
    for stu in students:
        choices = stu.get("choices") or []
        if len(choices) < 4:
            errors.append(f"'{stu['name']}': needs 4 ranked choices (has {len(choices)})")
            continue
        for opt in choices:
            if opt not in known:
                errors.append(f"'{stu['name']}': unknown subject '{opt}'")
        if len(set(choices)) != len(choices):
            errors.append(f"'{stu['name']}': duplicate subjects in choices")
        backup = stu.get("backup")
        if backup and backup not in known:
            errors.append(f"'{stu['name']}': unknown backup '{backup}'")
    if errors:
        raise SolverError("Invalid student choices:\n  - " + "\n  - ".join(errors[:25]))


# ── Auto mode ──────────────────────────────────────────────────────────────────
def solve(
    subjects: dict[str, list[int]],
    students: list[dict],
    n_blocks: int = 4,
    time_limit: int = 120,
    threads: int = 1,
    verbose: bool = False,
) -> dict:
    if not (2 <= n_blocks <= 5):
        raise SolverError("Auto mode supports 2–5 blocks.")
    validate_students(students, set(subjects))

    prob = pulp.LpProblem("timetable", pulp.LpMinimize)
    n = len(students)
    subj_names = list(subjects.keys())
    blocks = _block_letters(n_blocks)

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
    w: dict[int, dict[str, dict[str, pulp.LpVariable]]] = {}
    for p, stu in enumerate(students):
        if not stu.get("backup"):
            candidates = [s for s in subj_names if s not in stu["choices"]]
            w[p] = {
                s: {b: pulp.LpVariable(f"w_{p}_{s}_{b}", cat="Binary") for b in blocks}
                for s in candidates
            }

    prob += pulp.lpSum(a[p][4][b] for p in range(n) for b in blocks), "minimise_backup"

    for s in subj_names:
        for k in range(len(subjects[s])):
            prob += (pulp.lpSum(y[s][k][b] for b in blocks) == 1, f"class_{s}_{k}")

    for p, stu in enumerate(students):
        for i in (0, 1):
            prob += (pulp.lpSum(a[p][i][b] for b in blocks) == 1, f"mand_{p}_{i}")
        for b in blocks:
            prob += (pulp.lpSum(a[p][i][b] for i in range(5)) == 1, f"oneper_{p}_{b}")
        prob += (
            pulp.lpSum(a[p][i][b] for i in (2, 3, 4) for b in blocks) == n_blocks - 2,
            f"optional_{p}",
        )
        for i in range(5):
            prob += (pulp.lpSum(a[p][i][b] for b in blocks) <= 1, f"once_{p}_{i}")
        if not stu.get("backup"):
            for b in blocks:
                prob += (
                    a[p][4][b] == pulp.lpSum(w[p][s][b] for s in w[p]),
                    f"wild_{p}_{b}",
                )
        subj_to_opts: dict[str, list[int]] = defaultdict(list)
        for i, subj in enumerate(stu["choices"]):
            subj_to_opts[subj].append(i)
        if stu.get("backup"):
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
                if stu.get("backup") == s:
                    terms.append(a[p][4][b])
                elif not stu.get("backup") and s in w.get(p, {}):
                    terms.append(w[p][s][b])
            if terms:
                prob += (
                    pulp.lpSum(terms)
                    <= pulp.lpSum(y[s][k][b] * caps[k] for k in range(len(caps))),
                    f"cap_{s}_{b}",
                )

    prob.solve(_pick_solver(time_limit, threads, msg=verbose))
    _check_status(prob, fixed=False)

    block_classes: dict[str, dict[str, list[int]]] = {b: {} for b in blocks}
    for s in subj_names:
        for k, cap in enumerate(subjects[s]):
            for b in blocks:
                if (pulp.value(y[s][k][b]) or 0) > 0.5:
                    block_classes[b].setdefault(s, []).append(cap)
                    break

    student_block_map, backup_users = _extract(a, w, students, blocks)
    return {
        "block_classes": block_classes,
        "student_block_map": student_block_map,
        "backup_users": backup_users,
        "block_names": list(blocks),
    }


# ── Fixed-blocks mode ────────────────────────────────────────────────────────
def solve_fixed_blocks(
    blocks: dict[str, dict[str, list[int]]],
    students: list[dict],
    time_limit: int = 120,
    threads: int = 1,
    verbose: bool = False,
) -> dict:
    known: set[str] = set()
    for subjs in blocks.values():
        known.update(subjs.keys())
    validate_students(students, known)

    prob = pulp.LpProblem("timetable_fixed", pulp.LpMinimize)
    n = len(students)
    block_names = list(blocks.keys())

    total_cap = {
        b: {s: sum(caps) for s, caps in subjs.items()} for b, subjs in blocks.items()
    }
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
    w: dict[int, dict[str, dict[str, pulp.LpVariable]]] = {}
    for p, stu in enumerate(students):
        if not stu.get("backup"):
            candidates = [s for s in all_subjects if s not in stu["choices"]]
            w[p] = {
                s: {
                    b: pulp.LpVariable(f"w_{p}_{s}_{b}", cat="Binary")
                    for b in block_names
                    if s in blocks[b]
                }
                for s in candidates
            }

    prob += pulp.lpSum(a[p][4][b] for p in range(n) for b in block_names), "min_backup"

    for p, stu in enumerate(students):
        for i in (0, 1):
            prob += (pulp.lpSum(a[p][i][b] for b in block_names) == 1, f"mand_{p}_{i}")
        for b in block_names:
            prob += (pulp.lpSum(a[p][i][b] for i in range(5)) == 1, f"oneper_{p}_{b}")
        for i in range(5):
            prob += (pulp.lpSum(a[p][i][b] for b in block_names) <= 1, f"once_{p}_{i}")
        choices = stu["choices"]
        backup = stu.get("backup")
        for i, subj in enumerate(choices):
            for b in block_names:
                if subj not in blocks[b]:
                    prob += (a[p][i][b] == 0, f"noff_{p}_{i}_{b}")
        if backup:
            for b in block_names:
                if backup not in blocks[b]:
                    prob += (a[p][4][b] == 0, f"noff_{p}_4_{b}")
        else:
            for b in block_names:
                wild = [w[p][s][b] for s in w[p] if b in w[p][s]]
                prob += (a[p][4][b] == pulp.lpSum(wild), f"wild_{p}_{b}")
        subj_to_opts: dict[str, list[int]] = defaultdict(list)
        for i, subj in enumerate(choices):
            subj_to_opts[subj].append(i)
        if backup:
            subj_to_opts[backup].append(4)
        for subj, opts in subj_to_opts.items():
            if len(opts) > 1:
                prob += (
                    pulp.lpSum(a[p][i][b] for i in opts for b in block_names) <= 1,
                    f"nodup_{p}_{subj}",
                )

    for b in block_names:
        for s, cap in total_cap[b].items():
            terms = []
            for p, stu in enumerate(students):
                for i, opt in enumerate(stu["choices"]):
                    if opt == s:
                        terms.append(a[p][i][b])
                if stu.get("backup") == s:
                    terms.append(a[p][4][b])
                elif not stu.get("backup") and s in w.get(p, {}) and b in w[p][s]:
                    terms.append(w[p][s][b])
            if terms:
                prob += (pulp.lpSum(terms) <= cap, f"cap_{s}_{b}")

    prob.solve(_pick_solver(time_limit, threads, msg=verbose))
    _check_status(prob, fixed=True)

    student_block_map, backup_users = _extract(a, w, students, block_names)
    return {
        "block_classes": {b: dict(subjs) for b, subjs in blocks.items()},
        "student_block_map": student_block_map,
        "backup_users": backup_users,
        "block_names": block_names,
    }


def _extract(a, w, students, block_names) -> tuple[dict, list]:
    student_block_map: dict[str, dict[str, str]] = {}
    backup_users: list[dict] = []
    for p, stu in enumerate(students):
        choices = stu["choices"]
        backup = stu.get("backup")
        assignment: dict[str, str] = {}
        backup_block: str | None = None
        for b in block_names:
            for i in range(5):
                if (pulp.value(a[p][i][b]) or 0) > 0.5:
                    if i == 4:
                        backup_block = b
                        if not backup:
                            picked = "?"
                            for s, per_b in w.get(p, {}).items():
                                if b in per_b and (pulp.value(per_b[b]) or 0) > 0.5:
                                    picked = s
                                    break
                            assignment[b] = picked
                        else:
                            assignment[b] = backup
                    else:
                        assignment[b] = choices[i]
                    break
        if backup_block is not None:
            assigned = set(assignment.values())
            dropped = [c for c in choices[2:] if c not in assigned]
            backup_users.append(
                {
                    "name": stu["name"],
                    "dropped": dropped[0] if dropped else "?",
                    "backup": assignment[backup_block],
                    "is_wildcard": not backup,
                }
            )
        student_block_map[stu["name"]] = assignment
    return student_block_map, backup_users
