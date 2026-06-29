# Blockwise

Timetable block-grouping optimiser. Teachers collect student subject choices, then
solve which subjects go in which block (and who sits in each class) with Integer
Linear Programming.

Three parts, mirroring the `tallio` layout:

- **`backend/`** — FastAPI on AWS Lambda (Mangum), DynamoDB via PynamoDB. Runs
  locally against DynamoDB Local in Docker.
- **`frontend/`** — Vite + React + TypeScript + Tailwind. Builds to static files
  served from S3 / CloudFront.
- **`terraform/`** — Lambda, worker Lambda, S3, CloudFront, DynamoDB, SES, Route53.

The solver itself lives in `backend/app/solver/`. The original command-line workflow
is preserved at `scripts/timetable.py`, which imports that same solver (see
`docs-solver.md` for the input/output formats):

```bash
cd examples
uv run ../scripts/timetable.py subjects.csv students.csv --output-dir out/
uv run ../scripts/timetable.py students.csv --blocks-csv out/blocks.csv --output-dir fixed/
```

## Run locally

```bash
cp env.example .env          # already done if .env exists
make dev                     # DynamoDB + backend in Docker (http://localhost:5000)
make frontend                # Vite dev server (http://localhost:5173), proxies /api
```

First time, create the tables:

```bash
curl localhost:5000/api/admin/create-tables
```

Open http://localhost:5173. Sign up with email/password — locally the verification
link is printed to the backend logs (`docker compose logs backend`).

### Production-like full stack

```bash
make full                    # builds frontend, serves via nginx on :80 + backend
```

## Auth

Email is the identity (no usernames). Sign up with email/password or Google. After
login you choose a teacher or student view; the choice is saved and switchable from
the header menu.

## Build status

Implemented so far:
- Pass 1: repo scaffold, auth (email/password + Google), role choice + switching,
  teacher timetable list/create, local run, static build.
- Pass 2: timetable detail page (settings, subjects editor, students), three choice
  entry modes (fill-in UI, CSV upload, student-email roster), subjects CSV import,
  roster progress tracking.
- Pass 3: ILP solver ported to `backend/app/solver/`, async processing jobs (auto,
  custom or reuse-previous block layouts), status polling, solution review + finalise.
  Runs inline locally; production offloads to a worker Lambda.
- Pass 4: student view — assigned timetables with status/deadlines, submit-once choice
  form, finalised allocation view, and teacher-toggled reassignment into classes with
  free space (original allocation kept on record).
- Pass 5: terraform — CloudFront (S3 + API Lambda origins), API Lambda + async solver
  worker Lambda, DynamoDB, SES, Route53. See `terraform/README.md` to deploy.

The refactor is feature-complete; see `terraform/README.md` for deployment.
