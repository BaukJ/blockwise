import { useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";

export default function Reset() {
  const [params] = useSearchParams();
  const { refresh } = useAuth();
  const [password, setPassword] = useState("");
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const token = params.get("token");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!/^(?=.*[A-Za-z])(?=.*\d).{8,}$/.test(password)) {
      setErr("Password must be at least 8 characters and include a letter and a number.");
      return;
    }
    try {
      await api.post("/auth/native/password-reset/confirm", {
        token,
        new_password: password,
      });
      await refresh();
      setDone(true);
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : "Reset failed");
    }
  }

  if (done) return <Navigate to="/" replace />;

  return (
    <div className="grid min-h-screen place-items-center px-4">
      <form onSubmit={submit} className="card w-full max-w-sm space-y-3">
        <h1 className="text-lg font-semibold">Choose a new password</h1>
        <input
          className="input"
          type="password"
          placeholder="New password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <p className="text-xs text-slate-400">
          At least 8 characters, including a letter and a number.
        </p>
        {err && <p className="text-sm text-red-600">{err}</p>}
        <button className="btn-primary w-full">Set password</button>
      </form>
    </div>
  );
}
