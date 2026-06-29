import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DndContext,
  useDraggable,
  useDroppable,
  type DragEndEvent,
} from "@dnd-kit/core";
import { api, ApiError, type Job, type Timetable } from "../lib/api";
import SolutionView from "./SolutionView";

type Mode = "auto" | "previous" | "custom";

interface ClassChip {
  id: string;
  subject: string;
  capacity: number;
}

const AUTO = "auto";

function blockLetters(n: number): string[] {
  return Array.from({ length: n }, (_, i) => String.fromCharCode(65 + i));
}

// One chip per class declared in the timetable's subjects.
function buildChips(tt: Timetable): ClassChip[] {
  const chips: ClassChip[] = [];
  for (const s of tt.subjects) {
    for (let k = 0; k < s.total_classes; k++) {
      chips.push({
        id: `${s.subject}#${k}`,
        subject: s.subject,
        capacity: s.class_capacity,
      });
    }
  }
  return chips;
}

export default function Processing({ tt }: { tt: Timetable }) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [mode, setMode] = useState<Mode>("auto");
  const [prevId, setPrevId] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const chips = useMemo(() => buildChips(tt), [tt]);
  const blocks = blockLetters(tt.num_blocks);
  // chip id → block letter or AUTO
  const [placement, setPlacement] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setJobs(await api.get<Job[]>(`/timetable/${tt.id}/jobs`));
  }, [tt.id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const active = jobs.some((j) => j.status === "pending" || j.status === "running");
    if (!active) return;
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, [jobs, load]);

  const done = jobs.filter((j) => j.status === "done");

  // (Re)seed the drag-and-drop layout whenever the mode or chosen run changes.
  useEffect(() => {
    if (mode === "previous" && prevId) {
      const job = jobs.find((j) => j.id === prevId);
      const bc = job?.result?.block_classes ?? {};
      const next: Record<string, string> = {};
      const pool = [...chips];
      for (const [block, subjs] of Object.entries(bc)) {
        for (const [subject, caps] of Object.entries(subjs)) {
          for (let i = 0; i < caps.length; i++) {
            const idx = pool.findIndex((c) => c.subject === subject);
            if (idx >= 0) {
              next[pool[idx].id] = blocks.includes(block) ? block : AUTO;
              pool.splice(idx, 1);
            }
          }
        }
      }
      for (const c of pool) next[c.id] = AUTO;
      setPlacement(next);
    } else {
      // auto + custom both start with everything in automatic placement.
      setPlacement(Object.fromEntries(chips.map((c) => [c.id, AUTO])));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, prevId, tt.id]);

  function onDragEnd(e: DragEndEvent) {
    const zone = e.over?.id?.toString();
    if (!zone) return;
    setPlacement((p) => ({ ...p, [e.active.id.toString()]: zone }));
  }

  async function run() {
    setErr(null);
    setBusy(true);
    try {
      if (chips.length === 0) throw new ApiError(400, "Add subjects first");
      const classes = chips.map((c) => ({
        subject: c.subject,
        capacity: c.capacity,
        block: placement[c.id] && placement[c.id] !== AUTO ? placement[c.id] : null,
      }));
      await api.post<Job>(`/timetable/${tt.id}/process`, {
        blocks_mode: "layout",
        time_limit: 120,
        classes,
      });
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

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="mb-1 block text-slate-500">Starting point</span>
          <select
            className="input"
            value={mode}
            onChange={(e) => setMode(e.target.value as Mode)}
          >
            <option value="auto">Let Blockwise place everything</option>
            <option value="previous">Start from a previous run</option>
            <option value="custom">Build from scratch</option>
          </select>
        </label>
        {mode === "previous" && (
          <label className="text-sm">
            <span className="mb-1 block text-slate-500">Previous run</span>
            <select
              className="input"
              value={prevId}
              onChange={(e) => setPrevId(e.target.value)}
            >
              <option value="">Select…</option>
              {done.map((j) => (
                <option key={j.id} value={j.id}>
                  {new Date(j.created_at).toLocaleString()}
                </option>
              ))}
            </select>
          </label>
        )}
        <button className="btn-primary" onClick={run} disabled={busy}>
          {busy ? "Starting…" : "Run processing"}
        </button>
      </div>

      <p className="text-xs text-slate-500">
        Drag classes into blocks to pin them. Anything left in{" "}
        <span className="font-medium">Automatic placement</span> is positioned by the
        solver.
      </p>

      <LayoutBoard
        blocks={blocks}
        chips={chips}
        placement={placement}
        onDragEnd={onDragEnd}
      />

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
                <span>{new Date(j.created_at).toLocaleString()}</span>
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

// ── Drag-and-drop board ──────────────────────────────────────────────────────
function LayoutBoard({
  blocks,
  chips,
  placement,
  onDragEnd,
}: {
  blocks: string[];
  chips: ClassChip[];
  placement: Record<string, string>;
  onDragEnd: (e: DragEndEvent) => void;
}) {
  const inZone = (zone: string) => chips.filter((c) => placement[c.id] === zone);

  return (
    <DndContext onDragEnd={onDragEnd}>
      <div
        className="grid gap-3"
        style={{ gridTemplateColumns: `repeat(${Math.min(blocks.length, 4)}, minmax(0, 1fr))` }}
      >
        {blocks.map((b) => (
          <Zone key={b} id={b} title={`Block ${b}`}>
            {inZone(b).map((c) => (
              <Chip key={c.id} chip={c} />
            ))}
          </Zone>
        ))}
      </div>
      <div className="mt-3">
        <Zone id={AUTO} title="Automatic placement" muted>
          <div className="flex flex-wrap gap-2">
            {inZone(AUTO).map((c) => (
              <Chip key={c.id} chip={c} />
            ))}
            {inZone(AUTO).length === 0 && (
              <span className="text-xs text-slate-400">
                Everything is pinned — the solver has nothing to place.
              </span>
            )}
          </div>
        </Zone>
      </div>
    </DndContext>
  );
}

function Zone({
  id,
  title,
  muted,
  children,
}: {
  id: string;
  title: string;
  muted?: boolean;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      className={`rounded-lg p-3 ring-1 transition ${
        isOver ? "ring-brand-500 bg-brand-50" : "ring-slate-200"
      } ${muted ? "bg-slate-50" : "bg-white"}`}
    >
      <div className="mb-2 text-xs font-semibold uppercase text-slate-400">{title}</div>
      <div className={muted ? "" : "space-y-2"}>{children}</div>
    </div>
  );
}

function Chip({ chip }: { chip: ClassChip }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: chip.id,
  });
  return (
    <button
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={transform ? { transform: `translate(${transform.x}px, ${transform.y}px)` } : undefined}
      className={`block w-full cursor-grab rounded-md bg-brand-600 px-2 py-1 text-left text-xs text-white ${
        isDragging ? "opacity-50" : ""
      }`}
    >
      {chip.subject}{" "}
      <span className="opacity-70">·{chip.capacity}</span>
    </button>
  );
}

function StatusBadge({ status }: { status: Job["status"] }) {
  const map: Record<Job["status"], string> = {
    pending: "bg-slate-100 text-slate-500",
    running: "bg-blue-100 text-blue-700",
    done: "bg-emerald-100 text-emerald-700",
    failed: "bg-red-100 text-red-700",
  };
  return <span className={`rounded px-2 py-0.5 text-xs ${map[status]}`}>{status}</span>;
}
