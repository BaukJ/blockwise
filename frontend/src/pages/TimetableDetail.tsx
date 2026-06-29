import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  api,
  type Entry,
  type Progress,
  type Subject,
  type Timetable,
} from "../lib/api";
import Processing from "../components/Processing";

export default function TimetableDetail() {
  const { id } = useParams<{ id: string }>();
  const [tt, setTt] = useState<Timetable | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [loading, setLoading] = useState(true);

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
      <div>
        <Link to="/teacher" className="text-sm text-slate-400 hover:text-brand-600">
          ← All timetables
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">{tt.name}</h1>
      </div>

      <SettingsCard tt={tt} onSaved={load} />
      <SubjectsCard tt={tt} onSaved={load} />
      <StudentsCard tt={tt} entries={entries} progress={progress} onChanged={load} />
      <Processing tt={tt} />
    </div>
  );
}

// ── Settings ─────────────────────────────────────────────────────────────────
function SettingsCard({ tt, onSaved }: { tt: Timetable; onSaved: () => void }) {
  const [name, setName] = useState(tt.name);
  const [numBlocks, setNumBlocks] = useState(tt.num_blocks);
  const [deadline, setDeadline] = useState(tt.deadline?.slice(0, 10) ?? "");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    await api.patch(`/timetable/${tt.id}`, {
      name,
      num_blocks: numBlocks,
      deadline: deadline ? new Date(deadline).toISOString() : null,
    });
    setSaving(false);
    onSaved();
  }

  return (
    <div className="card space-y-4">
      <h2 className="font-semibold">Settings</h2>
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="block text-sm">
          <span className="mb-1 block text-slate-500">Name</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-slate-500">Blocks</span>
          <input
            className="input"
            type="number"
            min={1}
            max={10}
            value={numBlocks}
            onChange={(e) => setNumBlocks(Number(e.target.value))}
          />
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

  function update(i: number, patch: Partial<Subject>) {
    setRows((r) => r.map((row, j) => (j === i ? { ...row, ...patch } : row)));
  }
  function add() {
    setRows((r) => [...r, { subject: "", total_classes: 1, class_capacity: 30 }]);
  }
  function remove(i: number) {
    setRows((r) => r.filter((_, j) => j !== i));
  }
  async function save() {
    setSaving(true);
    await api.patch(`/timetable/${tt.id}`, {
      subjects: rows.filter((r) => r.subject.trim()),
    });
    setSaving(false);
    onSaved();
  }
  async function importCsv() {
    await api.post(`/timetable/${tt.id}/subjects/csv`, { csv_text: csv });
    setCsv("");
    setCsvOpen(false);
    onSaved();
  }

  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Subjects</h2>
        <button className="text-sm text-brand-600" onClick={() => setCsvOpen((o) => !o)}>
          Import CSV
        </button>
      </div>

      {csvOpen && (
        <div className="space-y-2 rounded-lg bg-slate-50 p-3">
          <p className="text-xs text-slate-500">
            Columns: <code>subject, total_classes, class_capacity</code>
          </p>
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
        <div className="grid grid-cols-[1fr_6rem_6rem_2rem] gap-2 text-xs text-slate-400">
          <span>Subject</span>
          <span>Classes</span>
          <span>Capacity</span>
          <span />
        </div>
        {rows.map((row, i) => (
          <div key={i} className="grid grid-cols-[1fr_6rem_6rem_2rem] gap-2">
            <input
              className="input"
              value={row.subject}
              onChange={(e) => update(i, { subject: e.target.value })}
            />
            <input
              className="input"
              type="number"
              min={1}
              value={row.total_classes}
              onChange={(e) => update(i, { total_classes: Number(e.target.value) })}
            />
            <input
              className="input"
              type="number"
              min={1}
              value={row.class_capacity}
              onChange={(e) => update(i, { class_capacity: Number(e.target.value) })}
            />
            <button
              className="text-slate-400 hover:text-red-600"
              onClick={() => remove(i)}
              aria-label="Remove"
            >
              ✕
            </button>
          </div>
        ))}
        {rows.length === 0 && (
          <p className="text-sm text-slate-400">No subjects yet.</p>
        )}
      </div>

      <div className="flex gap-2">
        <button className="btn-ghost" onClick={add}>
          + Add subject
        </button>
        <button className="btn-primary" onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save subjects"}
        </button>
      </div>
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

  return (
    <div className="card space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Students</h2>
        {progress && (
          <span className="text-sm text-slate-400">
            {progress.submitted}/{progress.total} submitted
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
        <UiEntry tt={tt} subjects={subjects} entries={entries} onChanged={onChanged} onDelete={deleteEntry} />
      )}
      {mode === "csv" && <CsvEntry tt={tt} entries={entries} onChanged={onChanged} onDelete={deleteEntry} />}
      {mode === "students" && (
        <EmailEntry tt={tt} entries={entries} progress={progress} onChanged={onChanged} onDelete={deleteEntry} />
      )}
    </div>
  );
}

function EntryTable({
  entries,
  onDelete,
}: {
  entries: Entry[];
  onDelete: (key: string) => void;
}) {
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
          <th />
        </tr>
      </thead>
      <tbody>
        {entries.map((e) => (
          <tr key={e.student_key} className="border-t border-slate-100">
            <td className="py-1.5">{e.name}</td>
            <td className="text-slate-500">{e.choices.join(", ") || "—"}</td>
            <td className="text-slate-500">{e.backup || "—"}</td>
            <td>
              {e.submitted ? (
                <span className="text-emerald-600">✓ submitted</span>
              ) : (
                <span className="text-amber-500">pending</span>
              )}
            </td>
            <td className="text-right">
              <button
                className="text-slate-300 hover:text-red-600"
                onClick={() => onDelete(e.student_key)}
              >
                ✕
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function UiEntry({
  tt,
  subjects,
  entries,
  onChanged,
  onDelete,
}: {
  tt: Timetable;
  subjects: string[];
  entries: Entry[];
  onChanged: () => void;
  onDelete: (key: string) => void;
}) {
  const [name, setName] = useState("");
  const [choices, setChoices] = useState<string[]>(["", "", "", ""]);
  const [backup, setBackup] = useState("");

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    await api.post(`/timetable/${tt.id}/entries`, {
      name: name.trim(),
      choices: choices.filter(Boolean),
      backup: backup || null,
    });
    setName("");
    setChoices(["", "", "", ""]);
    setBackup("");
    onChanged();
  }

  return (
    <div className="space-y-4">
      <EntryTable entries={entries} onDelete={onDelete} />
      <form onSubmit={add} className="grid gap-2 rounded-lg bg-slate-50 p-3 sm:grid-cols-6">
        <input
          className="input sm:col-span-1"
          placeholder="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        {[0, 1, 2, 3].map((i) => (
          <select
            key={i}
            className="input"
            value={choices[i]}
            onChange={(e) =>
              setChoices((c) => c.map((v, j) => (j === i ? e.target.value : v)))
            }
          >
            <option value="">Choice {i + 1}</option>
            {subjects.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        ))}
        <select
          className="input"
          value={backup}
          onChange={(e) => setBackup(e.target.value)}
        >
          <option value="">Backup</option>
          {subjects.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <button className="btn-primary sm:col-span-6">+ Add student</button>
      </form>
    </div>
  );
}

function CsvEntry({
  tt,
  entries,
  onChanged,
  onDelete,
}: {
  tt: Timetable;
  entries: Entry[];
  onChanged: () => void;
  onDelete: (key: string) => void;
}) {
  const [csv, setCsv] = useState("");

  async function importCsv() {
    await api.post(`/timetable/${tt.id}/entries/csv`, { csv_text: csv });
    setCsv("");
    onChanged();
  }
  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    file.text().then(setCsv);
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2 rounded-lg bg-slate-50 p-3">
        <p className="text-xs text-slate-500">
          Columns: <code>student_name, choice1, choice2, choice3, choice4, backup</code>
        </p>
        <input type="file" accept=".csv" onChange={onFile} className="text-sm" />
        <textarea
          className="input h-32 font-mono text-xs"
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
          placeholder={"student_name,choice1,choice2,choice3,choice4,backup\nAlice,Maths,Art,,,"}
        />
        <button className="btn-primary" onClick={importCsv} disabled={!csv.trim()}>
          Import students
        </button>
      </div>
      <EntryTable entries={entries} onDelete={onDelete} />
    </div>
  );
}

function EmailEntry({
  tt,
  entries,
  progress,
  onChanged,
  onDelete,
}: {
  tt: Timetable;
  entries: Entry[];
  progress: Progress | null;
  onChanged: () => void;
  onDelete: (key: string) => void;
}) {
  const [text, setText] = useState("");

  async function add() {
    const emails = text
      .split(/[\s,;]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (emails.length === 0) return;
    await api.post(`/timetable/${tt.id}/entries/emails`, { emails });
    setText("");
    onChanged();
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
          Paste student emails (comma, space or newline separated). They’ll fill in
          their own choices.
        </p>
        <textarea
          className="input h-24 text-sm"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="alice@school.edu, bob@school.edu"
        />
        <button className="btn-primary" onClick={add} disabled={!text.trim()}>
          Add students
        </button>
      </div>
      <EntryTable entries={entries} onDelete={onDelete} />
    </div>
  );
}
