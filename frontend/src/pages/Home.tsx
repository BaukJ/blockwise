import { Navigate } from "react-router-dom";
import { useAuth } from "../lib/auth";

// Post-login landing: send the user to their saved view, or to the chooser
// if they've never picked one.
export default function Home() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (user.active_role === "teacher") return <Navigate to="/teacher" replace />;
  if (user.active_role === "student") return <Navigate to="/student" replace />;
  return <Navigate to="/choose" replace />;
}
