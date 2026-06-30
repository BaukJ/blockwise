import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./lib/auth";
import Protected from "./components/Protected";
import Login from "./pages/Login";
import Verify from "./pages/Verify";
import Reset from "./pages/Reset";
import Fill from "./pages/Fill";
import Docs from "./pages/Docs";
import { ExampleTeacher, ExampleStudent } from "./pages/Example";
import RoleChoice from "./pages/RoleChoice";
import Landing from "./pages/Landing";
import TeacherDashboard from "./pages/TeacherDashboard";
import TimetableDetail from "./pages/TimetableDetail";
import StudentDashboard from "./pages/StudentDashboard";
import StudentTimetablePage from "./pages/StudentTimetable";
import "./index.css";

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/verify" element={<Verify />} />
          <Route path="/reset" element={<Reset />} />
          <Route path="/fill" element={<Fill />} />
          <Route path="/docs" element={<Docs />} />
          <Route path="/docs/:slug" element={<Docs />} />
          <Route path="/" element={<Landing />} />
          <Route path="/choose" element={<Protected><RoleChoice /></Protected>} />
          <Route path="/teacher" element={<Protected><TeacherDashboard /></Protected>} />
          <Route path="/teacher/timetable/:id" element={<Protected><TimetableDetail /></Protected>} />
          <Route path="/student" element={<Protected><StudentDashboard /></Protected>} />
          <Route path="/student/timetable/:id" element={<Protected><StudentTimetablePage /></Protected>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

// The /example/* showcase runs as its own self-contained app with its own router
// and mock backend — it must NOT be nested inside the main BrowserRouter (react-router
// forbids nested routers).
function Root() {
  const path = window.location.pathname;
  if (path.startsWith("/example/")) {
    return path.includes("/student") ? <ExampleStudent /> : <ExampleTeacher />;
  }
  return <App />;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
