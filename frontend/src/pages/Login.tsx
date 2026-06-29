import { useState } from "react";
import { Navigate } from "react-router-dom";
import { api, ApiError, type User } from "../lib/api";
import { useAuth } from "../lib/auth";

type Mode = "login" | "register" | "forgot";

export default function Login() {
  const { user, refresh } = useAuth();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/" replace />;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setMsg(null);
    setBusy(true);
    try {
      if (mode === "login") {
        await api.post<User>("/auth/native/login", { email, password });
        await refresh();
      } else if (mode === "register") {
        await api.post("/auth/native/register", { email, password });
        setMsg("Check your email for a verification link.");
      } else {
        await api.post("/auth/native/password-reset", { email });
        setMsg("If that account exists, a reset link is on its way.");
      }
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen place-items-center bg-slate-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-xl bg-brand-600 text-xl font-bold text-white">
            B
          </div>
          <h1 className="text-xl font-semibold">Blockwise</h1>
          <p className="text-sm text-slate-500">Timetable block optimisation</p>
        </div>

        <div className="card">
          <form onSubmit={submit} className="space-y-3">
            <input
              className="input"
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            {mode !== "forgot" && (
              <input
                className="input"
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            )}
            {err && <p className="text-sm text-red-600">{err}</p>}
            {msg && <p className="text-sm text-emerald-600">{msg}</p>}
            <button className="btn-primary w-full" disabled={busy}>
              {busy
                ? "Working…"
                : mode === "login"
                  ? "Log in"
                  : mode === "register"
                    ? "Sign up"
                    : "Send reset link"}
            </button>
          </form>

          <div className="my-4 flex items-center gap-3 text-xs text-slate-400">
            <span className="h-px flex-1 bg-slate-200" /> or{" "}
            <span className="h-px flex-1 bg-slate-200" />
          </div>

          <a href="/api/auth/google/login" className="btn-ghost w-full">
            Continue with Google
          </a>
        </div>

        <div className="mt-4 space-y-1 text-center text-sm text-slate-500">
          {mode === "login" && (
            <>
              <button className="hover:text-brand-600" onClick={() => setMode("register")}>
                Need an account? Sign up
              </button>
              <br />
              <button className="hover:text-brand-600" onClick={() => setMode("forgot")}>
                Forgot password?
              </button>
            </>
          )}
          {mode !== "login" && (
            <button className="hover:text-brand-600" onClick={() => setMode("login")}>
              Back to log in
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
