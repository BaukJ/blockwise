import { type ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import Layout from "./Layout";

export default function Protected({ children }: { children: ReactNode }) {
  const { user, checked, maybeAuthed } = useAuth();
  if (user) return <Layout>{children}</Layout>;
  // Still verifying a remembered session — show a brief spinner rather than
  // flashing the login page.
  if (!checked && maybeAuthed)
    return (
      <div className="grid min-h-screen place-items-center text-slate-400">
        Loading…
      </div>
    );
  return <Navigate to="/login" replace />;
}
