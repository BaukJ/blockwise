import { type ReactNode, useState } from "react";

// A button whose onClick may be async. While the promise is pending it disables
// itself and dims, so it never looks "unpressed" during a slow request.
export default function AsyncButton({
  onClick,
  children,
  className = "btn-primary",
  disabled,
  pendingText,
}: {
  onClick: () => void | Promise<void>;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  pendingText?: string;
}) {
  const [busy, setBusy] = useState(false);
  async function handle() {
    if (busy) return;
    try {
      setBusy(true);
      await onClick();
    } finally {
      setBusy(false);
    }
  }
  return (
    <button
      className={`${className} ${busy ? "opacity-70" : ""}`}
      disabled={busy || disabled}
      aria-busy={busy}
      onClick={handle}
    >
      {busy ? (pendingText ?? "Working…") : children}
    </button>
  );
}
