import React, { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle, Calculator, Calendar, Loader2, LogOut, Plane, Plus, RefreshCw,
  Save, Trash2, TrendingUp, UserCog, Wallet,
} from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell,
} from "recharts";
import {
  BalanceAdjustment, BalanceSummary, CostRate, DailyBalanceRow, DashboardAdminOption,
  PlaneTicketSale, PlaneTicketSalesResponse, ProfitSummary, TreasuryAccount,
  createBalanceAdjustment, createPlaneTicketSale, createTreasuryAccount,
  deleteBalanceAdjustment, deletePlaneTicketSale, deleteTreasuryAccount,
  fetchBalanceSummary, fetchBlackRates, fetchCostRates, fetchPlaneTicketSales,
  fetchProfit, fetchRates, saveCostRate, updateTreasuryAccount,
  upsertBalanceDaily,
} from "../api";

type ProfitPeriod = "today" | "7d" | "month" | "year" | "custom";

const PROFIT_PERIODS: { key: ProfitPeriod; label: string }[] = [
  { key: "today", label: "Өнөөдөр" },
  { key: "7d", label: "7 хоног" },
  { key: "month", label: "Энэ сар" },
  { key: "year", label: "1 жил" },
  { key: "custom", label: "Хугацаа сонгох" },
];

const BALANCE_ADMIN_STORAGE = "oyuns_dashboard_balance_admin_id";
const PANEL_CLASS = "bg-white dark:bg-dark-800 rounded-2xl border border-slate-200 dark:border-dark-600 shadow-sm p-4 md:p-5";
const INPUT_CLASS = "w-full rounded-xl border border-slate-200 dark:border-dark-600 bg-slate-50 dark:bg-dark-700 px-3 py-2 text-sm tabular-nums outline-none focus:ring-2 focus:ring-maroon-500";

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const fmtNum = (n: number | null | undefined, digits = 0) =>
  (n ?? 0).toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: 0 });

const fmtRub = (n: number | null | undefined) => `${fmtNum(n)} ₽`;
const fmtMnt = (n: number | null | undefined) => `${fmtNum(n)} ₮`;
const fmtRate = (n: number | null | undefined) => (n == null ? "—" : n.toFixed(4));

function profitRange(period: ProfitPeriod, custom: { start: string; end: string }) {
  const now = new Date();
  let start: Date | null = null;
  switch (period) {
    case "today": start = new Date(now.getFullYear(), now.getMonth(), now.getDate()); break;
    case "7d": start = new Date(now.getTime() - 7 * 864e5); break;
    case "month": start = new Date(now.getFullYear(), now.getMonth(), 1); break;
    case "year": start = new Date(now.getTime() - 365 * 864e5); break;
    case "custom": {
      const s = custom.start ? new Date(custom.start + "T00:00:00") : null;
      const e = custom.end ? new Date(custom.end + "T23:59:59") : now;
      return { start: s ? s.toISOString() : undefined, end: e.toISOString() };
    }
  }
  return { start: start ? start.toISOString() : undefined, end: now.toISOString() };
}

function readStoredBalanceAdminId() {
  const stored = localStorage.getItem(BALANCE_ADMIN_STORAGE);
  if (!stored) return null;
  const parsed = Number(stored);
  return Number.isFinite(parsed) ? parsed : null;
}

function adminLabel(admins: DashboardAdminOption[], adminId: number | null | undefined) {
  if (adminId == null) return "Хуваарилаагүй";
  const match = admins.find((admin) => admin.admin_id === adminId);
  return match?.name || `ID ${adminId}`;
}

function accountBalance(draft: Pick<AcctDraft, "prev_balance" | "rub_to_mnt" | "mnt_to_rub" | "adjustment">) {
  return (Number(draft.prev_balance) || 0)
    + (Number(draft.rub_to_mnt) || 0)
    - (Number(draft.mnt_to_rub) || 0)
    + (Number(draft.adjustment) || 0);
}

// ─────────────────────────────────────────────────────────────────────────────

export function BalanceProfitPage({ onLogout, pageTabs }: { onLogout: () => void; pageTabs?: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-dark-900 text-slate-800 dark:text-ivory-200">
      <div className="max-w-7xl mx-auto px-4 md:px-6 py-5 space-y-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-maroon-600 flex items-center justify-center">
              <Wallet className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-lg md:text-xl font-bold leading-tight">Баланс ба Ашиг · Oyuns AIO Bot</h1>
              <p className="text-xs text-slate-500 dark:text-ivory-400">Балансын бүртгэл ба ашгийн тооцоо</p>
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
            <div className="w-full sm:w-auto">{pageTabs}</div>
            <button
              onClick={onLogout}
              className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-white dark:bg-dark-800 border border-slate-200 dark:border-dark-600 text-sm font-medium hover:bg-slate-100 dark:hover:bg-dark-700 transition"
            >
              <LogOut className="w-4 h-4" /> Гарах
            </button>
          </div>
        </div>

        <BalanceSection />
        <ProfitSection />
      </div>
    </div>
  );
}

// ── Section A: Balance accounting ────────────────────────────────────────────

function BalanceSection() {
  const [selectedAdminId, setSelectedAdminId] = useState<number | null>(() => readStoredBalanceAdminId());

  useEffect(() => {
    if (selectedAdminId == null) {
      localStorage.removeItem(BALANCE_ADMIN_STORAGE);
      return;
    }
    localStorage.setItem(BALANCE_ADMIN_STORAGE, String(selectedAdminId));
  }, [selectedAdminId]);

  const balanceQ = useQuery({
    queryKey: ["dashboard-balance", selectedAdminId],
    queryFn: () => fetchBalanceSummary({ admin_id: selectedAdminId ?? undefined }),
    staleTime: 30_000,
  });

  useEffect(() => {
    if (selectedAdminId == null || !balanceQ.data?.admins?.length) return;
    const stillExists = balanceQ.data.admins.some((admin) => admin.admin_id === selectedAdminId);
    if (!stillExists) setSelectedAdminId(null);
  }, [balanceQ.data, selectedAdminId]);

  useEffect(() => {
    const status = (balanceQ.error as { response?: { status?: number } } | null)?.response?.status;
    if (status === 400 && selectedAdminId != null) {
      setSelectedAdminId(null);
    }
  }, [balanceQ.error, selectedAdminId]);

  return (
    <div className={PANEL_CLASS}>
      <div className="flex flex-col gap-3 mb-4 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-2">
          <Wallet className="w-5 h-5 text-maroon-600 dark:text-gold-400" />
          <h2 className="text-base font-bold">Балансын бүртгэл</h2>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <label className="flex items-center gap-2 bg-slate-50 dark:bg-dark-700 px-3 py-2 rounded-xl border border-slate-200 dark:border-dark-600">
            <UserCog className="w-4 h-4 text-slate-400" />
            <span className="text-xs font-medium text-slate-500 dark:text-ivory-400">Админ</span>
            <select
              value={selectedAdminId ?? ""}
              onChange={(e) => setSelectedAdminId(e.target.value ? Number(e.target.value) : null)}
              className="bg-transparent text-sm font-semibold outline-none cursor-pointer"
            >
              <option value="">Бүх админ</option>
              {(balanceQ.data?.admins || []).map((admin) => (
                <option key={admin.admin_id} value={admin.admin_id}>
                  {admin.name || `ID ${admin.admin_id}`}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-center gap-2 bg-slate-50 dark:bg-dark-700 px-3 py-2 rounded-xl border border-slate-200 dark:border-dark-600">
            <Calendar className="w-4 h-4 text-slate-400" />
            <span className="text-xs tabular-nums">{balanceQ.data?.date || todayIso()} <span className="text-slate-400">(Москва)</span></span>
          </div>
          <button
            onClick={() => balanceQ.refetch()}
            className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 dark:bg-dark-700 text-xs font-semibold hover:bg-slate-200 dark:hover:bg-dark-600 transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${balanceQ.isFetching ? "animate-spin" : ""}`} /> Шинэчлэх
          </button>
        </div>
      </div>

      <p className="text-[11px] text-slate-500 dark:text-ivory-400 mb-4 bg-slate-50 dark:bg-dark-700/50 rounded-xl p-3 leading-relaxed">
        Систем <b>Өмнөх өдрийн баланс + Өнөөдрийн руб→төг − Өнөөдрийн төг→руб ± Бусад орлого/зардал</b> томьёогоор
        <b> тооцоолсон дүн</b>-г автоматаар гаргана. Админ өнөөдрийн бодит балансаа оруулахад
        <b> Зөрүү = Тооцоолсон дүн − Оруулсан дүн</b> гэж бодно. Москвагийн өдөр дуусахад оруулсан өнөөдрийн баланс автоматаар маргаашийн
        "Өмнөх өдрийн баланс" болж шилжинэ.
      </p>

      {balanceQ.error ? (
        <div className="text-sm text-red-500 py-6 text-center">Баланс ачаалж чадсангүй.</div>
      ) : balanceQ.isLoading || !balanceQ.data ? (
        <div className="flex justify-center py-10"><Loader2 className="w-7 h-7 text-maroon-600 animate-spin" /></div>
      ) : (
        <BalanceBody data={balanceQ.data} selectedAdminId={selectedAdminId} onChanged={() => balanceQ.refetch()} />
      )}
    </div>
  );
}

function BalanceBody({
  data,
  selectedAdminId,
  onChanged,
}: {
  data: BalanceSummary;
  selectedAdminId: number | null;
  onChanged: () => void;
}) {
  const viewLabel = selectedAdminId == null ? "Бүх админ" : adminLabel(data.admins, selectedAdminId);
  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-1 text-xs text-slate-500 dark:text-ivory-400 md:flex-row md:items-center md:justify-between">
        <div>
          Харагдаж буй тооцоо: <span className="font-semibold text-slate-700 dark:text-ivory-200">{viewLabel}</span>
        </div>
        <div>
          Оруулсан балансын нийлбэр: <span className="font-semibold text-slate-700 dark:text-ivory-200">{fmtRub(data.entered_balance_total)}</span>
        </div>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-6 gap-3">
        <BalanceStat label="Өмнөх өдрийн баланс" value={fmtRub(data.prev_balance_total)} />
        <BalanceStat label="Өнөөдрийн руб→төг" value={fmtRub(data.rub_to_mnt_rub)} tone="pos" />
        <BalanceStat label="Өнөөдрийн төг→руб" value={fmtRub(data.mnt_to_rub_rub)} tone="neg" />
        <BalanceStat label="Тохируулга" value={fmtRub(data.adjustment_total)} />
        <BalanceStat label="Нийт баланс" value={fmtRub(data.total_balance)} accent />
        <BalanceStat
          label="Зөрүү"
          value={data.difference_total == null ? "—" : fmtRub(data.difference_total)}
          tone={data.difference_total == null ? undefined : data.difference_total > 0 ? "pos" : data.difference_total < 0 ? "neg" : undefined}
        />
      </div>

      {data.missing_entered_balance_count > 0 && (
        <div className="flex items-start gap-2 text-xs bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300 rounded-xl p-3">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <div>
            {data.missing_entered_balance_count} админ өнөөдрийн бодит балансаа хараахан оруулаагүй байна. Дутуу мөрүүд дээр оруулсан дүнг хадгалсны дараа
            нийт "Зөрүү" автоматаар гарна.
          </div>
        </div>
      )}

      <DailyBalanceRowsTable rows={data.daily_balances} onChanged={onChanged} />
      <BalanceAdjustmentsPanel
        admins={data.admins}
        adjustments={data.adjustments}
        balanceDate={data.date}
        selectedAdminId={selectedAdminId}
        totalAdjustment={data.adjustment_total}
        onChanged={onChanged}
      />
    </div>
  );
}

function BalanceStat({ label, value, tone, accent }: { label: string; value: string; tone?: "pos" | "neg"; accent?: boolean }) {
  const valueColor = accent ? "text-white"
    : tone === "pos" ? "text-emerald-600 dark:text-emerald-400"
    : tone === "neg" ? "text-rose-600 dark:text-rose-400"
    : "text-slate-700 dark:text-ivory-200";
  return (
    <div className={`px-3 py-3 rounded-2xl border ${accent
      ? "bg-maroon-600 border-maroon-600"
      : "bg-white dark:bg-dark-800 border-slate-200 dark:border-dark-600"}`}>
      <div className={`text-[10px] ${accent ? "text-white/80" : "text-slate-400"}`}>{label}</div>
      <div className={`text-base font-bold tabular-nums mt-0.5 ${valueColor}`}>{value}</div>
    </div>
  );
}

type DailyBalanceDraft = {
  entered_balance: string;
};

function DailyBalanceRowsTable({ rows, onChanged }: { rows: DailyBalanceRow[]; onChanged: () => void }) {
  const [drafts, setDrafts] = useState<Record<number, DailyBalanceDraft>>({});
  const [busyAdminId, setBusyAdminId] = useState<number | null>(null);

  const draftOf = (row: DailyBalanceRow): DailyBalanceDraft => drafts[row.admin_id] ?? {
    entered_balance: row.entered_balance != null ? String(row.entered_balance) : "",
  };

  const setDraft = (adminId: number, patch: Partial<DailyBalanceDraft>) => {
    const row = rows.find((item) => item.admin_id === adminId);
    if (!row) return;
    setDrafts((current) => ({
      ...current,
      [adminId]: { ...draftOf(row), ...current[adminId], ...patch },
    }));
  };

  const isDirty = (row: DailyBalanceRow) => {
    const draft = drafts[row.admin_id];
    if (!draft) return false;
    const entered = draft.entered_balance.trim() === "" ? null : Number(draft.entered_balance);
    return entered !== row.entered_balance;
  };

  const previewDifference = (row: DailyBalanceRow) => {
    const draft = draftOf(row);
    const entered = draft.entered_balance.trim() === "" ? null : Number(draft.entered_balance);
    return entered == null ? null : row.calculated_balance - entered;
  };

  const save = async (row: DailyBalanceRow) => {
    const draft = draftOf(row);
    const enteredBalance = draft.entered_balance.trim() === "" ? null : Number(draft.entered_balance);
    setBusyAdminId(row.admin_id);
    try {
      await upsertBalanceDaily({
        admin_id: row.admin_id,
        balance_date: row.balance_date,
        entered_balance: enteredBalance,
      });
      setDrafts((current) => {
        const next = { ...current };
        delete next[row.admin_id];
        return next;
      });
      onChanged();
    } finally {
      setBusyAdminId(null);
    }
  };

  if (rows.length === 0) {
    return (
      <div className="py-6 text-center text-sm text-slate-400 rounded-2xl border border-dashed border-slate-200 dark:border-dark-600">
        Идэвхтэй админ олдсонгүй.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="text-sm font-semibold">Ерөнхий тооцоолуур</div>

      <div className="grid gap-3 md:hidden">
        {rows.map((row) => {
          const draft = draftOf(row);
          const difference = previewDifference(row);
          return (
            <div key={row.admin_id} className="rounded-2xl border border-slate-200 dark:border-dark-600 p-4 bg-slate-50/80 dark:bg-dark-700/40 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[11px] text-slate-400">Админ</div>
                  <div className="font-semibold">{row.admin_name || `ID ${row.admin_id}`}</div>
                </div>
                <div className="text-right">
                  <div className="text-[11px] text-slate-400">Зөрүү</div>
                  <div className={`font-bold tabular-nums ${difference == null ? "text-slate-400" : difference > 0 ? "text-emerald-600 dark:text-emerald-400" : difference < 0 ? "text-rose-600 dark:text-rose-400" : "text-slate-700 dark:text-ivory-200"}`}>
                    {difference == null ? "—" : fmtRub(difference)}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <BalanceMiniStat label="Өмнөх" value={fmtRub(row.opening_balance)} />
                <BalanceMiniStat label="Руб→төг" value={fmtRub(row.rub_to_mnt_rub)} tone="pos" />
                <BalanceMiniStat label="Төг→руб" value={fmtRub(row.mnt_to_rub_rub)} tone="neg" />
                <BalanceMiniStat label="Тохируулга" value={fmtRub(row.adjustment_total)} />
                <BalanceMiniStat label="Тооцоолсон" value={fmtRub(row.calculated_balance)} accent />
                <label>
                  <div className="text-[10px] text-slate-400 mb-1">Оруулсан баланс</div>
                  <input
                    type="number"
                    className={`${INPUT_CLASS} text-right`}
                    value={draft.entered_balance}
                    onChange={(e) => setDraft(row.admin_id, { entered_balance: e.target.value })}
                    placeholder="0"
                  />
                </label>
              </div>

              <button
                onClick={() => save(row)}
                disabled={!isDirty(row) || busyAdminId === row.admin_id}
                className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-maroon-600 text-white text-sm font-semibold disabled:opacity-40 hover:bg-maroon-700 transition"
              >
                {busyAdminId === row.admin_id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Хадгалах
              </button>
            </div>
          );
        })}
      </div>

      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-slate-500 dark:text-ivory-400 border-b border-slate-200 dark:border-dark-600">
              <th className="py-2 pr-2 font-medium">Админ</th>
              <th className="py-2 px-2 font-medium text-right">Өмнөх баланс (₽)</th>
              <th className="py-2 px-2 font-medium text-right">Руб→төг (₽)</th>
              <th className="py-2 px-2 font-medium text-right">Төг→руб (₽)</th>
              <th className="py-2 px-2 font-medium text-right">Тохируулга (₽)</th>
              <th className="py-2 px-2 font-medium text-right">Тооцоолсон дүн (₽)</th>
              <th className="py-2 px-2 font-medium text-right">Оруулсан баланс (₽)</th>
              <th className="py-2 px-2 font-medium text-right">Зөрүү (₽)</th>
              <th className="py-2 pl-2 font-medium text-right">Үйлдэл</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const draft = draftOf(row);
              const difference = previewDifference(row);
              return (
                <tr key={row.admin_id} className="border-b border-slate-100 dark:border-dark-700">
                  <td className="py-2 pr-2 min-w-[160px] font-semibold">{row.admin_name || `ID ${row.admin_id}`}</td>
                  <td className="py-2 px-2 text-right tabular-nums">{fmtRub(row.opening_balance)}</td>
                  <td className="py-2 px-2 text-right tabular-nums text-emerald-600 dark:text-emerald-400">{fmtRub(row.rub_to_mnt_rub)}</td>
                  <td className="py-2 px-2 text-right tabular-nums text-rose-600 dark:text-rose-400">{fmtRub(row.mnt_to_rub_rub)}</td>
                  <td className="py-2 px-2 text-right tabular-nums">{fmtRub(row.adjustment_total)}</td>
                  <td className="py-2 px-2 text-right tabular-nums font-semibold">{fmtRub(row.calculated_balance)}</td>
                  <td className="py-2 px-2 w-40">
                    <input
                      type="number"
                      className={`${INPUT_CLASS} text-right`}
                      value={draft.entered_balance}
                      onChange={(e) => setDraft(row.admin_id, { entered_balance: e.target.value })}
                      placeholder="0"
                    />
                  </td>
                  <td className={`py-2 px-2 text-right tabular-nums font-semibold ${difference == null ? "text-slate-400" : difference > 0 ? "text-emerald-600 dark:text-emerald-400" : difference < 0 ? "text-rose-600 dark:text-rose-400" : "text-slate-700 dark:text-ivory-200"}`}>
                    {difference == null ? "—" : fmtRub(difference)}
                  </td>
                  <td className="py-2 pl-2 text-right">
                    <button
                      onClick={() => save(row)}
                      disabled={!isDirty(row) || busyAdminId === row.admin_id}
                      className="inline-flex items-center justify-center p-1.5 rounded-lg bg-maroon-600 text-white disabled:opacity-30 hover:bg-maroon-700 transition"
                      title="Оруулсан балансыг хадгалах"
                    >
                      {busyAdminId === row.admin_id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BalanceMiniStat({ label, value, tone, accent }: { label: string; value: string; tone?: "pos" | "neg"; accent?: boolean }) {
  const color = accent ? "text-maroon-600 dark:text-gold-400"
    : tone === "pos" ? "text-emerald-600 dark:text-emerald-400"
    : tone === "neg" ? "text-rose-600 dark:text-rose-400"
    : "text-slate-700 dark:text-ivory-200";
  return (
    <div className="rounded-xl border border-slate-200 dark:border-dark-600 bg-white dark:bg-dark-800 px-3 py-2">
      <div className="text-[10px] text-slate-400">{label}</div>
      <div className={`text-sm font-semibold tabular-nums mt-0.5 ${color}`}>{value}</div>
    </div>
  );
}

function BalanceAdjustmentsPanel({
  admins,
  adjustments,
  balanceDate,
  selectedAdminId,
  totalAdjustment,
  onChanged,
}: {
  admins: DashboardAdminOption[];
  adjustments: BalanceAdjustment[];
  balanceDate: string;
  selectedAdminId: number | null;
  totalAdjustment: number;
  onChanged: () => void;
}) {
  const [formAdminId, setFormAdminId] = useState(selectedAdminId != null ? String(selectedAdminId) : "");
  const [amount, setAmount] = useState("");
  const [tag, setTag] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    setFormAdminId(selectedAdminId != null ? String(selectedAdminId) : "");
  }, [selectedAdminId]);

  const add = async () => {
    const parsedAmount = Number(amount);
    if (!formAdminId || !tag.trim() || !Number.isFinite(parsedAmount) || parsedAmount === 0) return;
    setSaving(true);
    try {
      await createBalanceAdjustment({
        admin_id: Number(formAdminId),
        balance_date: balanceDate,
        amount: parsedAmount,
        tag: tag.trim(),
        description: description.trim() || undefined,
      });
      setAmount("");
      setTag("");
      setDescription("");
      onChanged();
    } finally {
      setSaving(false);
    }
  };

  const remove = async (adjustment: BalanceAdjustment) => {
    if (!window.confirm(`"${adjustment.tag}" мөрийг устгах уу?`)) return;
    setDeletingId(adjustment.id);
    try {
      await deleteBalanceAdjustment(adjustment.id);
      onChanged();
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-4 rounded-2xl border border-slate-100 dark:border-dark-700 bg-slate-50 dark:bg-dark-700/30 p-4">
      <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="text-sm font-semibold">Бусад орлого / зардал</div>
          <div className="text-xs text-slate-500 dark:text-ivory-400">Таг, тайлбартай гараар оруулах тохируулга</div>
        </div>
        <div className="text-sm font-semibold tabular-nums">Нийт тохируулга: {fmtRub(totalAdjustment)}</div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[180px_170px_minmax(0,1fr)_minmax(0,1.4fr)_auto] gap-2 items-end">
        <label>
          <div className="text-[10px] text-slate-400 mb-1">Админ</div>
          <select className={INPUT_CLASS} value={formAdminId} onChange={(e) => setFormAdminId(e.target.value)}>
            <option value="">Админ сонгох</option>
            {admins.map((admin) => (
              <option key={admin.admin_id} value={admin.admin_id}>{admin.name || `ID ${admin.admin_id}`}</option>
            ))}
          </select>
        </label>
        <label>
          <div className="text-[10px] text-slate-400 mb-1">Дүн (₽)</div>
          <input type="number" className={`${INPUT_CLASS} text-right`} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="+1000 эсвэл -500" />
        </label>
        <label>
          <div className="text-[10px] text-slate-400 mb-1">Таг</div>
          <input className={INPUT_CLASS} value={tag} onChange={(e) => setTag(e.target.value)} placeholder="Жишээ: касс, шимтгэл, буцаалт" />
        </label>
        <label>
          <div className="text-[10px] text-slate-400 mb-1">Тайлбар</div>
          <input className={INPUT_CLASS} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Нэмэлт тайлбар" />
        </label>
        <button
          onClick={add}
          disabled={!formAdminId || !tag.trim() || !amount.trim() || saving}
          className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-maroon-600 text-white text-sm font-semibold hover:bg-maroon-700 transition disabled:opacity-40"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Нэмэх
        </button>
      </div>

      <div className="space-y-2">
        {adjustments.length === 0 ? (
          <div className="py-6 text-center text-sm text-slate-400 rounded-2xl border border-dashed border-slate-200 dark:border-dark-600">
            Бусад орлого/зардлын мөр алга байна.
          </div>
        ) : adjustments.map((adjustment) => (
          <div key={adjustment.id} className="flex flex-col gap-2 rounded-2xl border border-slate-200 dark:border-dark-600 bg-white dark:bg-dark-800 px-3 py-3 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-semibold">{adjustment.tag}</span>
                <span className={`tabular-nums font-semibold ${adjustment.amount > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                  {fmtRub(adjustment.amount)}
                </span>
                <span className="text-xs text-slate-400">{adjustment.admin_name || `ID ${adjustment.admin_id}`}</span>
              </div>
              <div className="text-xs text-slate-500 dark:text-ivory-400 mt-1 break-words">
                {adjustment.description || "Тайлбаргүй"}
              </div>
            </div>
            <button
              onClick={() => remove(adjustment)}
              disabled={deletingId === adjustment.id}
              className="self-start md:self-center px-3 py-2 rounded-xl bg-rose-100 dark:bg-rose-900/40 text-rose-600 dark:text-rose-300 hover:bg-rose-200 transition disabled:opacity-50"
            >
              {deletingId === adjustment.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

type AcctDraft = {
  name: string;
  admin_id: string;
  prev_balance: string;
  rub_to_mnt: string;
  mnt_to_rub: string;
  adjustment: string;
};

function TreasuryAccountsTable({
  accounts,
  admins,
  selectedAdminId,
  onChanged,
}: {
  accounts: TreasuryAccount[];
  admins: DashboardAdminOption[];
  selectedAdminId: number | null;
  onChanged: () => void;
}) {
  const [drafts, setDrafts] = useState<Record<string, AcctDraft>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newBalance, setNewBalance] = useState("");
  const [newAdminId, setNewAdminId] = useState(selectedAdminId != null ? String(selectedAdminId) : "");

  useEffect(() => {
    setNewAdminId(selectedAdminId != null ? String(selectedAdminId) : "");
  }, [selectedAdminId]);

  const draftOf = (account: TreasuryAccount): AcctDraft =>
    drafts[account.id] ?? {
      name: account.name,
      admin_id: account.admin_id != null ? String(account.admin_id) : "",
      prev_balance: String(account.prev_balance ?? 0),
      rub_to_mnt: String(account.rub_to_mnt ?? 0),
      mnt_to_rub: String(account.mnt_to_rub ?? 0),
      adjustment: String(account.adjustment ?? 0),
    };

  const setDraft = (id: string, patch: Partial<AcctDraft>) => {
    const account = accounts.find((item) => item.id === id);
    if (!account) return;
    setDrafts((current) => ({
      ...current,
      [id]: { ...draftOf(account), ...current[id], ...patch },
    }));
  };

  const isDirty = (account: TreasuryAccount) => {
    const draft = drafts[account.id];
    if (!draft) return false;
    return draft.name !== account.name
      || Number(draft.admin_id || 0) !== Number(account.admin_id || 0)
      || Number(draft.prev_balance) !== account.prev_balance
      || Number(draft.rub_to_mnt) !== account.rub_to_mnt
      || Number(draft.mnt_to_rub) !== account.mnt_to_rub
      || Number(draft.adjustment) !== account.adjustment;
  };

  const save = async (account: TreasuryAccount) => {
    const draft = draftOf(account);
    setBusyId(account.id);
    try {
      await updateTreasuryAccount(account.id, {
        name: draft.name,
        admin_id: draft.admin_id ? Number(draft.admin_id) : null,
        prev_balance: Number(draft.prev_balance) || 0,
        rub_to_mnt: Number(draft.rub_to_mnt) || 0,
        mnt_to_rub: Number(draft.mnt_to_rub) || 0,
        adjustment: Number(draft.adjustment) || 0,
      });
      setDrafts((current) => {
        const next = { ...current };
        delete next[account.id];
        return next;
      });
      onChanged();
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (account: TreasuryAccount) => {
    if (!window.confirm(`"${account.name}" дансыг устгах уу?`)) return;
    setBusyId(account.id);
    try {
      await deleteTreasuryAccount(account.id);
      onChanged();
    } finally {
      setBusyId(null);
    }
  };

  const add = async () => {
    if (!newName.trim()) return;
    setAdding(true);
    try {
      await createTreasuryAccount({
        name: newName.trim(),
        admin_id: newAdminId ? Number(newAdminId) : null,
        prev_balance: Number(newBalance) || 0,
        display_order: accounts.length,
      });
      setNewName("");
      setNewBalance("");
      onChanged();
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:hidden">
        {accounts.map((account) => {
          const draft = draftOf(account);
          const subtotal = accountBalance(draft);
          return (
            <div key={account.id} className="rounded-2xl border border-slate-200 dark:border-dark-600 p-4 bg-slate-50/80 dark:bg-dark-700/40 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[11px] text-slate-400">Данс</div>
                  <div className="font-semibold">{account.name}</div>
                </div>
                <div className="text-right">
                  <div className="text-[11px] text-slate-400">Өнөөдрийн баланс</div>
                  <div className="font-bold tabular-nums text-maroon-600 dark:text-gold-400">{fmtRub(subtotal)}</div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3">
                <label>
                  <div className="text-[10px] text-slate-400 mb-1">Дансны нэр</div>
                  <input className={INPUT_CLASS} value={draft.name} onChange={(e) => setDraft(account.id, { name: e.target.value })} />
                </label>
                <label>
                  <div className="text-[10px] text-slate-400 mb-1">Хариуцсан админ</div>
                  <select className={INPUT_CLASS} value={draft.admin_id} onChange={(e) => setDraft(account.id, { admin_id: e.target.value })}>
                    <option value="">Хуваарилаагүй</option>
                    {admins.map((admin) => (
                      <option key={admin.admin_id} value={admin.admin_id}>{admin.name || `ID ${admin.admin_id}`}</option>
                    ))}
                  </select>
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label>
                    <div className="text-[10px] text-slate-400 mb-1">Өмнөх баланс</div>
                    <input type="number" className={`${INPUT_CLASS} text-right`} value={draft.prev_balance} onChange={(e) => setDraft(account.id, { prev_balance: e.target.value })} />
                  </label>
                  <label>
                    <div className="text-[10px] text-slate-400 mb-1">Руб→төг</div>
                    <input type="number" className={`${INPUT_CLASS} text-right`} value={draft.rub_to_mnt} onChange={(e) => setDraft(account.id, { rub_to_mnt: e.target.value })} />
                  </label>
                  <label>
                    <div className="text-[10px] text-slate-400 mb-1">Төг→руб</div>
                    <input type="number" className={`${INPUT_CLASS} text-right`} value={draft.mnt_to_rub} onChange={(e) => setDraft(account.id, { mnt_to_rub: e.target.value })} />
                  </label>
                  <label>
                    <div className="text-[10px] text-slate-400 mb-1">Тохируулга</div>
                    <input type="number" className={`${INPUT_CLASS} text-right`} value={draft.adjustment} onChange={(e) => setDraft(account.id, { adjustment: e.target.value })} />
                  </label>
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => save(account)}
                  disabled={!isDirty(account) || busyId === account.id}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-maroon-600 text-white text-sm font-semibold disabled:opacity-40 hover:bg-maroon-700 transition"
                >
                  {busyId === account.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Хадгалах
                </button>
                <button
                  onClick={() => remove(account)}
                  disabled={busyId === account.id}
                  className="px-3 py-2 rounded-xl bg-rose-100 dark:bg-rose-900/40 text-rose-600 dark:text-rose-300 hover:bg-rose-200 transition"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          );
        })}
        {accounts.length === 0 && (
          <div className="py-6 text-center text-sm text-slate-400 rounded-2xl border border-dashed border-slate-200 dark:border-dark-600">
            Данс алга. Эхлээд баланс тооцох данс нэмнэ үү.
          </div>
        )}
      </div>

      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-slate-500 dark:text-ivory-400 border-b border-slate-200 dark:border-dark-600">
              <th className="py-2 pr-2 font-medium">Дансны нэр</th>
              <th className="py-2 px-2 font-medium">Админ</th>
              <th className="py-2 px-2 font-medium text-right">Өмнөх баланс (₽)</th>
              <th className="py-2 px-2 font-medium text-right">Руб→төг (₽)</th>
              <th className="py-2 px-2 font-medium text-right">Төг→руб (₽)</th>
              <th className="py-2 px-2 font-medium text-right">Тохируулга (₽)</th>
              <th className="py-2 px-2 font-medium text-right">Өнөөдрийн баланс (₽)</th>
              <th className="py-2 pl-2 font-medium text-right">Үйлдэл</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((account) => {
              const draft = draftOf(account);
              const subtotal = accountBalance(draft);
              return (
                <tr key={account.id} className="border-b border-slate-100 dark:border-dark-700">
                  <td className="py-2 pr-2 min-w-[180px]">
                    <input className={INPUT_CLASS} value={draft.name} onChange={(e) => setDraft(account.id, { name: e.target.value })} />
                  </td>
                  <td className="py-2 px-2 min-w-[180px]">
                    <select className={INPUT_CLASS} value={draft.admin_id} onChange={(e) => setDraft(account.id, { admin_id: e.target.value })}>
                      <option value="">Хуваарилаагүй</option>
                      {admins.map((admin) => (
                        <option key={admin.admin_id} value={admin.admin_id}>{admin.name || `ID ${admin.admin_id}`}</option>
                      ))}
                    </select>
                  </td>
                  <td className="py-2 px-2 w-36">
                    <input type="number" className={`${INPUT_CLASS} text-right`} value={draft.prev_balance} onChange={(e) => setDraft(account.id, { prev_balance: e.target.value })} />
                  </td>
                  <td className="py-2 px-2 w-36">
                    <input type="number" className={`${INPUT_CLASS} text-right`} value={draft.rub_to_mnt} onChange={(e) => setDraft(account.id, { rub_to_mnt: e.target.value })} />
                  </td>
                  <td className="py-2 px-2 w-36">
                    <input type="number" className={`${INPUT_CLASS} text-right`} value={draft.mnt_to_rub} onChange={(e) => setDraft(account.id, { mnt_to_rub: e.target.value })} />
                  </td>
                  <td className="py-2 px-2 w-36">
                    <input type="number" className={`${INPUT_CLASS} text-right`} value={draft.adjustment} onChange={(e) => setDraft(account.id, { adjustment: e.target.value })} />
                  </td>
                  <td className="py-2 px-2 text-right tabular-nums font-semibold">{fmtRub(subtotal)}</td>
                  <td className="py-2 pl-2">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        onClick={() => save(account)}
                        disabled={!isDirty(account) || busyId === account.id}
                        className="p-1.5 rounded-lg bg-maroon-600 text-white disabled:opacity-30 hover:bg-maroon-700 transition"
                        title="Хадгалах"
                      >
                        {busyId === account.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                      </button>
                      <button
                        onClick={() => remove(account)}
                        disabled={busyId === account.id}
                        className="p-1.5 rounded-lg bg-rose-100 dark:bg-rose-900/40 text-rose-600 dark:text-rose-300 hover:bg-rose-200 transition"
                        title="Устгах"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {accounts.length === 0 && (
              <tr><td colSpan={8} className="py-6 text-center text-slate-400">Данс алга. Эхлээд баланс тооцох данс нэмнэ үү.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="rounded-2xl border border-slate-100 dark:border-dark-700 bg-slate-50 dark:bg-dark-700/30 p-3 md:p-4">
        <div className="text-sm font-semibold mb-3">Шинэ данс нэмэх</div>
        <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_220px_180px_auto] gap-2 items-end">
          <label>
            <div className="text-[10px] text-slate-400 mb-1">Дансны нэр</div>
            <input className={INPUT_CLASS} placeholder="Жишээ: Сбербанк ₽" value={newName} onChange={(e) => setNewName(e.target.value)} />
          </label>
          <label>
            <div className="text-[10px] text-slate-400 mb-1">Хариуцсан админ</div>
            <select className={INPUT_CLASS} value={newAdminId} onChange={(e) => setNewAdminId(e.target.value)}>
              <option value="">Хуваарилаагүй</option>
              {admins.map((admin) => (
                <option key={admin.admin_id} value={admin.admin_id}>{admin.name || `ID ${admin.admin_id}`}</option>
              ))}
            </select>
          </label>
          <label>
            <div className="text-[10px] text-slate-400 mb-1">Өмнөх өдрийн баланс</div>
            <input type="number" className={`${INPUT_CLASS} text-right`} placeholder="0" value={newBalance} onChange={(e) => setNewBalance(e.target.value)} />
          </label>
          <button
            onClick={add}
            disabled={!newName.trim() || adding}
            className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-maroon-600 text-white text-sm font-semibold hover:bg-maroon-700 transition disabled:opacity-40"
          >
            {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Данс нэмэх
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Section B: Profit calculator ─────────────────────────────────────────────

function ProfitSection() {
  const [period, setPeriod] = useState<ProfitPeriod>("today");
  const [custom, setCustom] = useState({ start: "", end: "" });
  const range = useMemo(() => profitRange(period, custom), [period, custom]);

  const profitQ = useQuery({
    queryKey: ["dashboard-profit", range.start, range.end],
    queryFn: () => fetchProfit({ start: range.start, end: range.end }),
    enabled: period !== "custom" || Boolean(custom.start),
    staleTime: 30_000,
  });

  const refreshProfit = () => {
    profitQ.refetch();
  };

  return (
    <div className={PANEL_CLASS}>
      <div className="flex flex-col gap-3 mb-4 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-2">
          <Calculator className="w-5 h-5 text-maroon-600 dark:text-gold-400" />
          <h2 className="text-base font-bold">Ашгийн тооцоо</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap items-center gap-1 bg-slate-50 dark:bg-dark-700 p-1 rounded-2xl border border-slate-200 dark:border-dark-600">
            {PROFIT_PERIODS.map((periodOption) => (
              <button
                key={periodOption.key}
                onClick={() => setPeriod(periodOption.key)}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition ${
                  period === periodOption.key ? "bg-maroon-600 text-white shadow" : "text-slate-600 dark:text-ivory-400 hover:bg-slate-200 dark:hover:bg-dark-600"
                }`}
              >
                {periodOption.label}
              </button>
            ))}
          </div>
          {period === "custom" && (
            <div className="flex items-center gap-2 bg-slate-50 dark:bg-dark-700 p-1.5 rounded-2xl border border-slate-200 dark:border-dark-600">
              <input type="date" value={custom.start} onChange={(e) => setCustom((current) => ({ ...current, start: e.target.value }))} className="bg-transparent text-xs p-1 outline-none" />
              <span className="text-slate-400 text-xs">→</span>
              <input type="date" value={custom.end} onChange={(e) => setCustom((current) => ({ ...current, end: e.target.value }))} className="bg-transparent text-xs p-1 outline-none" />
            </div>
          )}
        </div>
      </div>

      <div className="text-[11px] text-slate-500 dark:text-ivory-400 mb-4 leading-relaxed bg-slate-50 dark:bg-dark-700/50 rounded-xl p-3">
        <b>Ашигийн томьёо:</b><br />
        Руб→Төг: ( өртөг ханш − rate ) × руб дүн &nbsp;·&nbsp;
        Төг→Руб: ( rate − өртөг ханш ) × руб дүн &nbsp;·&nbsp;
        Онгоцны тийз: ( current exchange rate − өртөг ханш ) × руб дүн
        <br />
        <span className="text-slate-400">
          Руб дүн: руб→төг бол анхны руб дүн, төг→руб болон тийз дээр amount ÷ rate. өртөг ханш = USD ханш ÷ black ханш. Ашиг ₮-өөр.
        </span>
      </div>

      {profitQ.error ? (
        <div className="text-sm text-red-500 py-6 text-center">Ашиг тооцоолж чадсангүй.</div>
      ) : profitQ.isLoading || !profitQ.data ? (
        <div className="flex justify-center py-10"><Loader2 className="w-7 h-7 text-maroon-600 animate-spin" /></div>
      ) : (
        <ProfitBody data={profitQ.data} />
      )}

      <PlaneTicketSalesManager range={range} onSaved={refreshProfit} />
      <CostRateManager range={range} onSaved={refreshProfit} />
    </div>
  );
}

function ProfitBody({ data }: { data: ProfitSummary }) {
  const chartData = data.by_day;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 xl:grid-cols-5 gap-3">
        <ProfitCard label="Нийт ашиг" value={fmtMnt(data.total_profit)} accent="bg-maroon-600 text-white" big />
        <ProfitCard label="Руб/төг ашиг" value={fmtMnt(data.buy_profit)} />
        <ProfitCard label="Төг/руб ашиг" value={fmtMnt(data.sell_profit)} />
        <ProfitCard label="Тийзний ашиг" value={fmtMnt(data.ticket_profit)} />
        <ProfitCard label="Тооцсон мөр" value={fmtNum(data.counted)} sub={`${fmtNum(data.ticket_count)} тийз`} />
      </div>

      {data.missing_rate_dates.length > 0 && (
        <div className="flex items-start gap-2 text-xs bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300 rounded-xl p-3">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <div>
            <b>{data.missing_rate_dates.length}</b> өдөрт өртөг ханш оруулаагүй тул тооцоонд ороогүй:
            <span className="font-mono"> {data.missing_rate_dates.slice(0, 12).join(", ")}{data.missing_rate_dates.length > 12 ? "…" : ""}</span>
            <div className="mt-0.5 text-amber-600/80">Доорх "Өртөг ханш" хэсэгт тухайн өдрүүдийн ханшийг оруулна уу.</div>
          </div>
        </div>
      )}

      {chartData.length > 0 && (
        <div className="pt-2">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={20} />
              <YAxis tick={{ fontSize: 10 }} width={56} tickFormatter={(value: number) => fmtNum(value)} />
              <Tooltip formatter={(value: unknown) => [fmtMnt(Number(value)), "Ашиг"]} contentStyle={{ borderRadius: 12, fontSize: 12 }} />
              <Bar dataKey="profit" radius={[4, 4, 0, 0]}>
                {chartData.map((day, index) => <Cell key={index} fill={day.profit >= 0 ? "#10b981" : "#ef4444"} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

function ProfitCard({ label, value, accent, big, sub }: { label: string; value: string; accent?: string; big?: boolean; sub?: string }) {
  return (
    <div className={`rounded-2xl border border-slate-200 dark:border-dark-600 p-4 ${accent || "bg-slate-50 dark:bg-dark-700"}`}>
      <div className={`text-xs font-medium ${accent ? "text-white/80" : "text-slate-500 dark:text-ivory-400"}`}>{label}</div>
      <div className={`${big ? "text-2xl" : "text-xl"} font-bold mt-1 tabular-nums`}>{value}</div>
      {sub && <div className={`text-xs mt-1 ${accent ? "text-white/75" : "text-slate-400"}`}>{sub}</div>}
    </div>
  );
}

function PlaneTicketSalesManager({ range, onSaved }: { range: { start?: string; end?: string }; onSaved: () => void }) {
  const [saleDate, setSaleDate] = useState(todayIso());
  const [soldPrice, setSoldPrice] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const salesQ = useQuery({
    queryKey: ["dashboard-plane-ticket-sales", range.start, range.end],
    queryFn: () => fetchPlaneTicketSales({ start: range.start, end: range.end }),
    staleTime: 30_000,
  });

  const ratesQ = useQuery({
    queryKey: ["rates"],
    queryFn: () => fetchRates(),
    staleTime: 60_000,
  });

  const costPreviewQ = useQuery({
    queryKey: ["dashboard-cost-rate-preview", saleDate],
    queryFn: () => fetchCostRates({ end: saleDate }),
    staleTime: 30_000,
  });

  const costRateRow = useMemo(
    () => (costPreviewQ.data || []).find((rate) => rate.cost_rate != null) ?? null,
    [costPreviewQ.data],
  );

  const currentExchangeRate = ratesQ.data?.sell_rate ?? null;
  const costRatePreview = costRateRow?.cost_rate ?? null;
  const soldPriceValue = Number(soldPrice);
  const rubPreview = soldPriceValue > 0 && currentExchangeRate ? soldPriceValue / currentExchangeRate : null;
  const profitPreview = rubPreview != null && currentExchangeRate != null && costRatePreview != null
    ? (currentExchangeRate - costRatePreview) * rubPreview
    : null;

  const save = async () => {
    if (!(soldPriceValue > 0)) return;
    setSaving(true);
    setMessage(null);
    try {
      await createPlaneTicketSale({ sale_date: saleDate, sold_price_mnt: soldPriceValue, notes });
      setSoldPrice("");
      setNotes("");
      await salesQ.refetch();
      onSaved();
      setMessage("Тийзийн борлуулалтыг хадгаллаа.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Тийз хадгалах үед алдаа гарлаа.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (sale: PlaneTicketSale) => {
    if (!window.confirm(`${sale.sale_date} өдрийн тийзийн борлуулалтыг устгах уу?`)) return;
    setDeletingId(sale.id);
    try {
      await deletePlaneTicketSale(sale.id);
      await salesQ.refetch();
      onSaved();
    } finally {
      setDeletingId(null);
    }
  };

  const summary = salesQ.data?.summary;
  const canSave = soldPriceValue > 0 && currentExchangeRate != null && costRatePreview != null && !saving;

  return (
    <div className="mt-5 pt-5 border-t border-slate-100 dark:border-dark-700 space-y-4">
      <div className="flex items-center gap-2">
        <Plane className="w-4 h-4 text-maroon-600 dark:text-gold-400" />
        <h3 className="text-sm font-bold">Онгоцны тийзийн борлуулалт</h3>
      </div>

      <p className="text-[11px] text-slate-500 dark:text-ivory-400 leading-relaxed bg-slate-50 dark:bg-dark-700/50 rounded-xl p-3">
        Зөвхөн <b>зарагдсан үнийг</b> оруулна. Систем одоогийн төг→руб ханш болон тухайн өдрийн өртөг ханшийг ашиглаад руб дүн, ашгийг автоматаар тооцно.
      </p>

      <div className="grid grid-cols-2 xl:grid-cols-5 gap-3">
        <ProfitCard label="Тийзийн мөр" value={fmtNum(summary?.count)} />
        <ProfitCard label="Нийт зарагдсан үнэ" value={fmtMnt(summary?.total_sold_price_mnt)} />
        <ProfitCard label="Тийзийн ашиг" value={fmtMnt(summary?.total_profit)} />
        <ProfitCard label="Current exchange rate" value={currentExchangeRate == null ? "—" : fmtRate(currentExchangeRate)} />
        <ProfitCard label="Өртөг ханш" value={costRatePreview == null ? "—" : fmtRate(costRatePreview)} sub={costRateRow && costRateRow.rate_date !== saleDate ? `${costRateRow.rate_date}-ны ханш ашиглаж байна` : undefined} />
      </div>

      <div className="rounded-2xl border border-slate-100 dark:border-dark-700 bg-slate-50 dark:bg-dark-700/30 p-3 md:p-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-[180px_220px_minmax(0,1fr)_auto] gap-2 items-end">
          <label>
            <div className="text-[10px] text-slate-400 mb-1">Огноо</div>
            <input type="date" className={INPUT_CLASS} value={saleDate} onChange={(e) => setSaleDate(e.target.value)} />
          </label>
          <label>
            <div className="text-[10px] text-slate-400 mb-1">Зарагдсан үнэ (₮)</div>
            <input type="number" className={`${INPUT_CLASS} text-right`} placeholder="0" value={soldPrice} onChange={(e) => setSoldPrice(e.target.value)} />
          </label>
          <label>
            <div className="text-[10px] text-slate-400 mb-1">Тайлбар</div>
            <input className={INPUT_CLASS} placeholder="Нэмэлт тэмдэглэл" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
          <button
            onClick={save}
            disabled={!canSave}
            className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-maroon-600 text-white text-sm font-semibold hover:bg-maroon-700 transition disabled:opacity-40"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Борлуулалт нэмэх
          </button>
        </div>

        <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
          <BalanceStat label="Exchange rate" value={currentExchangeRate == null ? "—" : fmtRate(currentExchangeRate)} />
          <BalanceStat label="Өртөг ханш" value={costRatePreview == null ? "—" : fmtRate(costRatePreview)} />
          <BalanceStat label="Руб дүн" value={rubPreview == null ? "—" : fmtRub(rubPreview)} />
          <BalanceStat label="Тооцоолсон ашиг" value={profitPreview == null ? "—" : fmtMnt(profitPreview)} tone={profitPreview != null && profitPreview < 0 ? "neg" : "pos"} />
        </div>

        {costRatePreview == null && (
          <div className="text-xs text-amber-600 dark:text-amber-300">
            {saleDate}-наас өмнөх өртөг ханш олдсонгүй. Эхлээд доорх хэсэгт өртөг ханш хадгална уу.
          </div>
        )}
        {message && <div className="text-xs text-slate-500 dark:text-ivory-400">{message}</div>}
      </div>

      {salesQ.error ? (
        <div className="text-sm text-red-500 py-4 text-center">Тийзийн борлуулалт ачаалж чадсангүй.</div>
      ) : salesQ.isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 text-maroon-600 animate-spin" /></div>
      ) : (
        <PlaneTicketSalesList data={salesQ.data as PlaneTicketSalesResponse} onDelete={remove} deletingId={deletingId} />
      )}
    </div>
  );
}

function PlaneTicketSalesList({
  data,
  onDelete,
  deletingId,
}: {
  data: PlaneTicketSalesResponse;
  onDelete: (sale: PlaneTicketSale) => void;
  deletingId: string | null;
}) {
  if (!data.sales.length) {
    return <div className="py-6 text-center text-sm text-slate-400">Энэ хугацаанд бүртгэсэн тийзийн борлуулалт алга.</div>;
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:hidden">
        {data.sales.map((sale) => (
          <div key={sale.id} className="rounded-2xl border border-slate-200 dark:border-dark-600 p-4 bg-slate-50/80 dark:bg-dark-700/40 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[11px] text-slate-400">Огноо</div>
                <div className="font-semibold">{sale.sale_date}</div>
              </div>
              <button
                onClick={() => onDelete(sale)}
                disabled={deletingId === sale.id}
                className="p-2 rounded-xl bg-rose-100 dark:bg-rose-900/40 text-rose-600 dark:text-rose-300 hover:bg-rose-200 transition"
              >
                {deletingId === sale.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <Metric label="Зарагдсан үнэ" value={fmtMnt(sale.sold_price_mnt)} />
              <Metric label="Exchange rate" value={fmtRate(sale.exchange_rate)} />
              <Metric label="Өртөг ханш" value={fmtRate(sale.cost_rate)} />
              <Metric label="Руб дүн" value={fmtRub(sale.rub_equivalent)} />
              <Metric label="Ашиг" value={fmtMnt(sale.profit_mnt)} />
              <Metric label="Тайлбар" value={sale.note || "—"} />
            </div>
          </div>
        ))}
      </div>

      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-slate-500 dark:text-ivory-400 border-b border-slate-200 dark:border-dark-600">
              <th className="py-2 pr-2 font-medium">Огноо</th>
              <th className="py-2 px-2 font-medium text-right">Зарагдсан үнэ</th>
              <th className="py-2 px-2 font-medium text-right">Exchange rate</th>
              <th className="py-2 px-2 font-medium text-right">Өртөг ханш</th>
              <th className="py-2 px-2 font-medium text-right">Руб дүн</th>
              <th className="py-2 px-2 font-medium text-right">Ашиг</th>
              <th className="py-2 px-2 font-medium">Тайлбар</th>
              <th className="py-2 pl-2 font-medium text-right">Үйлдэл</th>
            </tr>
          </thead>
          <tbody>
            {data.sales.map((sale) => (
              <tr key={sale.id} className="border-b border-slate-100 dark:border-dark-700">
                <td className="py-2 pr-2 font-mono">{sale.sale_date}</td>
                <td className="py-2 px-2 text-right tabular-nums">{fmtMnt(sale.sold_price_mnt)}</td>
                <td className="py-2 px-2 text-right tabular-nums">{fmtRate(sale.exchange_rate)}</td>
                <td className="py-2 px-2 text-right tabular-nums">{fmtRate(sale.cost_rate)}</td>
                <td className="py-2 px-2 text-right tabular-nums">{fmtRub(sale.rub_equivalent)}</td>
                <td className="py-2 px-2 text-right tabular-nums font-semibold">{fmtMnt(sale.profit_mnt)}</td>
                <td className="py-2 px-2 text-slate-500 dark:text-ivory-300">{sale.note || "—"}</td>
                <td className="py-2 pl-2 text-right">
                  <button
                    onClick={() => onDelete(sale)}
                    disabled={deletingId === sale.id}
                    className="p-1.5 rounded-lg bg-rose-100 dark:bg-rose-900/40 text-rose-600 dark:text-rose-300 hover:bg-rose-200 transition"
                  >
                    {deletingId === sale.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] text-slate-400">{label}</div>
      <div className="font-semibold tabular-nums">{value}</div>
    </div>
  );
}

// ── Cost rate (өртөг ханш) manager ───────────────────────────────────────────

function CostRateManager({ range, onSaved }: { range: { start?: string; end?: string }; onSaved: () => void }) {
  const [date, setDate] = useState(todayIso());
  const [usd, setUsd] = useState("");
  const [black, setBlack] = useState("");
  const [fetchingRate, setFetchingRate] = useState(false);
  const [rateMsg, setRateMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const listRange = useMemo(() => ({
    start: range.start ? range.start.slice(0, 10) : undefined,
    end: range.end ? range.end.slice(0, 10) : undefined,
  }), [range.start, range.end]);

  const ratesQ = useQuery({
    queryKey: ["dashboard-cost-rates", listRange.start, listRange.end],
    queryFn: () => fetchCostRates(listRange),
    staleTime: 30_000,
  });

  const costPreview = useMemo(() => {
    const usdRate = Number(usd);
    const blackRate = Number(black);
    if (!usdRate || !blackRate) return null;
    return usdRate / blackRate;
  }, [usd, black]);

  const fetchBlack = async () => {
    setFetchingRate(true);
    setRateMsg(null);
    try {
      const res = await fetchBlackRates({ date });
      if (!res.configured) {
        setRateMsg("Google Sheets тохируулагдаагүй байна (.env-ийг шалгана уу).");
      } else if (res.error) {
        setRateMsg(`Алдаа: ${res.error}`);
      } else {
        const exact = res.rates?.[date];
        if (exact != null) {
          setBlack(String(exact));
          setRateMsg(`Татаж авлаа: ${exact}`);
        } else if (res.latest != null) {
          setBlack(String(res.latest));
          setRateMsg(`${date}-нд бичилт алга — хамгийн сүүлийн black ханш${res.latest_date ? ` (${res.latest_date})` : ""}: ${res.latest}`);
        } else {
          setRateMsg(`${date}-ний black ханш Google Sheets-д олдсонгүй.`);
        }
      }
    } catch {
      setRateMsg("Black ханш татахад алдаа гарлаа.");
    } finally {
      setFetchingRate(false);
    }
  };

  const save = async () => {
    const usdRate = Number(usd);
    const blackRate = Number(black);
    if (!usdRate || !blackRate) return;
    setSaving(true);
    try {
      await saveCostRate({ date, usd_rate: usdRate, black_rate: blackRate });
      setUsd("");
      setBlack("");
      setRateMsg(null);
      await ratesQ.refetch();
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-5 pt-5 border-t border-slate-100 dark:border-dark-700">
      <div className="flex items-center gap-2 mb-3">
        <TrendingUp className="w-4 h-4 text-maroon-600 dark:text-gold-400" />
        <h3 className="text-sm font-bold">Өртөг ханш (USD ханш ÷ black ханш)</h3>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-5 gap-2 items-end">
        <label>
          <div className="text-[10px] text-slate-400 mb-1">Огноо</div>
          <input type="date" className={INPUT_CLASS} value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label>
          <div className="text-[10px] text-slate-400 mb-1">Black ханш (Sheets)</div>
          <div className="flex gap-1">
            <input type="number" className={INPUT_CLASS} placeholder="0" value={black} onChange={(e) => setBlack(e.target.value)} />
            <button
              onClick={fetchBlack}
              disabled={fetchingRate}
              className="px-3 rounded-xl bg-slate-100 dark:bg-dark-700 hover:bg-slate-200 transition shrink-0"
              title="Google Sheets-ээс татах"
            >
              {fetchingRate ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            </button>
          </div>
        </label>
        <label>
          <div className="text-[10px] text-slate-400 mb-1">USD ханш</div>
          <input type="number" className={INPUT_CLASS} placeholder="0" value={usd} onChange={(e) => setUsd(e.target.value)} />
        </label>
        <div>
          <div className="text-[10px] text-slate-400 mb-1">Өртөг ханш</div>
          <div className={`${INPUT_CLASS} flex items-center font-semibold ${costPreview == null ? "text-slate-300" : "text-maroon-600 dark:text-gold-400"}`}>
            {costPreview == null ? "—" : costPreview.toFixed(4)}
          </div>
        </div>
        <button
          onClick={save}
          disabled={!costPreview || saving}
          className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-maroon-600 text-white text-sm font-semibold hover:bg-maroon-700 transition disabled:opacity-40"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Хадгалах
        </button>
      </div>

      {rateMsg && <div className="text-[11px] text-slate-500 dark:text-ivory-400 mt-2">{rateMsg}</div>}

      <div className="mt-4 grid gap-3 md:hidden">
        {(ratesQ.data || []).map((rate) => (
          <div key={rate.rate_date} className="rounded-2xl border border-slate-200 dark:border-dark-600 p-4 bg-slate-50/80 dark:bg-dark-700/40 grid grid-cols-2 gap-3 text-sm">
            <Metric label="Огноо" value={rate.rate_date} />
            <Metric label="Өртөг ханш" value={rate.cost_rate != null ? rate.cost_rate.toFixed(4) : "—"} />
            <Metric label="USD ханш" value={fmtNum(rate.usd_rate, 2)} />
            <Metric label="Black ханш" value={fmtNum(rate.black_rate, 2)} />
          </div>
        ))}
        {(!ratesQ.data || ratesQ.data.length === 0) && (
          <div className="py-5 text-center text-sm text-slate-400">Энэ хугацаанд хадгалсан өртөг ханш алга.</div>
        )}
      </div>

      <div className="hidden md:block mt-4 overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-slate-500 dark:text-ivory-400 border-b border-slate-200 dark:border-dark-600">
              <th className="py-2 pr-2 font-medium">Огноо</th>
              <th className="py-2 px-2 font-medium text-right">USD ханш</th>
              <th className="py-2 px-2 font-medium text-right">Black ханш</th>
              <th className="py-2 pl-2 font-medium text-right">Өртөг ханш</th>
            </tr>
          </thead>
          <tbody>
            {(ratesQ.data || []).map((rate: CostRate) => (
              <tr key={rate.rate_date} className="border-b border-slate-100 dark:border-dark-700">
                <td className="py-2 pr-2 font-mono">{rate.rate_date}</td>
                <td className="py-2 px-2 text-right tabular-nums">{fmtNum(rate.usd_rate, 2)}</td>
                <td className="py-2 px-2 text-right tabular-nums">{fmtNum(rate.black_rate, 2)}</td>
                <td className="py-2 pl-2 text-right tabular-nums font-semibold text-maroon-600 dark:text-gold-400">{rate.cost_rate != null ? rate.cost_rate.toFixed(4) : "—"}</td>
              </tr>
            ))}
            {(!ratesQ.data || ratesQ.data.length === 0) && (
              <tr><td colSpan={4} className="py-5 text-center text-slate-400">Энэ хугацаанд хадгалсан өртөг ханш алга.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}