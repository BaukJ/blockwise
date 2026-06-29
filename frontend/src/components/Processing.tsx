import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type Job, type Timetable } from "../lib/api";
import SolutionView from "./SolutionView";

type Mode = "auto" | "custom" | "previous";

export default function Processing({ tt }: { tt: Timetable }) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [mode, setMode] = useState<Mode>("auto");
  const [prevId, setPrevId] = useState("");
  const [customRows, setCustomRows] = useState<
    { block: string; subject: string; capacity: number }[]
  >([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    setJobs(await api.get<Job[]>(`/timetable/${tt.id}/jobs`));
  }, [tt.id]);

  useEffect(() => {
    load();
  }, [load]);

  // Poll while anything is still solving.
  useEffect(() => {
    const active = jobs.some((j) => j.status === "pending" || j.status === "running");
    if (!active) return;
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, [jobs, load]);

  const done = jobs.filter((j) => j.status === "done");

  async function run() {
    setErr(null);
    setBusy(true);
    try {
      const body: Record<string, unknown> = { blocks_mode: mode, time_limit: 120 };
      if (mode === "previous") {
        if (!prevId) throw new ApiError(400, "Pick a previous solution");
        body.previous_job_id = prevId;
      }
      if (mode === "custom") {
        const rows = customRows.filter((r) => r.block.trim() && r.subject.trim());
        if (rows.length === 0) throw new ApiError(400, "Add at least one block class");
        body.custom_blocks = rows;
      }
      await api.post<Job>(`/timetable/${tt.id}/process`, body);
      await load();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Failed to start");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card space-y-4">
      <h2 className="font-semibold">Processing</h2>

      <div className="flex flex-wrap items-end gap-3 rounded-lg bg-slate-50 p-3">
        <label className="text-sm">
          <span className="mb-1 block text-slate-500">Blocks</span>
          <select
            className="input"
            value={mode}
            onChange={(e) => setMode(e.target.value as Mode)}
          >
            <option value="auto">Let Blockwise find optimal blocks</option>
            <option value="previous">Reuse blocks from a previous run</option>
            <option value="custom">Custom blocks (advanced)</option>
          </select>
        </label>

        {mode === "previous" && (
          <label className="text-sm">
            <span className="mb-1 block text-slate-500">Previous solution</span>
            <select
              className="input"
              value={prevId}
              onChange={(e) => setPrevId(e.target.value)}
            >
              <option value="">Select…</option>
              {done.map((j) => (
                <option key={j.id} value={j.id}>
                  {new Date(j.created_at).toLocaleString()} ({j.blocks_mode})
                </option>
              ))}
            </select>
          </label>
        )}

        <button className="btn-primary" onClick={run} disabled={busy}>
          {busy ? "Starting…" : "Run processing"}
        </button>
      </div>

      {mode === "custom" && (
        <CustomBlocks tt={tt} rows={customRows} setRows={setCustomRows} />
      )}
      {err && <p className="text-sm text-red-600">{err}</p>}

      {jobs.length === 0 ? (
        <p className="text-sm text-slate-400">No runs yet.</p>
      ) : (
        <ul className="space-y-2">
          {jobs.map((j) => (
            <li key={j.id} className="rounded-lg ring-1 ring-slate-200">
              <button
                className="flex w-full items-center justify-between px-3 py-2 text-left text-sm"
                onClick={() => setOpen(open === j.id ? null : j.id)}
              >
                <span>
                  {new Date(j.created_at).toLocaleString()} ·{" "}
                  <span className="text-slate-400">{j.blocks_mode}</span>
                </span>
                <span className="flex items-center gap-2">
                  <StatusBadge status={j.status} />
                  {tt.finalised_job_id === j.id && (
                    <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700">
                      finalised
                    </span>
                  )}
                </span>
              </button>
              {open === j.id && (
                <div className="border-t border-slate-100 p-3">
                  {j.status === "failed" && (
                    <pre className="whitespace-pre-wrap text-sm text-red-600">
                      {j.error}
                    </pre>
                  )}
                  {j.status === "done" && j.result && (
                    <SolutionView
                      tt={tt}
                      job={j}
                      onFinalised={load}
                      isFinalised={tt.finalised_job_id === j.id}
                    />
                  )}
                  {(j.status === "pending" || j.status === "running") && (
                    <p className="text-sm text-slate-400">Solving…</p>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CustomBlocks({
  tt,
  rows,
  setRows,
}: {
  tt: Timetable;
  rows: { block: string; subject: string; capacity: number }[];
  setRows: React.Dispatch<
    React.SetStateAction<{ block: string; subject: string; capacity: number }[]>
  >;
}) {
  const blockLetters = Array.from({ length: tt.num_blocks }, (_, i) =>
    String.fromCharCode(65 + i),
  );
  const subjects = tt.subjects.map((s) => s.subject);

  function update(i: number, patch: Partial<(typeof rows)[number]>) {
    setRows((r) => r.map((row, j) => (j === i ? { ...row, ...patch } : row)));
  }

  return (
    <div className="space-y-2 rounded-lg bg-slate-50 p-3">
      <p className="text-xs text-slate-500">
        Place each class in a block. Repeat a (block, subject) pair for multiple
        parallel classes.
      </p>
      <div className="grid grid-cols-[5rem_1fr_6rem_2rem] gap-2 text-xs text-slate-400">
        <span>Block</span>
        <span>Subject</span>
        <span>Capacity</span>
        <span />
      </div>
      {rows.map((row, i) => (
        <div key={i} className="grid grid-cols-[5rem_1fr_6rem_2rem] gap-2">
          <select
            className="input"
            value={row.block}
            onChange={(e) => update(i, { block: e.target.value })}
          >
            {blockLetters.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
          <select
            className="input"
            value={row.subject}
            onChange={(e) => update(i, { subject: e.target.value })}
          >
            <option value="">Select subject…</option>
            {subjects.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <input
            className="input"
            type="number"
            min={1}
            value={row.capacity}
            onChange={(e) => update(i, { capacity: Number(e.target.value) })}
          />
          <button
            className="text-slate-400 hover:text-red-600"
            onClick={() => setRows((r) => r.filter((_, j) => j !== i))}
          >
            ✕
          </button>
        </div>
      ))}
      <button
        className="btn-ghost"
        onClick={() =>
          setRows((r) => [
            ...r,
            { block: blockLetters[0], subject: "", capacity: 30 },
          ])
        }
      >
        + Add class
      </button>
    </div>
  );
}

function StatusBadge({ status }: { status: Job["status"] }) {
  const map: Record<Job["status"], string> = {
    pending: "bg-slate-100 text-slate-500",
    running: "bg-blue-100 text-blue-700",
    done: "bg-emerald-100 text-emerald-700",
    failed: "bg-red-100 text-red-700",
  };
  return (
    <span className={`rounded px-2 py-0.5 text-xs ${map[status]}`}>{status}</span>
  );
}
