import type { LucideIcon } from "lucide-react";
import { RefreshCw } from "lucide-react";

export const ADMIN_CONTROL_CLASS =
  "inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-slate-200/80 bg-white/80 px-2.5 text-xs font-semibold text-slate-600 shadow-sm transition hover:border-maroon-200 hover:bg-maroon-50 hover:text-maroon-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-maroon-400 disabled:pointer-events-none disabled:opacity-50 dark:border-dark-600 dark:bg-dark-800/80 dark:text-ivory-300 dark:hover:bg-dark-700";

export function AdminRefreshButton({
  onClick,
  loading = false,
  label = "Шинэчлэх",
}: {
  onClick: () => void;
  loading?: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      aria-label={label}
      title={label}
      data-slot="admin-refresh"
      className="inline-flex size-9 items-center justify-center rounded-full border border-slate-200/80 bg-white/85 text-slate-600 shadow-sm transition hover:border-maroon-200 hover:bg-maroon-50 hover:text-maroon-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-maroon-400 disabled:pointer-events-none disabled:opacity-50 dark:border-dark-600 dark:bg-dark-800/85 dark:text-ivory-300 dark:hover:bg-dark-700"
    >
      <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
    </button>
  );
}

export function AdminCountBadge({ count }: { count: number }) {
  return (
    <span
      data-slot="admin-count"
      className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-white px-1.5 text-xs font-bold text-slate-700 shadow-sm dark:bg-dark-800 dark:text-ivory-200"
    >
      {count}
    </span>
  );
}

export function AdminPendingBadge({ count }: { count: number }) {
  if (count <= 0) return null;

  return (
    <span
      data-slot="admin-pending-badge"
      aria-label={`${count} pending request${count === 1 ? "" : "s"}`}
      className="inline-flex min-w-5 items-center justify-center rounded-full bg-red-600 px-1.5 py-0.5 text-[0.65rem] font-bold leading-none text-white shadow-sm"
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

export function AdminEmptyState({
  children,
  icon: Icon,
}: {
  children: React.ReactNode;
  icon?: LucideIcon;
}) {
  return (
    <div
      data-slot="admin-empty-state"
      className="flex min-h-20 flex-col items-center justify-center gap-1 px-4 py-6 text-center text-xs text-slate-400 dark:text-ivory-500"
    >
      {Icon && <Icon className="size-5 text-slate-300 dark:text-ivory-600" />}
      <span>{children}</span>
    </div>
  );
}

export function AdminSectionHeader({
  icon: Icon,
  title,
  count,
  action,
}: {
  icon: LucideIcon;
  title: string;
  count?: number;
  action?: React.ReactNode;
}) {
  return (
    <div data-slot="admin-section-header" className="flex min-h-9 items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2 text-sm font-semibold text-slate-800 dark:text-ivory-200">
        <Icon className="size-4 shrink-0 text-maroon-600" />
        <span className="truncate">{title}</span>
        {count !== undefined && <span className="text-xs font-normal text-slate-400">({count})</span>}
      </div>
      {action}
    </div>
  );
}
