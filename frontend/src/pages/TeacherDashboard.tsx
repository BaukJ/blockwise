import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, type Timetable } from "../lib/api";

export default function TeacherDashboard() {
  const [items, setItems] = useState<Timetable[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const navigate = useNavigate();

  async function load() {
    setItems(await api.get<Timetable[]>("/timetable"));
    setLoading(false);
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
        <p className="text-slate-400">Loading…</p>
      ) : items.length === 0 ? (
        <div className="card text-center text-slate-500">
          No timetables yet. Create your first one.
        </div>
      ) : (
        <ul className="grid gap-3">
          {items.map((t) => (
            <li key={t.id}>
              <Link
                to={`/teacher/timetable/${t.id}`}
                className="card flex items-center justify-between transition hover:ring-brand-500"
              >
                <div>
                  <div className="font-medium">{t.name}</div>
                  <div className="text-sm text-slate-400">
                    {t.subjects.length} subjects · {t.num_blocks} blocks ·{" "}
                    {t.entry_mode}
                  </div>
                </div>
                <span className="text-slate-300">→</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
