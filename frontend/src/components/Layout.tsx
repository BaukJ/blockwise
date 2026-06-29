import { type ReactNode, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";

// Single place that defines the header + footer wrapping every page.
export default function Layout({ children }: { children: ReactNode }) {
  const { user, setRole, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const navigate = useNavigate();

  async function switchTo(role: "teacher" | "student") {
    await setRole(role);
    setMenuOpen(false);
    navigate(role === "teacher" ? "/teacher" : "/student");
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <Link to="/" className="flex items-center gap-2 font-semibold">
            <span className="grid h-7 w-7 place-items-center rounded-md bg-brand-600 text-white">
              B
            </span>
            Blockwise
          </Link>

          {user && (
            <div className="relative">
              <button
                className="btn-ghost"
                onClick={() => setMenuOpen((o) => !o)}
                aria-label="Menu"
              >
                <span className="hidden sm:inline">{user.email}</span>
                <span className="text-lg leading-none">⋮</span>
              </button>
              {menuOpen && (
                <div className="absolute right-0 z-10 mt-2 w-56 rounded-lg bg-white p-1 shadow-lg ring-1 ring-slate-200">
                  <div className="px-3 py-1 text-xs uppercase tracking-wide text-slate-400">
                    Switch view
                  </div>
                  <button
                    className="block w-full rounded px-3 py-2 text-left text-sm hover:bg-slate-50"
                    onClick={() => switchTo("teacher")}
                  >
                    Teacher{user.active_role === "teacher" && " ✓"}
                  </button>
                  <button
                    className="block w-full rounded px-3 py-2 text-left text-sm hover:bg-slate-50"
                    onClick={() => switchTo("student")}
                  >
                    Student{user.active_role === "student" && " ✓"}
                  </button>
                  <div className="my-1 border-t border-slate-100" />
                  <button
                    className="block w-full rounded px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50"
                    onClick={async () => {
                      await logout();
                      navigate("/login");
                    }}
                  >
                    Log out
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">{children}</main>

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto max-w-5xl px-4 py-6 text-center text-sm text-slate-400">
          Blockwise · timetable block optimisation · © {new Date().getFullYear()}
        </div>
      </footer>
    </div>
  );
}
