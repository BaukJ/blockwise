# Blockwise

A timetable block-grouping optimizer that uses Integer Linear Programming (ILP) to assign students to subject blocks while minimising backup-choice usage.

## What it does

Given a list of subjects (with class capacities) and students (with ranked preferences), Blockwise decides:

1. **Auto mode** — which subjects go in which of 4 blocks (A–D) *and* assigns each student to one subject per block.
2. **Fixed-blocks mode** — takes a predetermined block layout and only solves the student assignment.

The solver guarantees each student's first two choices are always honoured and minimises how many students fall back to their backup (5th) choice.

## Requirements

- Python ≥ 3.10
- [uv](https://docs.astral.sh/uv/) (handles dependencies automatically via inline script metadata)

Dependencies (installed automatically by `uv run`):
- `pulp` — ILP modelling
- `highspy` — HiGHS solver backend
- `pyyaml` — YAML output

## Usage

```bash
# Auto mode (default) — reads subjects.csv + students.csv from cwd
uv run timetable.py

# Explicit file paths
uv run timetable.py subjects.csv students.csv

# Fixed-blocks mode — block layout is pre-determined
uv run timetable.py students.csv --blocks-csv blocks.csv

# Output to a specific directory (creates it if needed)
uv run timetable.py --output-dir results/

# Tuning
uv run timetable.py --time-limit 600 --threads 8 --duplicate-backup=ignore
```

## Input format

### subjects.csv

| subject | total_classes | class_capacity |
|---------|--------------|----------------|
| Maths   | 2            | 30             |
| English | 1            | 35             |

- Each row contributes `total_classes` parallel classes of `class_capacity`.
- Repeat a subject on multiple rows to declare classes of different sizes.
- Lines starting with `#` are treated as comments.

### students.csv

| student_name | choice1 | choice2 | choice3 | choice4 | backup |
|--------------|---------|---------|---------|---------|--------|
| Alice Smith  | Maths   | English | Art     | Music   | Drama  |

- `backup` may be left empty — the solver will pick any available subject if needed (wildcard mode).

### blocks.csv (fixed-blocks mode only)

| block   | subject | child_limit |
|---------|---------|-------------|
| Block_A | Maths   | 30          |
| Block_A | Maths   | 30          |

- One row per parallel class. Repeat `(block, subject)` for multiple classes.

## Output

| File | Description |
|------|-------------|
| `timetable.csv` | Block layout — columns are blocks, rows are subjects |
| `timetable.yaml` | Full solution with class rosters |
| `blocks.csv` | Solved block layout (re-usable as `--blocks-csv` input) |
| `student_timetable.csv` | Per-student view: each choice and which block it landed in |
| `run.log` | Solver parameters and summary (when using `--output-dir`) |

## Options

| Flag | Default | Description |
|------|---------|-------------|
| `--out-csv` | `timetable.csv` | Output CSV path |
| `--out-yaml` | `timetable.yaml` | Output YAML path |
| `--output-dir` | — | Write all outputs into this directory |
| `--blocks-csv` | — | Use fixed block layout |
| `--time-limit` | 300 | Solver time limit in seconds |
| `--threads` | all cores | Solver threads |
| `--duplicate-backup` | `error` | `error` / `ignore` / `any` — handling when backup duplicates a choice |

## Examples

See the `examples/` directory for sample input files with 150 students and 20 subjects.

```bash
cd examples
uv run ../timetable.py subjects.csv students.csv --output-dir output/
```
