import { type ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import Layout from "./Layout";

export default function Protected({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading)
    return (
      <div className="grid min-h-screen place-items-center text-slate-400">
        Loading…
      </div>
    );
  if (!user) return <Navigate to="/login" replace />;
  return <Layout>{children}</Layout>;
}
