import { useEffect, useRef, useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";

export default function Verify() {
  const [params] = useSearchParams();
  const { refresh } = useAuth();
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    const token = params.get("token");
    if (!token) {
      setErr("Missing token");
      return;
    }
    api
      .post("/auth/native/verify", { token })
      .then(() => refresh())
      .then(() => setDone(true))
      .catch((e) => setErr(e instanceof ApiError ? e.message : "Verification failed"));
  }, [params, refresh]);

  if (done) return <Navigate to="/" replace />;

  return (
    <div className="grid min-h-screen place-items-center px-4 text-center">
      {err ? (
        <p className="text-red-600">{err}</p>
      ) : (
        <p className="text-slate-500">Verifying your account…</p>
      )}
    </div>
  );
}
