"""ILP timetable block solver.

Inputs are plain dicts/lists, results are returned, and infeasibility raises
`SolverError` (the worker turns that into a FAILED job with a readable message).

Two modes:
  solve()              — auto: decide which subjects go in which block AND assign
                         students.
  solve_fixed_blocks() — block layout is given; only student assignment is solved.

Each student supplies an ordered preference list ("options" = their ranked choices
followed by their backups, best first) and `n_choices` marking how many leading
options are "real" choices vs backups. The solver fills every block with one option
(or a wildcard when a student has fewer options than blocks) and MINIMISES a weighted
penalty that grows with option rank — so it prefers honouring lower-numbered choices
and will drop a student's choice 4 before another student's choice 3. Backups are just
lower-priority options; wildcards are heavily penalised so they're used only as a last
resort. There is no hard guarantee — the weighting makes top choices near-inviolable.

Student shape: {"name": str, "options": [subj, ...], "n_choices": int}
Subjects shape (auto): {subject_name: [class_capacity, ...]}  (one entry per class)
Blocks shape (fixed):  {block_name: {subject_name: [class_capacity, ...]}}
"""
from __future__ import annotations

from collections import defaultdict

import pulp

# Penalty for filling a block with a wildcard (any-subject) pick. Far larger than any
# realistic option rank so real options are always preferred.
WILDCARD_PENALTY = 10_000


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
            else "No feasible timetable exists — check subject capacity is enough "
            "for the number of students."
        )
    if sol == 0 or sol is None:
        raise SolverError(
            "Solver found no complete solution within the time limit; raise it and retry."
        )


def _options(stu: dict) -> list[str]:
    return [o for o in (stu.get("options") or []) if o]


def validate_students(students: list[dict], known: set[str]) -> None:
    errors: list[str] = []
    for stu in students:
        opts = _options(stu)
        if not opts:
            errors.append(f"'{stu['name']}': has no choices")
            continue
        for opt in opts:
            if opt not in known:
                errors.append(f"'{stu['name']}': unknown subject '{opt}'")
        if len(set(opts)) != len(opts):
            errors.append(f"'{stu['name']}': duplicate subjects in choices")
    if errors:
        raise SolverError("Invalid student choices:\n  - " + "\n  - ".join(errors[:25]))


def _build(prob, students, block_names, wild_pool: set[str]):
    """Shared per-student variables, constraints and objective.

    wild_pool is the set of subjects a wildcard may resolve to (all subjects in auto
    mode; all offered subjects in fixed mode).

    Returns (a, w) where:
      a[p][i][b] — student p takes their option i in block b
      w[p][s][b] — student p takes wildcard subject s in block b
    """
    a: dict = {}
    w: dict = {}
    penalty_terms = []

    for p, stu in enumerate(students):
        opts = _options(stu)
        a[p] = {
            i: {b: pulp.LpVariable(f"a_{p}_{i}_{b}", cat="Binary") for b in block_names}
            for i in range(len(opts))
        }
        # Wildcard candidates: any offered subject the student didn't list.
        w[p] = {
            s: {b: pulp.LpVariable(f"w_{p}_{s}_{b}", cat="Binary") for b in block_names}
            for s in wild_pool
            if s not in opts
        }

        # One option (or wildcard) per block.
        for b in block_names:
            prob += (
                pulp.lpSum(a[p][i][b] for i in range(len(opts)))
                + pulp.lpSum(w[p][s][b] for s in w[p])
                == 1,
                f"fill_{p}_{b}",
            )
        # Each option / wildcard subject used at most once across blocks.
        for i in range(len(opts)):
            prob += (pulp.lpSum(a[p][i][b] for b in block_names) <= 1, f"once_{p}_{i}")
        for s in w[p]:
            prob += (pulp.lpSum(w[p][s][b] for b in block_names) <= 1, f"wonce_{p}_{s}")

        # Objective: rank weight per kept option + heavy wildcard penalty.
        for i in range(len(opts)):
            for b in block_names:
                penalty_terms.append(i * a[p][i][b])
        for s in w[p]:
            for b in block_names:
                penalty_terms.append(WILDCARD_PENALTY * w[p][s][b])

    prob += pulp.lpSum(penalty_terms), "minimise_dissatisfaction"
    return a, w


# ── Auto mode ──────────────────────────────────────────────────────────────────
def solve(
    subjects: dict[str, list[int]],
    students: list[dict],
    n_blocks: int = 4,
    time_limit: int = 120,
    threads: int = 1,
    verbose: bool = False,
) -> dict:
    if not (1 <= n_blocks <= 8):
        raise SolverError("Number of blocks must be between 1 and 8.")
    validate_students(students, set(subjects))

    prob = pulp.LpProblem("timetable", pulp.LpMinimize)
    subj_names = list(subjects.keys())
    blocks = _block_letters(n_blocks)

    y = {
        s: {
            k: {b: pulp.LpVariable(f"y_{s}_{k}_{b}", cat="Binary") for b in blocks}
            for k in range(len(subjects[s]))
        }
        for s in subj_names
    }
    # Each class lands in exactly one block.
    for s in subj_names:
        for k in range(len(subjects[s])):
            prob += (pulp.lpSum(y[s][k][b] for b in blocks) == 1, f"class_{s}_{k}")

    a, w = _build(prob, students, blocks, set(subj_names))

    # Capacity: students assigned to subject s in block b <= seats provided there.
    for s in subj_names:
        caps = subjects[s]
        for b in blocks:
            terms = []
            for p, stu in enumerate(students):
                opts = _options(stu)
                for i, opt in enumerate(opts):
                    if opt == s:
                        terms.append(a[p][i][b])
                if s in w[p]:
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
    block_names = list(blocks.keys())
    total_cap = {
        b: {s: sum(caps) for s, caps in subjs.items()} for b, subjs in blocks.items()
    }
    a, w = _build(prob, students, block_names, known)

    # Forbid options / wildcards in blocks that don't offer the subject.
    for p, stu in enumerate(students):
        opts = _options(stu)
        for i, subj in enumerate(opts):
            for b in block_names:
                if subj not in blocks[b]:
                    prob += (a[p][i][b] == 0, f"noff_{p}_{i}_{b}")
        for s in w[p]:
            for b in block_names:
                if s not in blocks[b]:
                    prob += (w[p][s][b] == 0, f"wnoff_{p}_{s}_{b}")

    for b in block_names:
        for s, cap in total_cap[b].items():
            terms = []
            for p, stu in enumerate(students):
                opts = _options(stu)
                for i, opt in enumerate(opts):
                    if opt == s:
                        terms.append(a[p][i][b])
                if s in w[p]:
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
        opts = _options(stu)
        n_choices = int(stu.get("n_choices", len(opts)))
        assignment: dict[str, str] = {}
        used_backup = used_wildcard = False
        for b in block_names:
            picked = None
            for i in range(len(opts)):
                if (pulp.value(a[p][i][b]) or 0) > 0.5:
                    picked = opts[i]
                    if i >= n_choices:
                        used_backup = True
                    break
            if picked is None:
                for s in w[p]:
                    if (pulp.value(w[p][s][b]) or 0) > 0.5:
                        picked = s
                        used_wildcard = True
                        break
            assignment[b] = picked if picked is not None else "?"
        if used_backup or used_wildcard:
            dropped = [
                opts[i] for i in range(n_choices) if opts[i] not in assignment.values()
            ]
            backup_users.append(
                {
                    "name": stu["name"],
                    "dropped": dropped[0] if dropped else "?",
                    "backup": next(
                        (s for b, s in assignment.items() if s not in opts[:n_choices]),
                        "?",
                    ),
                    "is_wildcard": used_wildcard,
                }
            )
        student_block_map[stu["name"]] = assignment
    return student_block_map, backup_users
