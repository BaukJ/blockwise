import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError, type Timetable } from "../lib/api";

export default function CloneModal({
  tt,
  onClose,
}: {
  tt: Timetable;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const [name, setName] = useState(`Copy of ${tt.name}`);
  const [subjects, setSubjects] = useState(true);
  const [students, setStudents] = useState(false);
  const [choices, setChoices] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Choices require both students and subjects.
  const canChoices = students && subjects;

  async function clone() {
    setErr(null);
    setBusy(true);
    try {
      const created = await api.post<Timetable>(`/timetable/${tt.id}/clone`, {
        name: name.trim() || `Copy of ${tt.name}`,
        include_subjects: subjects,
        include_students: students,
        include_choices: choices && canChoices,
      });
      navigate(`/teacher/timetable/${created.id}`);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Clone failed");
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-20 grid place-items-center bg-black/30 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md space-y-4 rounded-xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-semibold">Clone “{tt.name}”</h3>
        <label className="block text-sm">
          <span className="mb-1 block text-slate-500">New name</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <p className="text-xs text-slate-400">
          Blocks, choices/backups settings and rules are always copied.
        </p>
        <div className="space-y-2">
          <CloneCheck checked={subjects} onChange={setSubjects} label="Subjects" />
          <CloneCheck checked={students} onChange={setStudents} label="Students (roster)" />
          <CloneCheck
            checked={choices && canChoices}
            onChange={setChoices}
            disabled={!canChoices}
            label="Student choices"
            hint="Needs subjects and students"
          />
        </div>
        {err && <p className="text-sm text-red-600">{err}</p>}
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" onClick={clone} disabled={busy}>
            {busy ? "Cloning…" : "Clone"}
          </button>
        </div>
      </div>
    </div>
  );
}

function CloneCheck({
  checked,
  onChange,
  disabled,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  label: string;
  hint?: string;
}) {
  return (
    <label className={`flex items-start gap-2 text-sm ${disabled ? "opacity-40" : ""}`}>
      <input
        type="checkbox"
        className="mt-0.5"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        {label}
        {hint && <span className="block text-xs text-slate-400">{hint}</span>}
      </span>
    </label>
  );
}
