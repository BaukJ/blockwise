import { useEffect, useState } from "react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { AuthContext, type AuthState } from "../lib/auth";
import { setMockHandler, type User } from "../lib/api";
import { createExampleHandler } from "../lib/exampleApi";
import Protected from "../components/Protected";
import TeacherDashboard from "./TeacherDashboard";
import TimetableDetail from "./TimetableDetail";
import StudentDashboard from "./StudentDashboard";
import StudentTimetablePage from "./StudentTimetable";
import RoleChoice from "./RoleChoice";

// Showcase pages: the real teacher/student UI backed by an in-memory fake API.
// Fully interactive; everything resets on refresh. Designed to be embedded (iframe).
function ExampleApp({ role }: { role: "teacher" | "student" }) {
  // Install the mock backend in a lazy initialiser so it's active before the child
  // pages' data effects run; the effect below tears it down on unmount.
  useState(() => {
    setMockHandler(createExampleHandler());
    return null;
  });
  useEffect(() => () => setMockHandler(null), []);

  const [user, setUser] = useState<User>({
    email: role === "teacher" ? "ms.taylor@example.school" : "alex@example.school",
    active_role: role,
    login_methods: ["password"],
    admin: false,
  });

  const auth: AuthState = {
    user,
    checked: true,
    maybeAuthed: true,
    refresh: async () => {},
    setRole: async (r) => setUser((u) => ({ ...u, active_role: r })),
    logout: async () => {},
  };

  return (
    <AuthContext.Provider value={auth}>
      <div className="flex flex-wrap items-center justify-center gap-x-2 bg-amber-400 px-4 py-1.5 text-center text-xs font-medium text-amber-950">
        <span>🧪 Interactive demo — nothing is saved; refresh to reset.</span>
        <a href="/login" target="_top" className="underline hover:no-underline">
          Open the real Blockwise →
        </a>
      </div>
      <MemoryRouter initialEntries={[role === "teacher" ? "/teacher" : "/student"]}>
        <Routes>
          <Route path="/teacher" element={<Protected><TeacherDashboard /></Protected>} />
          <Route path="/teacher/timetable/:id" element={<Protected><TimetableDetail /></Protected>} />
          <Route path="/student" element={<Protected><StudentDashboard /></Protected>} />
          <Route path="/student/timetable/:id" element={<Protected><StudentTimetablePage /></Protected>} />
          <Route path="/choose" element={<Protected><RoleChoice /></Protected>} />
          <Route path="*" element={<Protected><TeacherDashboard /></Protected>} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>
  );
}

export function ExampleTeacher() {
  return <ExampleApp role="teacher" />;
}
export function ExampleStudent() {
  return <ExampleApp role="student" />;
}
