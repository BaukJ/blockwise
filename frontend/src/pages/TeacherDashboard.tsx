import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, ApiError, type Timetable } from "../lib/api";
import CloneModal from "../components/CloneModal";
import { Loading, ErrorState } from "../components/Spinner";

export default function TeacherDashboard() {
  const [items, setItems] = useState<Timetable[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [cloneTarget, setCloneTarget] = useState<Timetable | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Timetable | null>(null);
  const navigate = useNavigate();

  async function load() {
    try {
      setItems(await api.get<Timetable[]>("/timetable"));
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn’t load your timetables");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const tt = await api.post<Timetable>("/timetable", { name: name.trim() });
    setName("");
    setCreating(false);
    navigate(`/teacher/timetable/${tt.id}`);
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Your timetables</h1>
        <button className="btn-primary" onClick={() => setCreating((c) => !c)}>
          + New timetable
        </button>
      </div>

      {creating && (
        <form onSubmit={create} className="card mb-6 flex gap-2">
          <input
            className="input"
            placeholder="e.g. Year 10 Options 2026"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
          <button className="btn-primary">Create</button>
        </form>
      )}

      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorState message={error} onRetry={load} />
      ) : items.length === 0 ? (
        <div className="card text-center text-slate-500">
          No timetables yet. Create your first one.
        </div>
      ) : (
        <ul className="grid gap-3">
          {items.map((t) => (
            <li
              key={t.id}
              className="card flex items-center justify-between transition hover:ring-brand-500"
            >
              <Link to={`/teacher/timetable/${t.id}`} className="min-w-0 flex-1">
                <div className="font-medium">{t.name}</div>
                <div className="text-sm text-slate-400">
                  {t.subjects.length} subjects · {t.num_blocks} blocks · {t.entry_mode}
                </div>
              </Link>
              <div className="flex items-center gap-3 pl-3 text-sm">
                <button
                  className="text-brand-600 hover:underline"
                  onClick={() => setCloneTarget(t)}
                >
                  Clone
                </button>
                <button
                  className="text-red-600 hover:underline"
                  onClick={() => setDeleteTarget(t)}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {cloneTarget && (
        <CloneModal tt={cloneTarget} onClose={() => setCloneTarget(null)} />
      )}
      {deleteTarget && (
        <DeleteDialog
          tt={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDeleted={() => {
            setDeleteTarget(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function DeleteDialog({
  tt,
  onClose,
  onDeleted,
}: {
  tt: Timetable;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function del() {
    setErr(null);
    setBusy(true);
    try {
      await api.del(`/timetable/${tt.id}`);
      onDeleted();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Delete failed");
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
        <h3 className="font-semibold text-red-700">Delete “{tt.name}”?</h3>
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          This permanently deletes the timetable, its subjects, rules and every
          student’s choices and solutions. This cannot be undone.
        </p>
        {err && <p className="text-sm text-red-600">{err}</p>}
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn bg-red-600 text-white hover:bg-red-700"
            onClick={del}
            disabled={busy}
          >
            {busy ? "Deleting…" : "Delete timetable"}
          </button>
        </div>
      </div>
    </div>
  );
}
