import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, ApiError, type StudentTimetable } from "../lib/api";
import ChoiceFields from "../components/ChoiceFields";
import { checkRules } from "../lib/rules";

export default function StudentTimetablePage() {
  const { id } = useParams<{ id: string }>();
  const [tt, setTt] = useState<StudentTimetable | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      setTt(await api.get<StudentTimetable>(`/student/timetable/${id}`));
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <p className="text-slate-400">Loading…</p>;
  if (err || !tt) return <p className="text-red-600">{err ?? "Not found"}</p>;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <Link to="/student" className="text-sm text-slate-400 hover:text-brand-600">
          ← Your timetables
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">{tt.name}</h1>
        {tt.deadline && (
          <p className="text-sm text-slate-400">
            Deadline: {new Date(tt.deadline).toLocaleDateString()}
          </p>
        )}
      </div>

      {tt.finalised ? (
        <AssignmentView tt={tt} reload={load} />
      ) : tt.submitted ? (
        <SubmittedView tt={tt} />
      ) : tt.deadline_passed ? (
        <div className="card text-center text-red-600">
          The deadline for this timetable has passed — choices are closed.
        </div>
      ) : (
        <ChoiceForm tt={tt} reload={load} />
      )}
    </div>
  );
}

function ChoiceForm({ tt, reload }: { tt: StudentTimetable; reload: () => void }) {
  const subjects = tt.subjects.map((s) => s.subject);
  const [choices, setChoices] = useState<string[]>(
    Array.from({ length: tt.options_required }, (_, i) => tt.my_choices[i] ?? ""),
  );
  const [backups, setBackups] = useState<string[]>(
    Array.from({ length: tt.backups_allowed }, (_, i) => tt.my_backups[i] ?? ""),
  );
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const picked = choices.filter(Boolean);
    if (picked.length !== tt.options_required) {
      setErr(`Please rank ${tt.options_required} distinct choices.`);
      return;
    }
    const violations = checkRules(tt.rules, picked);
    if (violations.length) {
      setErr(violations.join("; "));
      return;
    }
    setBusy(true);
    try {
      await api.post(`/student/timetable/${tt.timetable_id}/submit`, {
        choices: picked,
        backups: backups.filter(Boolean),
      });
      reload();
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : "Submit failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card space-y-4">
      <p className="text-sm text-slate-500">
        Rank your {tt.options_required} subject choices in order of preference. Backups
        are used only if a choice can’t be placed.
      </p>
      <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">
        Once submitted you can’t change your choices, so check carefully.
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
      <button className="btn-primary w-full" disabled={busy}>
        {busy ? "Submitting…" : "Submit my choices"}
      </button>
    </form>
  );
}

function SubmittedView({ tt }: { tt: StudentTimetable }) {
  return (
    <div className="card space-y-3">
      <p className="text-emerald-600">✓ Your choices are submitted.</p>
      <ol className="list-inside list-decimal text-sm text-slate-600">
        {tt.my_choices.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ol>
      {tt.my_backups.length > 0 && (
        <p className="text-sm text-slate-400">
          Backups: {tt.my_backups.join(", ")}
        </p>
      )}
      <p className="text-sm text-slate-400">
        Waiting for your teacher to finalise the timetable.
      </p>
    </div>
  );
}

function AssignmentView({ tt, reload }: { tt: StudentTimetable; reload: () => void }) {
  const blocks = tt.my_assignment ? Object.keys(tt.my_assignment).sort() : [];
  const [busyBlock, setBusyBlock] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const moved =
    tt.initial_assignment && tt.my_assignment
      ? blocks.filter((b) => tt.initial_assignment![b] !== tt.my_assignment![b])
      : [];

  async function swap(block: string, subject: string) {
    setErr(null);
    setBusyBlock(block);
    try {
      await api.post(`/student/timetable/${tt.timetable_id}/reassign`, {
        block,
        subject,
      });
      reload();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Swap failed");
    } finally {
      setBusyBlock(null);
    }
  }

  return (
    <div className="card space-y-4">
      <h2 className="font-semibold">Your timetable</h2>
      <div className="space-y-2">
        {blocks.map((b) => {
          const swaps = tt.available_swaps?.[b] ?? [];
          const changed = moved.includes(b);
          return (
            <div key={b} className="rounded-lg bg-slate-50 p-3">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-xs uppercase text-slate-400">Block {b}</span>
                  <div className="font-medium">
                    {tt.my_assignment![b]}
                    {changed && (
                      <span className="ml-2 text-xs text-blue-600">
                        (was {tt.initial_assignment![b]})
                      </span>
                    )}
                  </div>
                </div>
              </div>
              {tt.reassignment_enabled && swaps.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  <span className="self-center text-xs text-slate-400">Swap to:</span>
                  {swaps.map((s) => (
                    <button
                      key={s.subject}
                      className="btn-ghost px-2 py-1 text-xs"
                      disabled={busyBlock === b}
                      onClick={() => swap(b, s.subject)}
                    >
                      {s.subject} ({s.free} free)
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {err && <p className="text-sm text-red-600">{err}</p>}
      {tt.reassignment_enabled ? (
        <p className="text-xs text-slate-400">
          Your teacher has opened reassignment — you can swap into any class with free
          space in the same block. Your original allocation is kept on record.
        </p>
      ) : (
        <p className="text-xs text-slate-400">This is your final allocation.</p>
      )}
    </div>
  );
}
