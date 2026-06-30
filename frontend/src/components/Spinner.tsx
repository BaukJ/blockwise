export function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <span
      className={`inline-block animate-spin rounded-full border-2 border-current border-t-transparent ${className}`}
    />
  );
}

// Centered loading state. `full` fills the viewport (for route-level loads).
export function Loading({ label = "Loading…", full }: { label?: string; full?: boolean }) {
  return (
    <div
      className={`flex items-center justify-center gap-2 text-slate-400 ${
        full ? "min-h-screen" : "min-h-[30vh]"
      }`}
    >
      <Spinner />
      <span>{label}</span>
    </div>
  );
}

export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="card mx-auto max-w-md space-y-3 text-center">
      <p className="text-red-600">{message}</p>
      {onRetry && (
        <button className="btn-ghost" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}
