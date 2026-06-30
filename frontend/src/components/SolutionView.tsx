import { useState } from "react";
import { api, type Job, type Timetable } from "../lib/api";
import AsyncButton from "./AsyncButton";

export default function SolutionView({
  tt,
  job,
  onFinalised,
  isFinalised,
}: {
  tt: Timetable;
  job: Job;
  onFinalised: () => void;
  isFinalised: boolean;
}) {
  const [showStudents, setShowStudents] = useState(false);
  const [reassign, setReassign] = useState(tt.reassignment_enabled);
  const result = job.result!;
  const students = Object.entries(result.student_block_map);

  async function finalise() {
    await api.post(`/timetable/${tt.id}/finalise`, { job_id: job.id });
    onFinalised();
  }

  async function toggleReassign(value: boolean) {
    setReassign(value);
    await api.patch(`/timetable/${tt.id}`, { reassignment_enabled: value });
    onFinalised();
  }

  return (
    <div className="space-y-4">
      {/* Block layout */}
      <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${result.block_names.length}, minmax(0, 1fr))` }}>
        {result.block_names.map((b) => (
          <div key={b} className="rounded-lg bg-slate-50 p-3">
            <div className="mb-2 text-xs font-semibold uppercase text-slate-400">
              Block {b}
            </div>
            <ul className="space-y-1 text-sm">
              {Object.entries(result.block_classes[b] || {}).map(([subj, caps]) => (
                <li key={subj} className="flex justify-between">
                  <span>{subj}</span>
                  <span className="text-slate-400">
                    {caps.length > 1 ? `×${caps.length}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {/* Backup summary */}
      <div className="text-sm">
        {result.backup_users.length === 0 ? (
          <p className="text-emerald-600">
            ✓ Every student received their top choices.
          </p>
        ) : (
          <p className="text-amber-600">
            {result.backup_users.length} student(s) fell back to a backup/alternative.
          </p>
        )}
      </div>

      <div className="flex items-center gap-3">
        <AsyncButton
          onClick={finalise}
          disabled={isFinalised}
          pendingText="Finalising…"
        >
          {isFinalised ? "Finalised" : "Finalise this solution"}
        </AsyncButton>
        <button
          className="text-sm text-brand-600"
          onClick={() => setShowStudents((s) => !s)}
        >
          {showStudents ? "Hide" : "Show"} per-student assignments
        </button>
      </div>

      {isFinalised && (
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={reassign}
            onChange={(e) => toggleReassign(e.target.checked)}
          />
          Let students reassign into classes with free space
        </label>
      )}

      {showStudents && (
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-slate-400">
            <tr>
              <th className="py-1">Student</th>
              {result.block_names.map((b) => (
                <th key={b}>Block {b}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {students.map(([name, map]) => (
              <tr key={name} className="border-t border-slate-100">
                <td className="py-1.5">{name}</td>
                {result.block_names.map((b) => (
                  <td key={b} className="text-slate-500">
                    {map[b] || "—"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
