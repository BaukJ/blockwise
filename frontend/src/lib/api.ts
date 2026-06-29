// Thin fetch wrapper. Cookies are sent same-origin (dev proxy / CloudFront).
// Backends can cold-start (~3s) so callers should show pending state, not spinners
// that imply a hang; requests here have a generous 15s timeout.

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      credentials: "include",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (res.status === 204) return undefined as T;
  let data: any = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) {
    const detail =
      (data && (data.detail || data.message)) || res.statusText || "Request failed";
    throw new ApiError(res.status, String(detail));
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body),
  del: <T>(path: string) => request<T>("DELETE", path),
};

export interface User {
  email: string;
  active_role: "teacher" | "student" | null;
  login_methods: string[];
  admin: boolean;
}

export interface Subject {
  subject: string;
  total_classes: number;
  class_capacity: number;
}

export interface Entry {
  student_key: string;
  name: string;
  student_email: string | null;
  choices: string[];
  backup: string | null;
  submitted: boolean;
  submitted_at: string | null;
}

export interface Progress {
  total: number;
  submitted: number;
  pending: string[];
}

export interface AssignedTimetable {
  timetable_id: string;
  name: string;
  deadline: string | null;
  submitted: boolean;
  finalised: boolean;
  reassignment_enabled: boolean;
}

export interface StudentTimetable {
  timetable_id: string;
  name: string;
  deadline: string | null;
  subjects: Subject[];
  num_blocks: number;
  my_choices: string[];
  my_backup: string | null;
  submitted: boolean;
  finalised: boolean;
  reassignment_enabled: boolean;
  my_assignment: Record<string, string> | null;
  available_swaps: Record<string, { subject: string; free: number }[]> | null;
  initial_assignment: Record<string, string> | null;
}

export interface SolveResult {
  block_classes: Record<string, Record<string, number[]>>;
  student_block_map: Record<string, Record<string, string>>;
  backup_users: {
    name: string;
    dropped: string;
    backup: string;
    is_wildcard: boolean;
  }[];
  block_names: string[];
}

export interface Job {
  id: string;
  timetable_id: string;
  created_at: string;
  status: "pending" | "running" | "done" | "failed";
  blocks_mode: "auto" | "custom" | "previous";
  error: string | null;
  result: SolveResult | null;
}

export interface Timetable {
  id: string;
  owner: string;
  name: string;
  created_at: string;
  deadline: string | null;
  entry_mode: "csv" | "ui" | "students";
  num_blocks: number;
  subjects: Subject[];
  finalised_job_id: string | null;
  reassignment_enabled: boolean;
}
