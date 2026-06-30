// In-memory fake backend for the /example showcase pages. No real API is hit; all
// state lives in a closure and resets on refresh. Shapes mirror the real endpoints.
import type { MockHandler } from "./api";

const TEACHER = "ms.taylor@example.school";
const STUDENT = "alex@example.school";

let counter = 1;
const uid = (p: string) => `${p}-${counter++}`;

interface Tt {
  id: string;
  owner: string;
  name: string;
  created_at: string;
  deadline: string | null;
  entry_mode: string;
  num_blocks: number;
  options_required: number;
  backups_allowed: number;
  subjects: { subject: string; capacities: number[] }[];
  rules: any[];
  finalised_job_id: string | null;
  reassignment_enabled: boolean;
}
interface Entry {
  timetable_id: string;
  student_key: string;
  student_email: string | null;
  name: string;
  choices: string[];
  backups: string[];
  status: string;
  submitted_at: string | null;
  assignment?: Record<string, string>;
  initial_assignment?: Record<string, string>;
}
interface Job {
  id: string;
  timetable_id: string;
  created_at: string;
  status: string;
  blocks_mode: string;
  error: string | null;
  result: any | null;
}

const READY = new Set(["submitted", "teacher_submitted"]);

function seed() {
  const now = new Date().toISOString();
  const subj = (subject: string, ...capacities: number[]) => ({ subject, capacities });

  const timetables: Tt[] = [
    {
      id: "tt-options",
      owner: TEACHER,
      name: "Year 10 Options 2026",
      created_at: now,
      deadline: null,
      entry_mode: "students",
      num_blocks: 4,
      options_required: 4,
      backups_allowed: 1,
      subjects: [
        subj("Maths", 30),
        subj("English", 30),
        subj("Science", 30, 30),
        subj("History", 30),
        subj("Geography", 30),
        subj("Art", 25),
        subj("Drama", 25),
        subj("Computing", 25),
      ],
      rules: [{ type: "require_one_of", subjects: ["History", "Geography"], min: 1 }],
      finalised_job_id: "job-solved",
      reassignment_enabled: true,
    },
    {
      id: "tt-taster",
      owner: TEACHER,
      name: "Year 9 Taster",
      created_at: now,
      deadline: null,
      entry_mode: "ui",
      num_blocks: 3,
      options_required: 3,
      backups_allowed: 1,
      subjects: [subj("Spanish", 28), subj("Music", 24), subj("PE", 30), subj("Art", 25)],
      rules: [],
      finalised_job_id: null,
      reassignment_enabled: false,
    },
    {
      id: "tt-gcse",
      owner: "other.teacher@example.school",
      name: "GCSE Options 2027",
      created_at: now,
      deadline: new Date(Date.now() + 1000 * 60 * 60 * 24 * 14).toISOString(),
      entry_mode: "students",
      num_blocks: 4,
      options_required: 4,
      backups_allowed: 2,
      subjects: [
        subj("Maths", 30),
        subj("English", 30),
        subj("Biology", 28),
        subj("Chemistry", 28),
        subj("French", 26),
        subj("Business", 26),
        subj("PE", 30),
      ],
      rules: [],
      finalised_job_id: null,
      reassignment_enabled: false,
    },
  ];

  const e = (
    timetable_id: string,
    name: string,
    email: string | null,
    status: string,
    choices: string[],
    backups: string[] = [],
  ): Entry => ({
    timetable_id,
    student_key: (email ?? name).toLowerCase(),
    student_email: email,
    name,
    choices,
    backups,
    status,
    submitted_at: READY.has(status) ? now : null,
  });

  const entries: Entry[] = [
    e("tt-options", "Alex Rivera", STUDENT, "submitted", ["Maths", "Science", "History", "Art"], ["Drama"]),
    e("tt-options", "Jordan Lee", "jordan@example.school", "submitted", ["English", "Maths", "Geography", "Computing"], ["Art"]),
    e("tt-options", "Sam Patel", "sam@example.school", "teacher_submitted", ["Science", "Maths", "Art", "Drama"]),
    e("tt-options", "Riley Quinn", "riley@example.school", "draft", ["Maths", "English"]),
    e("tt-options", "Casey Morgan", "casey@example.school", "pending", []),
    // Student-view-only assignment for Alex on a timetable still needing choices.
    e("tt-gcse", "Alex Rivera", STUDENT, "pending", []),
  ];

  const jobs: Job[] = [
    {
      id: "job-solved",
      timetable_id: "tt-options",
      created_at: now,
      status: "done",
      blocks_mode: "layout",
      error: null,
      result: {
        block_names: ["A", "B", "C", "D"],
        block_classes: {
          A: { Maths: [30], History: [30] },
          B: { English: [30], Science: [30] },
          C: { Science: [30], Geography: [30] },
          D: { Art: [25], Drama: [25], Computing: [25] },
        },
        student_block_map: {
          "Alex Rivera": { A: "Maths", B: "Science", C: "Geography", D: "Art" },
          "Jordan Lee": { A: "Maths", B: "English", C: "Geography", D: "Computing" },
          "Sam Patel": { A: "Maths", B: "Science", C: "Geography", D: "Art" },
        },
        backup_users: [],
      },
    },
  ];

  return { timetables, entries, jobs };
}

const serializeTt = (t: Tt) => ({ ...t });

export function createExampleHandler(): MockHandler {
  const db = seed();
  const tt = (id: string) => db.timetables.find((t) => t.id === id);
  const entriesOf = (id: string) => db.entries.filter((e) => e.timetable_id === id);
  const ready = (e: Entry) => READY.has(e.status);

  function statusForChoices(choices: string[], required: number, teacher: boolean) {
    const complete = choices.filter(Boolean).length >= required;
    if (complete) return teacher ? "teacher_submitted" : "submitted";
    return teacher ? "draft" : "pending";
  }

  // Trivial placement so "Run processing" produces a plausible solution from the
  // current subjects + ready students (not capacity-perfect — it's a demo).
  function solve(t: Tt): Job {
    const blocks = Array.from({ length: t.num_blocks }, (_, i) => String.fromCharCode(65 + i));
    const block_classes: Record<string, Record<string, number[]>> = {};
    blocks.forEach((b) => (block_classes[b] = {}));
    let bi = 0;
    for (const s of t.subjects)
      for (const cap of s.capacities) {
        const b = blocks[bi % blocks.length];
        (block_classes[b][s.subject] ??= []).push(cap);
        bi++;
      }
    const student_block_map: Record<string, Record<string, string>> = {};
    for (const e of entriesOf(t.id).filter(ready)) {
      const opts = [...e.choices, ...e.backups];
      const map: Record<string, string> = {};
      blocks.forEach((b, i) => (map[b] = opts[i] ?? opts[0] ?? "—"));
      student_block_map[e.name] = map;
    }
    const job: Job = {
      id: uid("job"),
      timetable_id: t.id,
      created_at: new Date().toISOString(),
      status: "done",
      blocks_mode: "layout",
      error: null,
      result: { block_names: blocks, block_classes, student_block_map, backup_users: [] },
    };
    db.jobs.push(job);
    return job;
  }

  function studentView(t: Tt, e: Entry) {
    const job = t.finalised_job_id ? db.jobs.find((j) => j.id === t.finalised_job_id) : null;
    let my_assignment: any = null;
    let available_swaps: any = null;
    let initial_assignment: any = null;
    if (job?.result) {
      const base = job.result.student_block_map[e.name] ?? {};
      my_assignment = e.assignment ?? base;
      initial_assignment = e.initial_assignment ?? base;
      if (t.reassignment_enabled) {
        // Free space = capacity - occupancy across the finalised map.
        const free: Record<string, Record<string, number>> = {};
        for (const [b, subjs] of Object.entries<any>(job.result.block_classes)) {
          free[b] = {};
          for (const [s, caps] of Object.entries<any>(subjs))
            free[b][s] = (caps as number[]).reduce((a, c) => a + c, 0);
        }
        for (const map of Object.values<any>(job.result.student_block_map))
          for (const [b, s] of Object.entries<any>(map)) if (free[b]?.[s] != null) free[b][s]--;
        available_swaps = {};
        for (const [b, cur] of Object.entries<any>(my_assignment)) {
          const opts = Object.entries(free[b] ?? {})
            .filter(([s, n]) => (n as number) > 0 && s !== cur)
            .map(([s, n]) => ({ subject: s, free: n }));
          if (opts.length) available_swaps[b] = opts;
        }
      }
    }
    return {
      timetable_id: t.id,
      name: t.name,
      deadline: t.deadline,
      subjects: t.subjects,
      num_blocks: t.num_blocks,
      options_required: t.options_required,
      backups_allowed: t.backups_allowed,
      rules: t.rules,
      my_choices: e.choices,
      my_backups: e.backups,
      submitted: ready(e),
      deadline_passed: !!(t.deadline && new Date(t.deadline) < new Date()),
      finalised: !!job,
      reassignment_enabled: t.reassignment_enabled,
      my_assignment,
      available_swaps,
      initial_assignment,
    };
  }

  return (method, rawPath, body: any) => {
    const path = rawPath.split("?")[0];
    const seg = path.split("/").filter(Boolean); // e.g. ["timetable","tt-x","entries"]

    // ── Auth (mostly handled by MockAuthProvider, but be safe) ──
    if (path === "/auth/me") return { email: TEACHER, active_role: "teacher", login_methods: ["password"], admin: false };
    if (path === "/auth/logout" || path === "/auth/role") return { ok: true };

    // ── Student endpoints ──
    if (path === "/student/timetables") {
      return db.entries
        .filter((e) => e.student_email === STUDENT)
        .map((e) => {
          const t = tt(e.timetable_id)!;
          return {
            timetable_id: t.id,
            name: t.name,
            deadline: t.deadline,
            submitted: ready(e),
            finalised: !!t.finalised_job_id,
            reassignment_enabled: t.reassignment_enabled,
          };
        });
    }
    if (seg[0] === "student" && seg[1] === "timetable") {
      const t = tt(seg[2])!;
      const e = db.entries.find((x) => x.timetable_id === seg[2] && x.student_email === STUDENT)!;
      if (seg[3] === "submit") {
        e.choices = body.choices;
        e.backups = body.backups ?? [];
        e.status = "submitted";
        e.submitted_at = new Date().toISOString();
      } else if (seg[3] === "reassign") {
        const base = studentView(t, e).my_assignment ?? {};
        e.initial_assignment = e.initial_assignment ?? { ...base };
        e.assignment = { ...base, [body.block]: body.subject };
      }
      return studentView(t, e);
    }

    // ── Jobs ──
    if (seg[0] === "jobs") return db.jobs.find((j) => j.id === seg[1]);

    // ── Timetable collection ──
    if (path === "/timetable") {
      if (method === "POST") {
        const t: Tt = {
          id: uid("tt"),
          owner: TEACHER,
          name: body.name,
          created_at: new Date().toISOString(),
          deadline: body.deadline ?? null,
          entry_mode: body.entry_mode ?? "ui",
          num_blocks: body.num_blocks ?? 4,
          options_required: 4,
          backups_allowed: 1,
          subjects: [],
          rules: [],
          finalised_job_id: null,
          reassignment_enabled: false,
        };
        db.timetables.push(t);
        return serializeTt(t);
      }
      return db.timetables.filter((t) => t.owner === TEACHER).map(serializeTt);
    }

    // ── Single timetable + sub-resources ──
    if (seg[0] === "timetable") {
      const t = tt(seg[1]);
      if (!t) return method === "GET" ? {} : { ok: true };

      // /timetable/:id
      if (seg.length === 2) {
        if (method === "DELETE") {
          db.timetables = db.timetables.filter((x) => x.id !== t.id);
          db.entries = db.entries.filter((x) => x.timetable_id !== t.id);
          return { ok: true };
        }
        if (method === "PATCH") {
          Object.assign(t, body);
          return serializeTt(t);
        }
        return serializeTt(t);
      }

      const sub = seg[2];
      if (sub === "entries") {
        if (seg.length === 3) {
          if (method === "POST") {
            const key = (body.student_email || body.name).toLowerCase();
            const existing = db.entries.find((x) => x.timetable_id === t.id && x.student_key === key);
            const choices = (body.choices ?? []).filter(Boolean);
            const next: Entry = {
              timetable_id: t.id,
              student_key: key,
              student_email: body.student_email ?? null,
              name: body.name,
              choices,
              backups: (body.backups ?? []).filter(Boolean),
              status: statusForChoices(choices, t.options_required, true),
              submitted_at: null,
            };
            if (existing) Object.assign(existing, next);
            else db.entries.push(next);
            return next;
          }
          return entriesOf(t.id);
        }
        const key = decodeURIComponent(seg[3]);
        const entry = db.entries.find((x) => x.timetable_id === t.id && x.student_key === key)!;
        if (seg[4] === "revert") {
          entry.status = "draft";
          entry.submitted_at = null;
          return entry;
        }
        if (seg[4] === "magic-link")
          return { url: `${location.origin}/fill?token=example-demo-token`, emailed: !!entry.student_email };
        if (method === "PATCH") {
          entry.choices = (body.choices ?? []).filter(Boolean);
          entry.backups = (body.backups ?? []).filter(Boolean);
          entry.status = statusForChoices(entry.choices, t.options_required, true);
          return entry;
        }
        if (method === "DELETE") {
          db.entries = db.entries.filter((x) => !(x.timetable_id === t.id && x.student_key === key));
          return { ok: true };
        }
      }

      if (sub === "subjects" && seg[3] === "csv") {
        const rows = parseCsv(body.csv_text);
        const grouped: Record<string, number[]> = {};
        const order: string[] = [];
        for (const r of rows) {
          const name = r.subject?.trim();
          if (!name) continue;
          if (!grouped[name]) {
            grouped[name] = [];
            order.push(name);
          }
          const cap = Number(r.class_capacity || 30);
          for (let i = 0; i < Number(r.total_classes || 1); i++) grouped[name].push(cap);
        }
        t.subjects = order.map((n) => ({ subject: n, capacities: grouped[n] }));
        return { ok: true, subjects: t.subjects };
      }

      if (sub === "entries" && seg[3] === "csv") return entriesOf(t.id);

      if (sub === "emails") {
        for (const addr of body.emails ?? []) {
          const key = String(addr).toLowerCase();
          if (!db.entries.some((x) => x.timetable_id === t.id && x.student_key === key))
            db.entries.push({
              timetable_id: t.id,
              student_key: key,
              student_email: key,
              name: key,
              choices: [],
              backups: [],
              status: "pending",
              submitted_at: null,
            });
        }
        return entriesOf(t.id);
      }

      if (sub === "progress") {
        const es = entriesOf(t.id);
        return {
          total: es.length,
          submitted: es.filter(ready).length,
          pending: es.filter((e) => !ready(e)).map((e) => e.name).sort(),
        };
      }

      if (sub === "jobs") return db.jobs.filter((j) => j.timetable_id === t.id).reverse();

      if (sub === "process") return solve(t);

      if (sub === "finalise") {
        t.finalised_job_id = body.job_id;
        return db.jobs.find((j) => j.id === body.job_id);
      }

      if (sub === "clone") {
        const clone: Tt = {
          ...t,
          id: uid("tt"),
          name: body.name,
          finalised_job_id: null,
          reassignment_enabled: false,
          subjects: body.include_subjects ? t.subjects.map((s) => ({ ...s })) : [],
          rules: body.include_subjects ? [...t.rules] : [],
        };
        db.timetables.push(clone);
        return serializeTt(clone);
      }
    }

    // Anything not modelled: harmless empty success.
    return method === "GET" ? [] : { ok: true };
  };
}

// Minimal CSV → array of row objects.
function parseCsv(text: string): Record<string, string>[] {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const headers = lines[0].split(",").map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cells = line.split(",");
    const row: Record<string, string> = {};
    headers.forEach((h, i) => (row[h] = (cells[i] ?? "").trim()));
    return row;
  });
}
