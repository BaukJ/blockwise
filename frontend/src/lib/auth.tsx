import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { api, ApiError, type User } from "./api";

interface AuthState {
  user: User | null;
  // True once we've finished verifying with the backend (or we already knew the
  // visitor was anonymous and never needed to ask).
  checked: boolean;
  // Optimistic: a previous session flag exists and hasn't been disproven yet.
  maybeAuthed: boolean;
  refresh: () => Promise<void>;
  setRole: (role: "teacher" | "student") => Promise<void>;
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthState | null>(null);
export type { AuthState };

// Cookies are httpOnly so JS can't read them; this localStorage flag is a hint that
// we *think* the user is logged in, letting "/" render instantly when they're not
// (no blocking API call) and verify in the background when they might be.
const FLAG = "bw_authed";
const hadSession = () => localStorage.getItem(FLAG) === "1";
const setFlag = (v: boolean) =>
  v ? localStorage.setItem(FLAG, "1") : localStorage.removeItem(FLAG);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const seen = hadSession();
  // If there was no session flag we're certain they're anonymous — no API call,
  // already "checked". Otherwise we verify in the background.
  const [checked, setChecked] = useState(!seen);
  const [maybeAuthed, setMaybeAuthed] = useState(seen);

  const refresh = useCallback(async () => {
    try {
      const u = await api.get<User>("/auth/me");
      setUser(u);
      setMaybeAuthed(true);
      setFlag(true);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setUser(null);
        setMaybeAuthed(false);
        setFlag(false);
      }
      // Network/other errors: leave optimistic state as-is.
    } finally {
      setChecked(true);
    }
  }, []);

  useEffect(() => {
    // Only hit the backend on load if we think there's a session to verify.
    if (seen) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setRole = useCallback(async (role: "teacher" | "student") => {
    const u = await api.post<User>("/auth/role", { role });
    setUser(u);
    setMaybeAuthed(true);
    setFlag(true);
  }, []);

  const logout = useCallback(async () => {
    await api.post("/auth/logout");
    setUser(null);
    setMaybeAuthed(false);
    setChecked(true);
    setFlag(false);
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, checked, maybeAuthed, refresh, setRole, logout }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
