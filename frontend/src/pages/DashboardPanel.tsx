import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity, ArrowDownLeft, ArrowUpRight, BarChart3, Calendar, Download, Lock,
  LogOut, RefreshCw, Search, TrendingUp, Users, Wallet, Eye, EyeOff, Loader2,
} from "lucide-react";
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import {
  DASHBOARD_KEY_STORAGE, DashboardData, DashboardTransaction,
  fetchDashboardData, verifyDashboardKey,
} from "../api";
import { useTheme } from "../hooks/useTheme";

type PeriodKey = "today" | "7d" | "30d" | "90d" | "month" | "year" | "all" | "custom";

const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "90d", label: "90 days" },
  { key: "month", label: "This month" },
  { key: "year", label: "1 year" },
  { key: "all", label: "All time" },
  { key: "custom", label: "Custom" },
];

const STATUS_COLORS: Record<string, string> = {
  completed: "#10b981",
  pending: "#f59e0b",
  rejected: "#ef4444",
  waiting_edit: "#3b82f6",
  unknown: "#94a3b8",
};

const PIE_COLORS = ["#7c2d3a", "#c79a3a", "#10b981", "#3b82f6", "#f43f5e", "#8b5cf6", "#14b8a6"];

const fmtNum = (n: number, digits = 0) =>
  (n ?? 0).toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: 0 });

const fmtRub = (n: number) => `${fmtNum(n)} ₽`;

const fmtDateTime = (iso: string) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-GB", { year: "2-digit", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
};

const statusColor = (s: string) => STATUS_COLORS[(s || "unknown").toLowerCase()] || STATUS_COLORS.unknown;

function computeRange(period: PeriodKey, custom: { start: string; end: string }) {
  const now = new Date();
  const end = now;
  let start: Date | null = null;
  switch (period) {
    case "today": start = new Date(now.getFullYear(), now.getMonth(), now.getDate()); break;
    case "7d": start = new Date(now.getTime() - 7 * 864e5); break;
    case "30d": start = new Date(now.getTime() - 30 * 864e5); break;
    case "90d": start = new Date(now.getTime() - 90 * 864e5); break;
    case "month": start = new Date(now.getFullYear(), now.getMonth(), 1); break;
    case "year": start = new Date(now.getTime() - 365 * 864e5); break;
    case "all": return { start: undefined, end: undefined, granularity: "month" as const };
    case "custom": {
      const s = custom.start ? new Date(custom.start + "T00:00:00") : null;
      const e = custom.end ? new Date(custom.end + "T23:59:59") : now;
      if (!s) return { start: undefined, end: undefined, granularity: "month" as const };
      const days = (e.getTime() - s.getTime()) / 864e5;
      return { start: s.toISOString(), end: e.toISOString(), granularity: days > 92 ? "month" as const : "day" as const };
    }
  }
  const days = start ? (end.getTime() - start.getTime()) / 864e5 : 0;
  return {
    start: start ? start.toISOString() : undefined,
    end: end.toISOString(),
    granularity: days > 92 ? "month" as const : "day" as const,
  };
}

// ─────────────────────────────────────────────────────────────────────────────

export function DashboardPanel() {
  const { theme } = useTheme();
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [keyInput, setKeyInput] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [authError, setAuthError] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);

  useEffect(() => {
    (async () => {
      const stored = localStorage.getItem(DASHBOARD_KEY_STORAGE);
      if (stored) {
        const ok = await verifyDashboardKey();
        setIsAuthenticated(ok);
        if (!ok) localStorage.removeItem(DASHBOARD_KEY_STORAGE);
      }
      setCheckingSession(false);
    })();
  }, []);

  const handleLogin = async () => {
    const key = keyInput.trim();
    if (!key) { setAuthError("Enter the dashboard key"); return; }
    setLoggingIn(true);
    setAuthError("");
    localStorage.setItem(DASHBOARD_KEY_STORAGE, key);
    const ok = await verifyDashboardKey();
    if (ok) {
      setIsAuthenticated(true);
      setKeyInput("");
    } else {
      localStorage.removeItem(DASHBOARD_KEY_STORAGE);
      setAuthError("Invalid key");
    }
    setLoggingIn(false);
  };

  const handleLogout = () => {
    localStorage.removeItem(DASHBOARD_KEY_STORAGE);
    setIsAuthenticated(false);
  };

  if (checkingSession) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-dark-900">
        <Loader2 className="w-8 h-8 text-maroon-600 animate-spin" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-dark-900 p-4">
        <div className="w-full max-w-sm bg-white dark:bg-dark-800 rounded-3xl shadow-xl border border-slate-200 dark:border-dark-600 p-7">
          <div className="flex flex-col items-center text-center mb-6">
            <div className="w-14 h-14 rounded-2xl bg-maroon-600 flex items-center justify-center mb-3">
              <BarChart3 className="w-7 h-7 text-white" />
            </div>
            <h1 className="text-xl font-bold text-slate-800 dark:text-ivory-200">Гүйлгээ Dashboard</h1>
            <p className="text-sm text-slate-500 dark:text-ivory-400 mt-1">Oyuns AIO Bot · analytics</p>
          </div>
          <label className="text-xs font-medium text-slate-500 dark:text-ivory-400">Dashboard key</label>
          <div className="relative mt-1">
            <input
              type={showKey ? "text" : "password"}
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleLogin()}
              placeholder="••••••••"
              className="w-full rounded-xl border border-slate-300 dark:border-dark-600 bg-white dark:bg-dark-700 text-slate-800 dark:text-ivory-200 p-3 pr-10 text-sm focus:ring-2 focus:ring-maroon-500 focus:border-transparent"
            />
            <button
              onClick={() => setShowKey((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              type="button"
            >
              {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          {authError && <p className="text-xs text-red-500 mt-2">{authError}</p>}
          <button
            onClick={handleLogin}
            disabled={loggingIn}
            className="w-full mt-4 flex items-center justify-center gap-2 py-3 rounded-xl bg-maroon-600 text-white font-semibold hover:bg-maroon-700 transition disabled:opacity-50"
          >
            {loggingIn ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
            Unlock
          </button>
          <p className="text-[11px] text-slate-400 dark:text-ivory-400 text-center mt-4">
            Independent from Telegram auth · key only
          </p>
        </div>
      </div>
    );
  }

  return <DashboardContent theme={theme} onLogout={handleLogout} />;
}

// ─────────────────────────────────────────────────────────────────────────────

function DashboardContent({ theme, onLogout }: { theme: string; onLogout: () => void }) {
  const [period, setPeriod] = useState<PeriodKey>("30d");
  const [custom, setCustom] = useState({ start: "", end: "" });
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const range = useMemo(() => computeRange(period, custom), [period, custom]);

  const { data, isLoading, isFetching, refetch, error } = useQuery({
    queryKey: ["dashboard-transactions", range.start, range.end, range.granularity],
    queryFn: () => fetchDashboardData({ start: range.start, end: range.end, granularity: range.granularity }),
    enabled: period !== "custom" || Boolean(custom.start),
    staleTime: 60_000,
  });

  const axisColor = theme === "dark" ? "#94a3b8" : "#64748b";
  const gridColor = theme === "dark" ? "#334155" : "#e2e8f0";

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-dark-900 text-slate-800 dark:text-ivory-200">
      <div className="max-w-7xl mx-auto px-4 md:px-6 py-5">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-maroon-600 flex items-center justify-center">
              <BarChart3 className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-lg md:text-xl font-bold leading-tight">Гүйлгээ · Oyuns AIO Bot</h1>
              <p className="text-xs text-slate-500 dark:text-ivory-400">Transaction analytics dashboard</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => refetch()}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white dark:bg-dark-800 border border-slate-200 dark:border-dark-600 text-sm font-medium hover:bg-slate-100 dark:hover:bg-dark-700 transition"
            >
              <RefreshCw className={`w-4 h-4 ${isFetching ? "animate-spin" : ""}`} /> Refresh
            </button>
            <button
              onClick={onLogout}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white dark:bg-dark-800 border border-slate-200 dark:border-dark-600 text-sm font-medium hover:bg-slate-100 dark:hover:bg-dark-700 transition"
            >
              <LogOut className="w-4 h-4" /> Logout
            </button>
          </div>
        </div>

        {/* Period selector */}
        <div className="flex flex-wrap items-center gap-2 mb-5">
          <div className="flex flex-wrap items-center gap-1 bg-white dark:bg-dark-800 p-1 rounded-2xl border border-slate-200 dark:border-dark-600">
            {PERIODS.map((p) => (
              <button
                key={p.key}
                onClick={() => setPeriod(p.key)}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition ${
                  period === p.key
                    ? "bg-maroon-600 text-white shadow"
                    : "text-slate-600 dark:text-ivory-400 hover:bg-slate-100 dark:hover:bg-dark-700"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          {period === "custom" && (
            <div className="flex items-center gap-2 bg-white dark:bg-dark-800 p-1.5 rounded-2xl border border-slate-200 dark:border-dark-600">
              <Calendar className="w-4 h-4 text-slate-400 ml-1" />
              <input
                type="date"
                value={custom.start}
                onChange={(e) => setCustom((c) => ({ ...c, start: e.target.value }))}
                className="bg-transparent text-xs p-1.5 outline-none"
              />
              <span className="text-slate-400 text-xs">→</span>
              <input
                type="date"
                value={custom.end}
                onChange={(e) => setCustom((c) => ({ ...c, end: e.target.value }))}
                className="bg-transparent text-xs p-1.5 outline-none"
              />
            </div>
          )}
        </div>

        {error ? (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 p-4 rounded-2xl text-sm">
            Failed to load data. Check the dashboard key / connection and refresh.
          </div>
        ) : isLoading || !data ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="w-10 h-10 text-maroon-600 animate-spin" />
          </div>
        ) : (
          <DashboardBody data={data} axisColor={axisColor} gridColor={gridColor}
            search={search} setSearch={setSearch} statusFilter={statusFilter} setStatusFilter={setStatusFilter} />
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function StatCard({ icon, label, value, sub, accent }: {
  icon: React.ReactNode; label: string; value: string; sub?: string; accent?: string;
}) {
  return (
    <div className="bg-white dark:bg-dark-800 rounded-2xl border border-slate-200 dark:border-dark-600 p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-slate-500 dark:text-ivory-400">{label}</span>
        <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${accent || "bg-maroon-50 dark:bg-maroon-900/30 text-maroon-600 dark:text-maroon-300"}`}>
          {icon}
        </div>
      </div>
      <div className="text-2xl font-bold mt-2 tabular-nums">{value}</div>
      {sub && <div className="text-xs text-slate-500 dark:text-ivory-400 mt-0.5">{sub}</div>}
    </div>
  );
}

function ChartCard({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-white dark:bg-dark-800 rounded-2xl border border-slate-200 dark:border-dark-600 p-4 shadow-sm">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-maroon-600 dark:text-gold-400">{icon}</span>
        <h3 className="text-sm font-bold">{title}</h3>
      </div>
      {children}
    </div>
  );
}

function DashboardBody({ data, axisColor, gridColor, search, setSearch, statusFilter, setStatusFilter }: {
  data: DashboardData; axisColor: string; gridColor: string;
  search: string; setSearch: (s: string) => void; statusFilter: string; setStatusFilter: (s: string) => void;
}) {
  const s = data.summary;

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return data.transactions.filter((t) => {
      if (statusFilter !== "all" && (t.status || "").toLowerCase() !== statusFilter) return false;
      if (!q) return true;
      return (
        (t.invoice || "").toLowerCase().includes(q) ||
        (t.user_name || "").toLowerCase().includes(q) ||
        String(t.user_id || "").includes(q) ||
        (t.promo_code || "").toLowerCase().includes(q)
      );
    });
  }, [data.transactions, search, statusFilter]);

  const tooltipStyle = {
    borderRadius: 12,
    fontSize: 12,
    border: `1px solid ${gridColor}`,
    background: "rgba(255,255,255,0.98)",
    color: "#1e293b",
  };

  return (
    <div className="space-y-5">
      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard icon={<Wallet className="w-4 h-4" />} label="Total volume" value={fmtRub(s.total_volume_rub)} sub={`${fmtNum(s.valid_count)} active txns`} />
        <StatCard icon={<Activity className="w-4 h-4" />} label="Completed volume" value={fmtRub(s.completed_volume_rub)} sub={`${fmtNum(s.completed_count)} completed`} accent="bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400" />
        <StatCard icon={<BarChart3 className="w-4 h-4" />} label="Total transactions" value={fmtNum(s.total_count)} sub={`avg ${fmtRub(s.avg_transaction_rub)}`} />
        <StatCard icon={<ArrowDownLeft className="w-4 h-4" />} label="Buy (RUB→MNT)" value={fmtRub(s.buy_volume_rub)} sub={`${fmtNum(s.buy_count)} txns`} accent="bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400" />
        <StatCard icon={<ArrowUpRight className="w-4 h-4" />} label="Sell (MNT→RUB)" value={fmtRub(s.sell_volume_rub)} sub={`${fmtNum(s.sell_count)} txns`} accent="bg-rose-50 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400" />
        <StatCard icon={<Users className="w-4 h-4" />} label="Unique users" value={fmtNum(s.unique_users)} sub={`${fmtNum(s.pending_count)} pending · ${fmtNum(s.rejected_count)} rejected`} accent="bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400" />
      </div>

      {/* Volume over time */}
      <ChartCard title="Volume over time (RUB)" icon={<TrendingUp className="w-4 h-4" />}>
        {data.time_series.length === 0 ? (
          <EmptyChart />
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={data.time_series}>
              <defs>
                <linearGradient id="buyG" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="sellG" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#f43f5e" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
              <XAxis dataKey="period" tick={{ fontSize: 11, fill: axisColor }} minTickGap={24} />
              <YAxis tick={{ fontSize: 11, fill: axisColor }} width={48} tickFormatter={(v: number) => fmtNum(v)} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v: any, n: any) => [fmtRub(Number(v)), n === "buy_volume_rub" ? "Buy" : "Sell"]} />
              <Legend formatter={(v) => (v === "buy_volume_rub" ? "Buy" : "Sell")} wrapperStyle={{ fontSize: 12 }} />
              <Area type="monotone" dataKey="buy_volume_rub" stroke="#10b981" strokeWidth={2} fill="url(#buyG)" />
              <Area type="monotone" dataKey="sell_volume_rub" stroke="#f43f5e" strokeWidth={2} fill="url(#sellG)" />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Transaction count over time */}
        <div className="lg:col-span-2">
          <ChartCard title="Transactions per period" icon={<BarChart3 className="w-4 h-4" />}>
            {data.time_series.length === 0 ? (
              <EmptyChart />
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={data.time_series}>
                  <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
                  <XAxis dataKey="period" tick={{ fontSize: 11, fill: axisColor }} minTickGap={24} />
                  <YAxis tick={{ fontSize: 11, fill: axisColor }} width={36} allowDecimals={false} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v: any) => [fmtNum(Number(v)), "Transactions"]} />
                  <Bar dataKey="count" fill="#7c2d3a" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartCard>
        </div>

        {/* Status breakdown pie */}
        <ChartCard title="By status" icon={<Activity className="w-4 h-4" />}>
          {data.status_breakdown.length === 0 ? (
            <EmptyChart />
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie
                  data={data.status_breakdown}
                  dataKey="count"
                  nameKey="status"
                  cx="50%"
                  cy="50%"
                  innerRadius={55}
                  outerRadius={90}
                  paddingAngle={2}
                >
                  {data.status_breakdown.map((entry) => (
                    <Cell key={entry.status} fill={statusColor(entry.status)} />
                  ))}
                </Pie>
                <Tooltip contentStyle={tooltipStyle} formatter={(v: any, n: any) => [fmtNum(Number(v)), n]} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>

      {/* Top users */}
      {data.top_users.length > 0 && (
        <ChartCard title="Top users by volume" icon={<Users className="w-4 h-4" />}>
          <ResponsiveContainer width="100%" height={Math.max(160, data.top_users.length * 34)}>
            <BarChart data={data.top_users} layout="vertical" margin={{ left: 8, right: 16 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={gridColor} horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11, fill: axisColor }} tickFormatter={(v: number) => fmtNum(v)} />
              <YAxis
                type="category"
                dataKey="user_name"
                tick={{ fontSize: 11, fill: axisColor }}
                width={130}
                tickFormatter={(v: string, i: number) => v || `ID ${data.top_users[i]?.user_id ?? ""}`}
              />
              <Tooltip contentStyle={tooltipStyle} formatter={(v: any) => [fmtRub(Number(v)), "Volume"]} />
              <Bar dataKey="volume_rub" fill="#c79a3a" radius={[0, 4, 4, 0]}>
                {data.top_users.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      )}

      {/* Transactions table */}
      <div className="bg-white dark:bg-dark-800 rounded-2xl border border-slate-200 dark:border-dark-600 shadow-sm overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 p-4 border-b border-slate-200 dark:border-dark-600">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-bold">Transactions</h3>
            <span className="text-xs text-slate-500 dark:text-ivory-400">
              {fmtNum(filteredRows.length)} of {fmtNum(data.row_count)}{data.truncated ? " (capped at 20k)" : ""}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search invoice / user / promo"
                className="pl-8 pr-3 py-2 rounded-xl border border-slate-200 dark:border-dark-600 bg-slate-50 dark:bg-dark-700 text-xs w-56 outline-none focus:ring-2 focus:ring-maroon-500"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="py-2 px-2 rounded-xl border border-slate-200 dark:border-dark-600 bg-slate-50 dark:bg-dark-700 text-xs outline-none"
            >
              <option value="all">All status</option>
              <option value="completed">Completed</option>
              <option value="pending">Pending</option>
              <option value="waiting_edit">Waiting edit</option>
              <option value="rejected">Rejected</option>
            </select>
            <button
              onClick={() => exportCsv(filteredRows)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-maroon-600 text-white text-xs font-semibold hover:bg-maroon-700 transition"
            >
              <Download className="w-4 h-4" /> CSV
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-slate-500 dark:text-ivory-400 bg-slate-50 dark:bg-dark-700/50">
                <th className="px-4 py-2.5 font-medium">Invoice</th>
                <th className="px-4 py-2.5 font-medium">Date</th>
                <th className="px-4 py-2.5 font-medium">User</th>
                <th className="px-4 py-2.5 font-medium">Dir</th>
                <th className="px-4 py-2.5 font-medium text-right">Amount</th>
                <th className="px-4 py-2.5 font-medium text-right">Rate</th>
                <th className="px-4 py-2.5 font-medium text-right">RUB eq.</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium">Promo</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.slice(0, 500).map((t, i) => (
                <tr key={`${t.invoice}-${i}`} className="border-t border-slate-100 dark:border-dark-700 hover:bg-slate-50 dark:hover:bg-dark-700/40">
                  <td className="px-4 py-2.5 font-mono text-[11px]">{t.invoice || "—"}</td>
                  <td className="px-4 py-2.5 whitespace-nowrap text-slate-600 dark:text-ivory-300">{fmtDateTime(t.timestamp)}</td>
                  <td className="px-4 py-2.5">
                    <div className="font-medium">{t.user_name || "—"}</div>
                    <div className="text-[10px] text-slate-400">{t.user_id ?? ""}</div>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-semibold ${
                      t.direction === "buy" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" : "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300"
                    }`}>
                      {t.direction === "buy" ? "BUY" : "SELL"}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap tabular-nums">
                    {fmtNum(t.amount)} <span className="text-slate-400">{t.currency_from}</span>
                    <span className="text-slate-300 dark:text-slate-600"> → {t.currency_to}</span>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-600 dark:text-ivory-300">{t.rate ? fmtNum(t.rate, 2) : "—"}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-medium">{fmtNum(t.rub_equivalent)}</td>
                  <td className="px-4 py-2.5">
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-medium">
                      <span className="w-2 h-2 rounded-full" style={{ background: statusColor(t.status || "") }} />
                      {t.status || "—"}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-slate-500 dark:text-ivory-400">{t.promo_code || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {filteredRows.length === 0 && (
            <div className="py-12 text-center text-sm text-slate-400">No transactions match the filters.</div>
          )}
          {filteredRows.length > 500 && (
            <div className="py-3 text-center text-[11px] text-slate-400 border-t border-slate-100 dark:border-dark-700">
              Showing first 500 rows · export CSV for the full {fmtNum(filteredRows.length)}.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function EmptyChart() {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-slate-400">
      <BarChart3 className="w-10 h-10 mb-2" />
      <p className="text-xs">No data in this period</p>
    </div>
  );
}

function exportCsv(rows: DashboardTransaction[]) {
  const headers = ["invoice", "timestamp", "user_id", "user_name", "direction", "amount", "currency_from", "currency_to", "rate", "rub_equivalent", "status", "promo_code", "bank_details"];
  const escape = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [
    headers.join(","),
    ...rows.map((r) => headers.map((h) => escape((r as any)[h])).join(",")),
  ].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `oyuns-transactions-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
