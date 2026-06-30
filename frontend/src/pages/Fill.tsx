import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, ApiError, type PublicFill } from "../lib/api";
import ChoiceFields from "../components/ChoiceFields";
import { checkRules } from "../lib/rules";

// Public, no-login page reached via a teacher-issued magic link (?token=...).
export default function Fill() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const [data, setData] = useState<PublicFill | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [choices, setChoices] = useState<string[]>([]);
  const [backups, setBackups] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [doneNow, setDoneNow] = useState(false);

  const load = useCallback(async () => {
    if (!token) {
      setLoadErr("This link is missing its token.");
      return;
    }
    try {
      const d = await api.get<PublicFill>(`/public/fill/${token}`);
      setData(d);
      setChoices(Array.from({ length: d.options_required }, (_, i) => d.my_choices[i] ?? ""));
      setBackups(Array.from({ length: d.backups_allowed }, (_, i) => d.my_backups[i] ?? ""));
    } catch (e) {
      setLoadErr(e instanceof ApiError ? e.message : "This link is no longer valid.");
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!data) return;
    setErr(null);
    const picked = choices.filter(Boolean);
    if (picked.length !== data.options_required) {
      setErr(`Please rank ${data.options_required} distinct choices.`);
      return;
    }
    const violations = checkRules(data.rules, picked);
    if (violations.length) {
      setErr(violations.join("; "));
      return;
    }
    setBusy(true);
    try {
      await api.post(`/public/fill/${token}`, { choices: picked, backups: backups.filter(Boolean) });
      setDoneNow(true);
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : "Submit failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen place-items-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-xl bg-brand-600 text-xl font-bold text-white">
            B
          </div>
          <h1 className="text-xl font-semibold">Blockwise</h1>
        </div>

        {loadErr ? (
          <div className="card text-center text-red-600">{loadErr}</div>
        ) : !data ? (
          <p className="text-center text-slate-400">Loading…</p>
        ) : doneNow || data.submitted ? (
          <div className="card space-y-3 text-center">
            <p className="text-emerald-600">✓ Your choices are in. Thank you!</p>
            <p className="text-sm text-slate-400">You can close this page.</p>
            <Link to="/" className="btn-ghost">
              Go to Blockwise
            </Link>
          </div>
        ) : data.deadline_passed ? (
          <div className="card space-y-3 text-center">
            <p className="text-red-600">The deadline for choosing has passed.</p>
            <p className="text-sm text-slate-400">
              Please speak to your teacher if you still need to submit.
            </p>
            <Link to="/" className="btn-ghost">
              Go to Blockwise
            </Link>
          </div>
        ) : (
          <form onSubmit={submit} className="card space-y-4">
            <div>
              <h2 className="font-semibold">{data.timetable_name}</h2>
              <p className="text-sm text-slate-500">
                Rank your {data.options_required} subject choices in order of preference.
              </p>
            </div>
            <ChoiceFields
              subjects={data.subjects.map((s) => s.subject)}
              optionsRequired={data.options_required}
              backupsAllowed={data.backups_allowed}
              rules={data.rules}
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
        )}
      </div>
    </div>
  );
}
