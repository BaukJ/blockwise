import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./lib/auth";
import Protected from "./components/Protected";
import Login from "./pages/Login";
import Verify from "./pages/Verify";
import Reset from "./pages/Reset";
import RoleChoice from "./pages/RoleChoice";
import Home from "./pages/Home";
import TeacherDashboard from "./pages/TeacherDashboard";
import TimetableDetail from "./pages/TimetableDetail";
import StudentDashboard from "./pages/StudentDashboard";
import StudentTimetablePage from "./pages/StudentTimetable";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/verify" element={<Verify />} />
          <Route path="/reset" element={<Reset />} />
          <Route path="/" element={<Protected><Home /></Protected>} />
          <Route path="/choose" element={<Protected><RoleChoice /></Protected>} />
          <Route path="/teacher" element={<Protected><TeacherDashboard /></Protected>} />
          <Route path="/teacher/timetable/:id" element={<Protected><TimetableDetail /></Protected>} />
          <Route path="/student" element={<Protected><StudentDashboard /></Protected>} />
          <Route path="/student/timetable/:id" element={<Protected><StudentTimetablePage /></Protected>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  </React.StrictMode>,
);
