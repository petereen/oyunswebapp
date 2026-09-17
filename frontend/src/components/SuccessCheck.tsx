import { useEffect, useState } from "react";

/**
 * A small, replayable success mark. The wrapper owns the entrance motion so
 * the icon can be used with any surrounding success layout.
 */
export function SuccessCheck() {
  const [state, setState] = useState<"out" | "in">("out");

  useEffect(() => {
    const frame = requestAnimationFrame(() => setState("in"));
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <span className="t-success-check text-green-500" data-state={state} aria-hidden="true">
      <svg viewBox="0 0 64 64" width="64" height="64" fill="none">
        <circle cx="32" cy="32" r="24" fill="currentColor" />
        <path
          d="M20 32.5l8 8L45 24"
          pathLength="1"
          stroke="white"
          strokeWidth="5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}
