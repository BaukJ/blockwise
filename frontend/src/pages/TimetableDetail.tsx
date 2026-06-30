import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  api,
  ApiError,
  type Entry,
  type EntryStatus,
  type Progress,
  type Rule,
  type Subject,
  type Timetable,
} from "../lib/api";
import Processing from "../components/Processing";
import ChoiceFields from "../components/ChoiceFields";
import CloneModal from "../components/CloneModal";
import { checkRules } from "../lib/rules";

function readFile(e: React.ChangeEvent<HTMLInputElement>, onText: (t: string) => void) {
  const file = e.target.files?.[0];
  if (file) file.text().then(onText);
}

export default function TimetableDetail() {
  const { id } = useParams<{ id: string }>();
  const [tt, setTt] = useState<Timetable | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [loading, setLoading] = useState(true);
  const [cloning, setCloning] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    const [t, e, p] = await Promise.all([
      api.get<Timetable>(`/timetable/${id}`),
      api.get<Entry[]>(`/timetable/${id}/entries`),
      api.get<Progress>(`/timetable/${id}/progress`),
    ]);
    setTt(t);
    setEntries(e);
    setProgress(p);
    setLoading(false);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading || !tt) return <p className="text-slate-400">Loading…</p>;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <Link to="/teacher" className="text-sm text-slate-400 hover:text-brand-600">
            ← All timetables
          </Link>
          <h1 className="mt-1 text-2xl font-semibold">{tt.name}</h1>
        </div>
        <button className="btn-ghost" onClick={() => setCloning(true)}>
          Clone
        </button>
      </div>

      <SettingsCard tt={tt} onSaved={load} />
      <SubjectsCard tt={tt} onSaved={load} />
      <RulesCard tt={tt} onSaved={load} />
      <StudentsCard tt={tt} entries={entries} progress={progress} onChanged={load} />
      <Processing tt={tt} onTimetableChange={load} />

      {cloning && <CloneModal tt={tt} onClose={() => setCloning(false)} />}
    </div>
  );
}

// ── Settings ─────────────────────────────────────────────────────────────────
function SettingsCard({ tt, onSaved }: { tt: Timetable; onSaved: () => void }) {
  const [name, setName] = useState(tt.name);
  const [numBlocks, setNumBlocks] = useState(tt.num_blocks);
  const [optionsRequired, setOptionsRequired] = useState(tt.options_required);
  const [backupsAllowed, setBackupsAllowed] = useState(tt.backups_allowed);
  const [deadline, setDeadline] = useState(tt.deadline?.slice(0, 10) ?? "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setErr(null);
    setSaving(true);
    try {
      await api.patch(`/timetable/${tt.id}`, {
        name,
        num_blocks: numBlocks,
        options_required: optionsRequired,
        backups_allowed: backupsAllowed,
        deadline: deadline ? new Date(deadline).toISOString() : null,
      });
      onSaved();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card space-y-4">
      <h2 className="font-semibold">Settings</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="mb-1 block text-slate-500">Name</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-slate-500">Deadline</span>
          <input
            className="input"
            type="date"
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
          />
        </label>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="block text-sm">
          <span className="mb-1 block text-slate-500">Blocks</span>
          <input
            className="input"
            type="number"
            min={1}
            max={8}
            value={numBlocks}
            onChange={(e) => setNumBlocks(Number(e.target.value))}
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-slate-500">Choices per student</span>
          <input
            className="input"
            type="number"
            min={1}
            max={numBlocks}
            value={optionsRequired}
            onChange={(e) => setOptionsRequired(Number(e.target.value))}
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-slate-500">Backups allowed</span>
          <input
            className="input"
            type="number"
            min={0}
            max={8}
            value={backupsAllowed}
            onChange={(e) => setBackupsAllowed(Number(e.target.value))}
          />
        </label>
      </div>
      <p className="text-xs text-slate-400">
        Choices per student can’t exceed the number of blocks.
      </p>
      {err && <p className="text-sm text-red-600">{err}</p>}
      <button className="btn-primary" onClick={save} disabled={saving}>
        {saving ? "Saving…" : "Save settings"}
      </button>
    </div>
  );
}

// ── Subjects ─────────────────────────────────────────────────────────────────
function SubjectsCard({ tt, onSaved }: { tt: Timetable; onSaved: () => void }) {
  const [rows, setRows] = useState<Subject[]>(tt.subjects);
  const [csvOpen, setCsvOpen] = useState(false);
  const [csv, setCsv] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [defaultCapacity, setDefaultCapacity] = useState(30);
  const nameRefs = useRef<(HTMLInputElement | null)[]>([]);
  const POPULAR = ["Maths", "English", "Science"];

  function setName(i: number, subject: string) {
    setRows((r) => r.map((row, j) => (j === i ? { ...row, subject } : row)));
  }
  function setCapacity(i: number, k: number, value: number) {
    setRows((r) =>
      r.map((row, j) =>
        j === i
          ? { ...row, capacities: row.capacities.map((c, m) => (m === k ? value : c)) }
          : row,
      ),
    );
  }
  function addCapacity(i: number) {
    setRows((r) =>
      r.map((row, j) =>
        j === i
          ? {
              ...row,
              // New class defaults to this subject's last class size.
              capacities: [
                ...row.capacities,
                row.capacities[row.capacities.length - 1] ?? defaultCapacity,
              ],
            }
          : row,
      ),
    );
  }
  function removeCapacity(i: number, k: number) {
    setRows((r) =>
      r.map((row, j) =>
        j === i
          ? { ...row, capacities: row.capacities.filter((_, m) => m !== k) }
          : row,
      ),
    );
  }
  function addSubject(name = "") {
    const newIndex = rows.length;
    setRows((r) => [...r, { subject: name, capacities: [defaultCapacity] }]);
    if (!name) requestAnimationFrame(() => nameRefs.current[newIndex]?.focus());
  }
  function removeSubject(i: number) {
    setRows((r) => r.filter((_, j) => j !== i));
  }
  function addPopular(name: string) {
    if (rows.some((r) => r.subject.trim().toLowerCase() === name.toLowerCase())) return;
    addSubject(name);
  }

  async function save() {
    setErr(null);
    const named = rows.filter((r) => r.subject.trim());
    const lower = named.map((r) => r.subject.trim().toLowerCase());
    const dup = lower.find((n, i) => lower.indexOf(n) !== i);
    if (dup) {
      setErr(`Duplicate subject "${dup}". Use "+ capacity" for differently-sized classes.`);
      return;
    }
    setSaving(true);
    try {
      await api.patch(`/timetable/${tt.id}`, { subjects: named });
      onSaved();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }
  async function importCsv() {
    await api.post(`/timetable/${tt.id}/subjects/csv`, { csv_text: csv });
    setCsv("");
    setCsvOpen(false);
    onSaved();
  }

  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="font-semibold">Subjects</h2>
          <label className="flex items-center gap-1 text-xs text-slate-500">
            Default class size
            <input
              className="input w-16"
              type="number"
              min={1}
              value={defaultCapacity}
              onChange={(e) => setDefaultCapacity(Number(e.target.value))}
            />
          </label>
        </div>
        <button className="text-sm text-brand-600" onClick={() => setCsvOpen((o) => !o)}>
          Import CSV
        </button>
      </div>

      {csvOpen && (
        <div className="space-y-2 rounded-lg bg-slate-50 p-3">
          <p className="text-xs text-slate-500">
            Columns: <code>subject, total_classes, class_capacity</code>. Repeat a
            subject on multiple rows for differently-sized classes.
          </p>
          <input
            type="file"
            accept=".csv"
            className="text-sm"
            onChange={(e) => readFile(e, setCsv)}
          />
          <textarea
            className="input h-28 font-mono text-xs"
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
            placeholder={"subject,total_classes,class_capacity\nMaths,2,30"}
          />
          <button className="btn-primary" onClick={importCsv} disabled={!csv.trim()}>
            Import
          </button>
        </div>
      )}

      <div className="space-y-2">
        {rows.map((row, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <input
              className="input w-48"
              placeholder="Subject name"
              value={row.subject}
              ref={(el) => (nameRefs.current[i] = el)}
              onChange={(e) => setName(i, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addSubject();
                }
              }}
            />
            <span className="text-xs text-slate-400">classes:</span>
            {row.capacities.map((cap, k) => (
              <span key={k} className="inline-flex items-center">
                <input
                  className="input w-20"
                  type="number"
                  min={1}
                  value={cap}
                  onChange={(e) => setCapacity(i, k, Number(e.target.value))}
                />
                {row.capacities.length > 1 && (
                  <button
                    className="ml-1 text-slate-300 hover:text-red-600"
                    onClick={() => removeCapacity(i, k)}
                    aria-label="Remove class"
                  >
                    ✕
                  </button>
                )}
              </span>
            ))}
            <button
              className="text-xs text-brand-600 hover:underline"
              onClick={() => addCapacity(i)}
            >
              + class
            </button>
            <button
              className="ml-auto text-slate-400 hover:text-red-600"
              onClick={() => removeSubject(i)}
              aria-label="Remove subject"
            >
              ✕
            </button>
          </div>
        ))}
        {rows.length === 0 && (
          <p className="text-sm text-slate-400">No subjects yet.</p>
        )}
      </div>

      <p className="text-xs text-slate-400">
        Each box is one class and its size. A subject with two classes runs two
        parallel classes (e.g. Maths at 30 and 25).
      </p>
      {err && <p className="text-sm text-red-600">{err}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <button className="btn-ghost" onClick={() => addSubject()}>
          + Add subject
        </button>
        <button className="btn-primary" onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save subjects"}
        </button>
        <span className="ml-2 text-xs text-slate-400">Quick add:</span>
        {POPULAR.map((p) => (
          <button
            key={p}
            className="rounded-full px-2.5 py-1 text-xs text-slate-500 ring-1 ring-slate-200 hover:bg-slate-50"
            onClick={() => addPopular(p)}
          >
            + {p}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Rules (item 14) ──────────────────────────────────────────────────────────
function describeRule(r: Rule): string {
  if (r.type === "position_in")
    return `Choice ${r.position} must be one of: ${r.subjects.join(", ")}`;
  if (r.type === "require_one_of")
    return `Must pick at least ${r.min} of: ${r.subjects.join(", ")}`;
  return `${r.subjects.join(", ")} only allowed at choice ${r.positions.join(", ")}`;
}

function RulesCard({ tt, onSaved }: { tt: Timetable; onSaved: () => void }) {
  const subjects = tt.subjects.map((s) => s.subject);
  const [rules, setRules] = useState<Rule[]>(tt.rules);
  const [type, setType] = useState<Rule["type"]>("position_in");
  const [position, setPosition] = useState(1);
  const [picked, setPicked] = useState<string[]>([]);
  const [minCount, setMinCount] = useState(1);
  const [saving, setSaving] = useState(false);

  function toggle(s: string) {
    setPicked((p) => (p.includes(s) ? p.filter((x) => x !== s) : [...p, s]));
  }

  function addRule() {
    if (picked.length === 0) return;
    let rule: Rule;
    if (type === "position_in") rule = { type, position, subjects: picked };
    else if (type === "require_one_of") rule = { type, subjects: picked, min: minCount };
    else rule = { type: "only_at", subjects: picked, positions: [position] };
    setRules((r) => [...r, rule]);
    setPicked([]);
  }

  async function save() {
    setSaving(true);
    await api.patch(`/timetable/${tt.id}`, { rules });
    setSaving(false);
    onSaved();
  }

  return (
    <div className="card space-y-4">
      <h2 className="font-semibold">Choice rules</h2>
      {rules.length === 0 ? (
        <p className="text-sm text-slate-400">
          No rules — students can pick anything anywhere.
        </p>
      ) : (
        <ul className="space-y-1 text-sm">
          {rules.map((r, i) => (
            <li
              key={i}
              className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2"
            >
              <span>{describeRule(r)}</span>
              <button
                className="text-slate-300 hover:text-red-600"
                onClick={() => setRules((rs) => rs.filter((_, j) => j !== i))}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="space-y-3 rounded-lg bg-slate-50 p-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="mb-1 block text-slate-500">Rule</span>
            <select
              className="input"
              value={type}
              onChange={(e) => setType(e.target.value as Rule["type"])}
            >
              <option value="position_in">A choice must be one of…</option>
              <option value="require_one_of">Must include at least one of…</option>
              <option value="only_at">Subjects only allowed at a choice…</option>
            </select>
          </label>
          {(type === "position_in" || type === "only_at") && (
            <label className="text-sm">
              <span className="mb-1 block text-slate-500">Choice #</span>
              <input
                className="input w-20"
                type="number"
                min={1}
                max={tt.options_required}
                value={position}
                onChange={(e) => setPosition(Number(e.target.value))}
              />
            </label>
          )}
          {type === "require_one_of" && (
            <label className="text-sm">
              <span className="mb-1 block text-slate-500">At least</span>
              <input
                className="input w-20"
                type="number"
                min={1}
                value={minCount}
                onChange={(e) => setMinCount(Number(e.target.value))}
              />
            </label>
          )}
        </div>
        <div>
          <span className="mb-1 block text-xs text-slate-500">Subjects</span>
          <div className="flex flex-wrap gap-2">
            {subjects.length === 0 && (
              <span className="text-xs text-slate-400">Add subjects first.</span>
            )}
            {subjects.map((s) => (
              <button
                key={s}
                onClick={() => toggle(s)}
                className={`rounded-full px-3 py-1 text-xs ring-1 ${
                  picked.includes(s)
                    ? "bg-brand-600 text-white ring-brand-600"
                    : "bg-white text-slate-600 ring-slate-200"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
        <button className="btn-ghost" onClick={addRule} disabled={picked.length === 0}>
          + Add rule
        </button>
      </div>

      <button className="btn-primary" onClick={save} disabled={saving}>
        {saving ? "Saving…" : "Save rules"}
      </button>
    </div>
  );
}

// ── Students ─────────────────────────────────────────────────────────────────
const MODES = [
  { key: "ui", label: "Fill in here" },
  { key: "csv", label: "Upload CSV" },
  { key: "students", label: "Student emails" },
] as const;

function StudentsCard({
  tt,
  entries,
  progress,
  onChanged,
}: {
  tt: Timetable;
  entries: Entry[];
  progress: Progress | null;
  onChanged: () => void;
}) {
  const [mode, setMode] = useState(tt.entry_mode);
  const [editing, setEditing] = useState<Entry | null>(null);
  const [magic, setMagic] = useState<{ url: string; emailed: boolean } | null>(null);
  const subjects = tt.subjects.map((s) => s.subject);

  async function setEntryMode(m: typeof tt.entry_mode) {
    setMode(m);
    await api.patch(`/timetable/${tt.id}`, { entry_mode: m });
    onChanged();
  }

  async function deleteEntry(key: string) {
    await api.del(`/timetable/${tt.id}/entries/${encodeURIComponent(key)}`);
    onChanged();
  }

  async function revertEntry(key: string) {
    await api.post(`/timetable/${tt.id}/entries/${encodeURIComponent(key)}/revert`);
    onChanged();
  }

  async function magicLink(key: string) {
    const res = await api.post<{ url: string; emailed: boolean }>(
      `/timetable/${tt.id}/entries/${encodeURIComponent(key)}/magic-link`,
    );
    setMagic(res);
  }

  const actions = {
    onEdit: setEditing,
    onRevert: revertEntry,
    onDelete: deleteEntry,
    onMagicLink: magicLink,
  };

  return (
    <div className="card space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Students</h2>
        {progress && (
          <span className="text-sm text-slate-400">
            {progress.submitted}/{progress.total} ready
          </span>
        )}
      </div>

      <div className="flex gap-1 rounded-lg bg-slate-100 p-1 text-sm">
        {MODES.map((m) => (
          <button
            key={m.key}
            className={`flex-1 rounded-md px-3 py-1.5 ${
              mode === m.key ? "bg-white shadow-sm" : "text-slate-500"
            }`}
            onClick={() => setEntryMode(m.key)}
          >
            {m.label}
          </button>
        ))}
      </div>

      {mode === "ui" && (
        <UiEntry tt={tt} subjects={subjects} entries={entries} onChanged={onChanged} actions={actions} />
      )}
      {mode === "csv" && <CsvEntry tt={tt} entries={entries} onChanged={onChanged} actions={actions} />}
      {mode === "students" && (
        <EmailEntry tt={tt} entries={entries} progress={progress} onChanged={onChanged} actions={actions} />
      )}

      {editing && (
        <EditChoicesModal
          tt={tt}
          entry={editing}
          subjects={subjects}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            onChanged();
          }}
        />
      )}
      {magic && <MagicLinkModal {...magic} onClose={() => setMagic(null)} />}
    </div>
  );
}

interface EntryActions {
  onEdit: (e: Entry) => void;
  onRevert: (key: string) => void;
  onDelete: (key: string) => void;
  onMagicLink: (key: string) => void;
}

function MagicLinkModal({
  url,
  emailed,
  onClose,
}: {
  url: string;
  emailed: boolean;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div
      className="fixed inset-0 z-20 grid place-items-center bg-black/30 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md space-y-3 rounded-xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-semibold">One-time fill-in link</h3>
        <p className="text-sm text-slate-500">
          Valid for 7 days and only until the student submits. They won’t need to log
          in.{emailed && " It’s also been emailed to them."}
        </p>
        <div className="flex gap-2">
          <input className="input font-mono text-xs" readOnly value={url} />
          <button
            className="btn-primary"
            onClick={() => {
              navigator.clipboard?.writeText(url);
              setCopied(true);
            }}
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <div className="flex justify-end">
          <button className="btn-ghost" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

const STATUS_LABELS: Record<EntryStatus, { label: string; cls: string }> = {
  pending: { label: "Awaiting student", cls: "bg-amber-100 text-amber-700" },
  draft: { label: "Draft", cls: "bg-slate-100 text-slate-500" },
  submitted: { label: "Submitted", cls: "bg-emerald-100 text-emerald-700" },
  teacher_submitted: { label: "Teacher entered", cls: "bg-blue-100 text-blue-700" },
};

function StatusBadge({ status }: { status: EntryStatus }) {
  const s = STATUS_LABELS[status];
  return <span className={`rounded px-2 py-0.5 text-xs ${s.cls}`}>{s.label}</span>;
}

function EntryTable({ entries, actions }: { entries: Entry[]; actions: EntryActions }) {
  if (entries.length === 0)
    return <p className="text-sm text-slate-400">No students yet.</p>;
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-xs text-slate-400">
        <tr>
          <th className="py-1">Student</th>
          <th>Choices</th>
          <th>Backup</th>
          <th>Status</th>
          <th className="text-right">Actions</th>
        </tr>
      </thead>
      <tbody>
        {entries.map((e) => (
          <tr key={e.student_key} className="border-t border-slate-100">
            <td className="py-1.5">
              <span className="inline-flex items-center gap-1">
                {e.student_email && (
                  <span title="Added by email — fills in their own choices">✉️</span>
                )}
                {e.name}
              </span>
            </td>
            <td className="text-slate-500">{e.choices.join(", ") || "—"}</td>
            <td className="text-slate-500">{e.backups.join(", ") || "—"}</td>
            <td>
              <StatusBadge status={e.status} />
            </td>
            <td>
              <div className="flex justify-end gap-3 text-xs">
                <button
                  className="text-brand-600 hover:underline"
                  onClick={() => actions.onEdit(e)}
                >
                  Edit
                </button>
                {(e.status === "pending" || e.status === "draft") && (
                  <button
                    className="text-brand-600 hover:underline"
                    onClick={() => actions.onMagicLink(e.student_key)}
                  >
                    Magic link
                  </button>
                )}
                {(e.status === "submitted" || e.status === "teacher_submitted") && (
                  <button
                    className="text-slate-500 hover:underline"
                    onClick={() => actions.onRevert(e.student_key)}
                  >
                    Revert to draft
                  </button>
                )}
                <button
                  className="text-slate-300 hover:text-red-600"
                  onClick={() => actions.onDelete(e.student_key)}
                  aria-label="Delete"
                >
                  ✕
                </button>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// The choice editor a teacher gets — mirrors what a student sees when filling out.
function EditChoicesModal({
  tt,
  entry,
  subjects,
  onClose,
  onSaved,
}: {
  tt: Timetable;
  entry: Entry;
  subjects: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [choices, setChoices] = useState<string[]>(
    Array.from({ length: tt.options_required }, (_, i) => entry.choices[i] ?? ""),
  );
  const [backups, setBackups] = useState<string[]>(
    Array.from({ length: tt.backups_allowed }, (_, i) => entry.backups[i] ?? ""),
  );
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setErr(null);
    const filled = choices.filter(Boolean);
    if (filled.length === tt.options_required) {
      const violations = checkRules(tt.rules, filled);
      if (violations.length) {
        setErr(violations.join("; "));
        return;
      }
    }
    setBusy(true);
    try {
      await api.patch(
        `/timetable/${tt.id}/entries/${encodeURIComponent(entry.student_key)}`,
        { choices: filled, backups: backups.filter(Boolean) },
      );
      onSaved();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Save failed");
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-20 grid place-items-center bg-black/30 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md space-y-3 rounded-xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-semibold">Edit choices — {entry.name}</h3>
        <p className="text-xs text-slate-400">
          Fewer than {tt.options_required} choices saves as a draft.
        </p>
        <ChoiceFields
          subjects={subjects}
          optionsRequired={tt.options_required}
          backupsAllowed={tt.backups_allowed}
          rules={tt.rules}
          choices={choices}
          backups={backups}
          setChoices={setChoices}
          setBackups={setBackups}
        />
        {err && <p className="text-sm text-red-600">{err}</p>}
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" onClick={save} disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function UiEntry({
  tt,
  subjects,
  entries,
  onChanged,
  actions,
}: {
  tt: Timetable;
  subjects: string[];
  entries: Entry[];
  onChanged: () => void;
  actions: EntryActions;
}) {
  const empty = () => Array.from({ length: tt.options_required }, () => "");
  const emptyBackups = () => Array.from({ length: tt.backups_allowed }, () => "");
  const [name, setName] = useState("");
  const [choices, setChoices] = useState<string[]>(empty);
  const [backups, setBackups] = useState<string[]>(emptyBackups);
  const [err, setErr] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setErr(null);
    const filled = choices.filter(Boolean);
    if (filled.length === tt.options_required) {
      const violations = checkRules(tt.rules, filled);
      if (violations.length) {
        setErr(violations.join("; "));
        return;
      }
    }
    try {
      await api.post(`/timetable/${tt.id}/entries`, {
        name: name.trim(),
        choices: filled,
        backups: backups.filter(Boolean),
      });
      setName("");
      setChoices(empty());
      setBackups(emptyBackups());
      onChanged();
      // Ready for the next student straight away.
      requestAnimationFrame(() => nameRef.current?.focus());
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : "Could not add student");
    }
  }

  return (
    <div className="space-y-4">
      <EntryTable entries={entries} actions={actions} />
      <form onSubmit={add} className="space-y-3 rounded-lg bg-slate-50 p-3">
        <label className="block text-sm">
          <span className="mb-1 block text-slate-500">Student name</span>
          <input
            className="input"
            placeholder="Name"
            value={name}
            ref={nameRef}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <ChoiceFields
          subjects={subjects}
          optionsRequired={tt.options_required}
          backupsAllowed={tt.backups_allowed}
          rules={tt.rules}
          choices={choices}
          backups={backups}
          setChoices={setChoices}
          setBackups={setBackups}
        />
        {err && <p className="text-sm text-red-600">{err}</p>}
        <button className="btn-primary w-full">+ Add student</button>
      </form>
    </div>
  );
}

function CsvEntry({
  tt,
  entries,
  onChanged,
  actions,
}: {
  tt: Timetable;
  entries: Entry[];
  onChanged: () => void;
  actions: EntryActions;
}) {
  const [csv, setCsv] = useState("");
  const [err, setErr] = useState<string | null>(null);

  async function importCsv() {
    setErr(null);
    try {
      await api.post(`/timetable/${tt.id}/entries/csv`, { csv_text: csv });
      setCsv("");
      onChanged();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Import failed");
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2 rounded-lg bg-slate-50 p-3">
        <p className="text-xs text-slate-500">
          Columns: <code>student_name, choice1, choice2, choice3, choice4, backup</code>
        </p>
        <input type="file" accept=".csv" onChange={(e) => readFile(e, setCsv)} className="text-sm" />
        <textarea
          className="input h-32 font-mono text-xs"
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
          placeholder={"student_name,choice1,choice2,choice3,choice4,backup\nAlice,Maths,Art,,,"}
        />
        {err && <p className="text-sm text-red-600">{err}</p>}
        <button className="btn-primary" onClick={importCsv} disabled={!csv.trim()}>
          Import students
        </button>
      </div>
      <EntryTable entries={entries} actions={actions} />
    </div>
  );
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function EmailEntry({
  tt,
  entries,
  progress,
  onChanged,
  actions,
}: {
  tt: Timetable;
  entries: Entry[];
  progress: Progress | null;
  onChanged: () => void;
  actions: EntryActions;
}) {
  const [text, setText] = useState("");
  const [notify, setNotify] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  async function add() {
    setErr(null);
    const emails = text
      .split(/[\s,;]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (emails.length === 0) return;
    const invalid = emails.filter((e) => !EMAIL_RE.test(e));
    if (invalid.length) {
      setErr(`These don't look like valid emails: ${invalid.join(", ")}`);
      return;
    }
    try {
      await api.post(`/timetable/${tt.id}/entries/emails`, { emails, notify });
      setText("");
      onChanged();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not add students");
    }
  }

  const pct = progress && progress.total ? (progress.submitted / progress.total) * 100 : 0;

  return (
    <div className="space-y-4">
      {progress && progress.total > 0 && (
        <div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full bg-brand-600" style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-1 text-xs text-slate-400">
            {progress.submitted} of {progress.total} students have submitted
          </p>
        </div>
      )}
      <div className="space-y-2 rounded-lg bg-slate-50 p-3">
        <p className="text-xs text-slate-500">
          Paste student emails (comma, space or newline separated). Once a student
          signs up or logs in with the same email address, this timetable appears in
          their list and they can fill in their own choices.
        </p>
        <textarea
          className="input h-24 text-sm"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="alice@school.edu, bob@school.edu"
        />
        {err && <p className="text-sm text-red-600">{err}</p>}
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={notify}
              onChange={(e) => setNotify(e.target.checked)}
            />
            Email students an invite to sign up and fill in their choices
          </label>
          <button className="btn-primary" onClick={add} disabled={!text.trim()}>
            Add students
          </button>
        </div>
      </div>
      <EntryTable entries={entries} actions={actions} />
    </div>
  );
}
