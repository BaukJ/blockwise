import { Link, Navigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { Loading } from "../components/Spinner";

// Public landing at "/". Logged-out visitors see this immediately with no API call;
// a remembered session is verified in the background and then redirected.
export default function Landing() {
  const { user, checked, maybeAuthed } = useAuth();

  if (user) {
    if (user.active_role === "teacher") return <Navigate to="/teacher" replace />;
    if (user.active_role === "student") return <Navigate to="/student" replace />;
    return <Navigate to="/choose" replace />;
  }
  if (!checked && maybeAuthed) return <Loading full />;

  return (
    <div className="grid min-h-screen place-items-center bg-slate-50 px-4">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-brand-600 text-2xl font-bold text-white">
          B
        </div>
        <h1 className="text-3xl font-semibold">Blockwise</h1>
        <p className="mt-2 text-slate-500">
          Collect students’ subject choices and solve optimal timetable blocks.
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <Link to="/login" className="btn-primary">
            Log in or sign up
          </Link>
        </div>
      </div>
    </div>
  );
}
