import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";

export default function RoleChoice() {
  const { setRole } = useAuth();
  const navigate = useNavigate();

  async function pick(role: "teacher" | "student") {
    await setRole(role);
    navigate(role === "teacher" ? "/teacher" : "/student");
  }

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-1 text-2xl font-semibold">How will you use Blockwise?</h1>
      <p className="mb-6 text-slate-500">
        You can switch views any time from the menu.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <button
          className="card text-left transition hover:ring-brand-500"
          onClick={() => pick("teacher")}
        >
          <div className="mb-2 text-2xl">🧑‍🏫</div>
          <div className="font-semibold">Teacher</div>
          <p className="text-sm text-slate-500">
            Build timetables, collect choices, run block optimisation.
          </p>
        </button>
        <button
          className="card text-left transition hover:ring-brand-500"
          onClick={() => pick("student")}
        >
          <div className="mb-2 text-2xl">🎒</div>
          <div className="font-semibold">Student</div>
          <p className="text-sm text-slate-500">
            Fill out your subject choices for assigned timetables.
          </p>
        </button>
      </div>
    </div>
  );
}
