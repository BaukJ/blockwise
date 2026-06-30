import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError, type AssignedTimetable } from "../lib/api";
import { Loading, ErrorState } from "../components/Spinner";

function statusOf(t: AssignedTimetable): { label: string; cls: string } {
  if (t.finalised && t.reassignment_enabled)
    return { label: "Reassignment open", cls: "bg-blue-100 text-blue-700" };
  if (t.finalised) return { label: "Finalised", cls: "bg-emerald-100 text-emerald-700" };
  if (t.submitted) return { label: "Submitted", cls: "bg-slate-100 text-slate-500" };
  return { label: "Needs your choices", cls: "bg-amber-100 text-amber-700" };
}

export default function StudentDashboard() {
  const [items, setItems] = useState<AssignedTimetable[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setLoading(true);
    api
      .get<AssignedTimetable[]>("/student/timetables")
      .then((d) => {
        setItems(d);
        setError(null);
      })
      .catch((e) =>
        setError(e instanceof ApiError ? e.message : "Couldn’t load your timetables"),
      )
      .finally(() => setLoading(false));
  }
  useEffect(load, []);

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold">Your timetables</h1>
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorState message={error} onRetry={load} />
      ) : items.length === 0 ? (
        <div className="card text-center text-slate-500">
          No timetables assigned to you yet.
        </div>
      ) : (
        <ul className="grid gap-3">
          {items.map((t) => {
            const s = statusOf(t);
            return (
              <li key={t.timetable_id}>
                <Link
                  to={`/student/timetable/${t.timetable_id}`}
                  className="card flex items-center justify-between transition hover:ring-brand-500"
                >
                  <div>
                    <div className="font-medium">{t.name}</div>
                    {t.deadline && (
                      <div className="text-sm text-slate-400">
                        Deadline: {new Date(t.deadline).toLocaleDateString()}
                      </div>
                    )}
                  </div>
                  <span className={`rounded px-2 py-0.5 text-xs ${s.cls}`}>
                    {s.label}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
