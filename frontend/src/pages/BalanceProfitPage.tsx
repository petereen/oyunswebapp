import React, { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle, Calculator, Calendar, Download, History, Loader2, LogOut, Plane, Plus, RefreshCw,
  Save, Trash2, TrendingUp, UserCog, Wallet, X,
} from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell,
} from "recharts";
import {
  AdminBankAccountFull, BalanceAdjustment, BalanceHistoryRow, BalanceSummary, CostRate, DailyBalanceRow, DashboardAdminOption,
  DashboardTimeZone,
  PlaneTicketSale, PlaneTicketSalesResponse, ProfitSummary, TreasuryAccount,
  createBalanceAdjustment, createPlaneTicketSale, createTreasuryAccount,
  deleteBalanceAdjustment, deletePlaneTicketSale, deleteTreasuryAccount,
  fetchProfitTransactions,
  fetchBalanceHistory, fetchBalanceSummary, fetchBlackRates, fetchCostRates, fetchDashboardAdminBankAccounts, fetchPlaneTicketSales,
  fetchProfit, saveCostRate, saveCostRatePeriodUsd, updateTreasuryAccount,
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
const DASHBOARD_TIMEZONE_STORAGE = "oyuns_dashboard_timezone";
const PANEL_CLASS = "bg-white dark:bg-dark-800 rounded-2xl border border-slate-200 dark:border-dark-600 shadow-sm p-4 md:p-5";
const INPUT_CLASS = "w-full rounded-xl border border-slate-200 dark:border-dark-600 bg-slate-50 dark:bg-dark-700 px-3 py-2 text-sm tabular-nums outline-none focus:ring-2 focus:ring-maroon-500";

const DASHBOARD_TIMEZONES: { key: DashboardTimeZone; label: string; short: string; iana: string }[] = [
  { key: "moscow", label: "Moscow time", short: "MSK", iana: "Europe/Moscow" },
  { key: "ub", label: "UB time", short: "UB", iana: "Asia/Ulaanbaatar" },
];

function dashboardTimeZoneConfig(timeZone: DashboardTimeZone) {
  return DASHBOARD_TIMEZONES.find((item) => item.key === timeZone) || DASHBOARD_TIMEZONES[0];
}

function zonedDateParts(date: Date, timeZone: DashboardTimeZone) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: dashboardTimeZoneConfig(timeZone).iana,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const valueOf = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || "00";
  return {
    year: valueOf("year"),
    month: valueOf("month"),
    day: valueOf("day"),
    hour: valueOf("hour"),
    minute: valueOf("minute"),
    second: valueOf("second"),
  };
}

function zonedDateIso(date: Date, timeZone: DashboardTimeZone) {
  const parts = zonedDateParts(date, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function zonedDateTimeToUtcIso(timeZone: DashboardTimeZone, dateIso: string, timeValue: string) {
  const [year, month, day] = dateIso.split("-").map(Number);
  const [hour, minute, second] = timeValue.split(":").map(Number);
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  const parts = zonedDateParts(guess, timeZone);
  const asIfUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return new Date(guess.getTime() - (asIfUtc - guess.getTime())).toISOString();
}

const todayIso = (timeZone: DashboardTimeZone = "moscow") => zonedDateIso(new Date(), timeZone);

const fmtNum = (n: number | null | undefined, digits = 0) =>
  (n ?? 0).toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: 0 });

const fmtRub = (n: number | null | undefined) => `${fmtNum(n)} ₽`;
const fmtMnt = (n: number | null | undefined) => `${fmtNum(n)} ₮`;
const fmtRate = (n: number | null | undefined) => (n == null ? "—" : n.toFixed(4));

function getApiErrorDetail(error: unknown, fallback: string) {
  const detail = (error as { response?: { data?: { detail?: unknown } } } | null)?.response?.data?.detail;
  return typeof detail === "string" ? detail : fallback;
}

function profitRange(period: ProfitPeriod, custom: { start: string; end: string }, timeZone: DashboardTimeZone) {
  const now = new Date();
  const nowDate = zonedDateIso(now, timeZone);
  let startIso: string | undefined;
  let startDate: string | undefined;
  switch (period) {
    case "today":
      startDate = nowDate;
      startIso = zonedDateTimeToUtcIso(timeZone, startDate, "00:00:00");
      break;
    case "7d": {
      const start = new Date(now.getTime() - 7 * 864e5);
      startIso = start.toISOString();
      startDate = zonedDateIso(start, timeZone);
      break;
    }
    case "month": {
      const parts = zonedDateParts(now, timeZone);
      startDate = `${parts.year}-${parts.month}-01`;
      startIso = zonedDateTimeToUtcIso(timeZone, startDate, "00:00:00");
      break;
    }
    case "year": {
      const start = new Date(now.getTime() - 365 * 864e5);
      startIso = start.toISOString();
      startDate = zonedDateIso(start, timeZone);
      break;
    }
    case "custom": {
      return {
        start: custom.start ? zonedDateTimeToUtcIso(timeZone, custom.start, "00:00:00") : undefined,
        end: custom.end ? zonedDateTimeToUtcIso(timeZone, custom.end, "23:59:59") : now.toISOString(),
        startDate: custom.start || undefined,
        endDate: custom.end || nowDate,
      };
    }
  }
  return { start: startIso, end: now.toISOString(), startDate, endDate: nowDate };
}

function readStoredBalanceAdminId() {
  const stored = localStorage.getItem(BALANCE_ADMIN_STORAGE);
  if (!stored) return null;
  const parsed = Number(stored);
  return Number.isFinite(parsed) ? parsed : null;
}

function readStoredDashboardTimeZone(): DashboardTimeZone {
  const stored = localStorage.getItem(DASHBOARD_TIMEZONE_STORAGE);
  return stored === "ub" ? "ub" : "moscow";
}

function adminLabel(admins: DashboardAdminOption[], adminId: number | null | undefined) {
  if (adminId == null) return "Хуваарилаагүй";
  const match = admins.find((admin) => admin.admin_id === adminId);
  return match?.name || `ID ${adminId}`;
}

function accountAdjustmentTotal(account: Pick<TreasuryAccount, "adjustment_total" | "adjustment">) {
  return Number(account.adjustment_total ?? account.adjustment ?? 0) || 0;
}

function accountBalance(account: Pick<TreasuryAccount, "prev_balance" | "rub_to_mnt" | "mnt_to_rub">) {
  return (Number(account.prev_balance) || 0)
    + (Number(account.rub_to_mnt) || 0)
    - (Number(account.mnt_to_rub) || 0);
}

function accountEnteredBalance(draft: Pick<AcctDraft, "entered_balance">) {
  return draft.entered_balance.trim() === "" ? null : (Number(draft.entered_balance) || 0);
}

function accountDifference(account: Pick<TreasuryAccount, "prev_balance" | "rub_to_mnt" | "mnt_to_rub">, draft: Pick<AcctDraft, "entered_balance">) {
  const enteredBalance = accountEnteredBalance(draft);
  if (enteredBalance == null) return null;
  return accountBalance(account) - enteredBalance;
}

// ─────────────────────────────────────────────────────────────────────────────

export function BalanceProfitPage({ onLogout, pageTabs }: { onLogout: () => void; pageTabs?: React.ReactNode }) {
  const [dashboardTimeZone, setDashboardTimeZone] = useState<DashboardTimeZone>(() => readStoredDashboardTimeZone());

  useEffect(() => {
    localStorage.setItem(DASHBOARD_TIMEZONE_STORAGE, dashboardTimeZone);
  }, [dashboardTimeZone]);

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
              <p className="text-xs text-slate-500 dark:text-ivory-400">Баланс бүртгэл ба ашгийн тооцоо</p>
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
            <div className="w-full sm:w-auto">{pageTabs}</div>
            <div className="inline-flex items-center gap-1 rounded-2xl border border-slate-200 dark:border-dark-600 bg-white dark:bg-dark-800 p-1">
              {DASHBOARD_TIMEZONES.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => setDashboardTimeZone(option.key)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition ${dashboardTimeZone === option.key
                    ? "bg-maroon-600 text-white shadow"
                    : "text-slate-500 dark:text-ivory-400 hover:bg-slate-100 dark:hover:bg-dark-700"}`}
                  title={option.label}
                >
                  {option.short}
                </button>
              ))}
            </div>
            <button
              onClick={onLogout}
              className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-white dark:bg-dark-800 border border-slate-200 dark:border-dark-600 text-sm font-medium hover:bg-slate-100 dark:hover:bg-dark-700 transition"
            >
              <LogOut className="w-4 h-4" /> Гарах
            </button>
          </div>
        </div>

        <BalanceSection dashboardTimeZone={dashboardTimeZone} />
        <ProfitSection dashboardTimeZone={dashboardTimeZone} />
      </div>
    </div>
  );
}

// ── Section A: Balance accounting ────────────────────────────────────────────

function BalanceSection({ dashboardTimeZone }: { dashboardTimeZone: DashboardTimeZone }) {
  const [selectedAdminId, setSelectedAdminId] = useState<number | null>(() => readStoredBalanceAdminId());
  const [historyOpen, setHistoryOpen] = useState(false);
  const timeZoneMeta = dashboardTimeZoneConfig(dashboardTimeZone);

  useEffect(() => {
    if (selectedAdminId == null) {
      localStorage.removeItem(BALANCE_ADMIN_STORAGE);
      return;
    }
    localStorage.setItem(BALANCE_ADMIN_STORAGE, String(selectedAdminId));
  }, [selectedAdminId]);

  const balanceQ = useQuery({
    queryKey: ["dashboard-balance", selectedAdminId, dashboardTimeZone],
    queryFn: () => fetchBalanceSummary({ admin_id: selectedAdminId ?? undefined, tz: dashboardTimeZone }),
    staleTime: 30_000,
  });

  const historyQ = useQuery({
    queryKey: ["dashboard-balance-history", dashboardTimeZone],
    queryFn: () => fetchBalanceHistory({ days: 60, tz: dashboardTimeZone }),
    enabled: historyOpen,
    staleTime: 60_000,
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
          <h2 className="text-base font-bold">Баланс бүртгэл</h2>
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
            <span className="text-xs tabular-nums">{balanceQ.data?.date || todayIso(dashboardTimeZone)} <span className="text-slate-400">({timeZoneMeta.short})</span></span>
          </div>
          <button
            onClick={() => setHistoryOpen((current) => !current)}
            className={`h-10 w-10 inline-flex items-center justify-center rounded-xl border transition ${historyOpen
              ? "border-maroon-300 bg-maroon-50 text-maroon-700 dark:border-gold-500/40 dark:bg-dark-700"
              : "border-slate-200 bg-slate-50 text-slate-500 dark:border-dark-600 dark:bg-dark-700 dark:text-ivory-300"}`}
            title="Өдрийн тооцооны түүх"
          >
            <History className="w-4 h-4" />
          </button>
          <button
            onClick={() => balanceQ.refetch()}
            className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 dark:bg-dark-700 text-xs font-semibold hover:bg-slate-200 dark:hover:bg-dark-600 transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${balanceQ.isFetching ? "animate-spin" : ""}`} /> Шинэчлэх
          </button>
        </div>
      </div>

      <p className="text-[11px] text-slate-500 dark:text-ivory-400 mb-4 bg-slate-50 dark:bg-dark-700/50 rounded-xl p-3 leading-relaxed">
        <b>Өмнөх баланс</b> нь өмнөх өдрөөс автоматаар шилжинэ.
        <b>Руб→төг</b>, <b>Төг→руб</b> дүнг систем тухайн админы амжилттай transaction-уудаас автоматаар уншина.
        <b>Бусад орлого/зарлага</b> нь таг, тайлбартай <b>+/- мөрөөр</b> тусдаа бүртгэгдэнэ.
        Систем <b>Өмнөх баланс + Руб→төг − Төг→руб</b> томьёогоор <b>Тооцоолсон дүн</b>-г бодно.
        <b>Оруулсан баланс</b> нь тухайн банк дансанд байгаа бодит мөнгө, харин <b>Зөрүү = Тооцоолсон дүн − Оруулсан баланс</b>.
        <b>{timeZoneMeta.label}-аар өдөр дуусахад Тооцоолсон дүн автоматаар маргаашийн "Өмнөх баланс" болж шилжинэ.</b>
      </p>

      {historyOpen && (
        <div className="mb-4">
          {historyQ.error ? (
            <div className="text-sm text-red-500 px-4 py-3 rounded-2xl border border-red-200 bg-red-50">
              {getApiErrorDetail(historyQ.error, "Балансын түүх ачаалж чадсангүй.")}
            </div>
          ) : (
            <BalanceHistoryPanel
              rows={historyQ.data?.rows || []}
              loading={historyQ.isLoading || historyQ.isFetching}
              onDownload={() => exportBalanceHistoryCsv(historyQ.data?.rows || [])}
            />
          )}
        </div>
      )}

      {balanceQ.error ? (
        <div className="text-sm text-red-500 py-6 text-center px-4">
          {getApiErrorDetail(balanceQ.error, "Баланс ачаалж чадсангүй.")}
        </div>
      ) : balanceQ.isLoading || !balanceQ.data ? (
        <div className="flex justify-center py-10"><Loader2 className="w-7 h-7 text-maroon-600 animate-spin" /></div>
      ) : (
        <BalanceBody data={balanceQ.data} dashboardTimeZone={dashboardTimeZone} selectedAdminId={selectedAdminId} onChanged={() => balanceQ.refetch()} />
      )}
    </div>
  );
}

function BalanceBody({
  data,
  dashboardTimeZone,
  selectedAdminId,
  onChanged,
}: {
  data: BalanceSummary;
  dashboardTimeZone: DashboardTimeZone;
  selectedAdminId: number | null;
  onChanged: () => void;
}) {
  const viewLabel = selectedAdminId == null ? "Бүх админ" : adminLabel(data.admins, selectedAdminId);
  const showAdminScopedDetails = selectedAdminId != null;
  return (
    <div className="space-y-5">
      <div className="text-sm font-semibold">Ерөнхий тооцоолуур</div>

      <div className="flex flex-col gap-1 text-xs text-slate-500 dark:text-ivory-400 md:flex-row md:items-center md:justify-between">
        <div>
          Харагдаж буй дүн: <span className="font-semibold text-slate-700 dark:text-ivory-200">{viewLabel}</span>
        </div>
        <div>
          Харагдаж буй дансны тоо: <span className="font-semibold text-slate-700 dark:text-ivory-200">{data.accounts.length}</span>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-7 gap-3">
        <BalanceStat label="Өмнөх өдрийн баланс" value={fmtRub(data.prev_balance_total)} />
        <BalanceStat label="Өнөөдрийн руб→төг" value={fmtRub(data.rub_to_mnt_rub)} tone="pos" />
        <BalanceStat label="Өнөөдрийн төг→руб" value={fmtRub(data.mnt_to_rub_rub)} tone="neg" />
        <BalanceStat label="Бусад орлого/зарлага" value={fmtRub(data.adjustment_total)} />
        <BalanceStat label="Тооцоолсон дүн" value={fmtRub(data.total_balance)} accent />
        <BalanceStat label="Оруулсан баланс" value={fmtRub(data.entered_balance_total)} />
        <BalanceStat
          label="Зөрүү"
          value={data.difference_total == null ? "—" : fmtRub(data.difference_total)}
          tone={data.difference_total == null ? undefined : data.difference_total > 0 ? "pos" : data.difference_total < 0 ? "neg" : undefined}
        />
      </div>

      {showAdminScopedDetails && data.missing_entered_balance_count > 0 && (
        <div className="flex items-start gap-2 text-xs bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300 rounded-xl p-3">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <div>
            {data.missing_entered_balance_count} дансанд өнөөдрийн оруулсан баланс хараахан ороогүй байна. Дутуу мөрүүд дээр оруулсан дүнг хадгалсны дараа
            нийт "Зөрүү" автоматаар гарна.
          </div>
        </div>
      )}

      {data.daily_balances.length > 0 && (
        <DailyBalanceRowsTable
          rows={data.daily_balances}
          onChanged={onChanged}
          readOnly
        />
      )}

      {showAdminScopedDetails && (
        <TreasuryAccountsTable
          accounts={data.accounts}
          admins={data.admins}
          dashboardTimeZone={dashboardTimeZone}
          selectedAdminId={selectedAdminId}
          onChanged={onChanged}
        />
      )}

      {showAdminScopedDetails && (
        <BalanceAdjustmentsPanel
          accounts={data.accounts}
          adjustments={data.adjustments}
          balanceDate={data.date}
          totalAdjustment={data.adjustment_total}
          canAdd
          onChanged={onChanged}
        />
      )}
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

function DailyBalanceRowsTable({
  rows,
  onChanged,
  readOnly = false,
}: {
  rows: DailyBalanceRow[];
  onChanged: () => void;
  readOnly?: boolean;
}) {
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
      <div className="text-sm font-semibold">
        {rows.length > 1 ? "Админ тус бүрийн нийт дүн" : "Админы нийт дүн"}
      </div>

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
                <BalanceMiniStat label="Бусад орлого/зарлага" value={fmtRub(row.adjustment_total)} />
                <BalanceMiniStat label="Тооцоолсон" value={fmtRub(row.calculated_balance)} accent />
                {readOnly ? (
                  <BalanceMiniStat label="Оруулсан баланс" value={row.entered_balance == null ? "—" : fmtRub(row.entered_balance)} />
                ) : (
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
                )}
              </div>

              {!readOnly && (
                <button
                  onClick={() => save(row)}
                  disabled={!isDirty(row) || busyAdminId === row.admin_id}
                  className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-maroon-600 text-white text-sm font-semibold disabled:opacity-40 hover:bg-maroon-700 transition"
                >
                  {busyAdminId === row.admin_id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Хадгалах
                </button>
              )}
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
              <th className="py-2 px-2 font-medium text-right">Бусад орлого/зарлага (₽)</th>
              <th className="py-2 px-2 font-medium text-right">Тооцоолсон дүн (₽)</th>
              <th className="py-2 px-2 font-medium text-right">Оруулсан баланс (₽)</th>
              <th className="py-2 px-2 font-medium text-right">Зөрүү (₽)</th>
              {!readOnly && <th className="py-2 pl-2 font-medium text-right">Үйлдэл</th>}
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
                    {readOnly ? (
                      <div className="rounded-xl border border-slate-200 dark:border-dark-600 bg-white dark:bg-dark-800 px-3 py-2 text-sm text-right tabular-nums">
                        {row.entered_balance == null ? "—" : fmtRub(row.entered_balance)}
                      </div>
                    ) : (
                      <input
                        type="number"
                        className={`${INPUT_CLASS} text-right`}
                        value={draft.entered_balance}
                        onChange={(e) => setDraft(row.admin_id, { entered_balance: e.target.value })}
                        placeholder="0"
                      />
                    )}
                  </td>
                  <td className={`py-2 px-2 text-right tabular-nums font-semibold ${difference == null ? "text-slate-400" : difference > 0 ? "text-emerald-600 dark:text-emerald-400" : difference < 0 ? "text-rose-600 dark:text-rose-400" : "text-slate-700 dark:text-ivory-200"}`}>
                    {difference == null ? "—" : fmtRub(difference)}
                  </td>
                  {!readOnly && (
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
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BalanceHistoryPanel({
  rows,
  loading,
  onDownload,
}: {
  rows: BalanceHistoryRow[];
  loading: boolean;
  onDownload: () => void;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 dark:border-dark-600 bg-white dark:bg-dark-800 p-4 space-y-3">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="text-sm font-semibold">Өдрийн тооцооны түүх</div>
          <div className="text-xs text-slate-500 dark:text-ivory-400">Ерөнхий мөр болон админ тус бүрийн өдөр дууссан тооцоог хадгална.</div>
        </div>
        <button
          onClick={onDownload}
          disabled={loading || rows.length === 0}
          className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 dark:bg-dark-700 text-xs font-semibold hover:bg-slate-200 dark:hover:bg-dark-600 transition disabled:opacity-40"
        >
          <Download className="w-4 h-4" /> CSV
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 text-maroon-600 animate-spin" /></div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 dark:border-dark-600 px-4 py-6 text-sm text-slate-400 text-center">
          Хадгалагдсан өдрийн тооцоо хараахан алга байна.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-slate-500 dark:text-ivory-400 border-b border-slate-200 dark:border-dark-600">
                <th className="py-2 pr-2 font-medium">Огноо</th>
                <th className="py-2 px-2 font-medium">Админ нэр</th>
                <th className="py-2 px-2 font-medium text-right">Өмнөх баланс</th>
                <th className="py-2 px-2 font-medium text-right">Руб→төг</th>
                <th className="py-2 px-2 font-medium text-right">Төг→руб</th>
                <th className="py-2 px-2 font-medium text-right">Бусад орлого/зарлага</th>
                <th className="py-2 px-2 font-medium text-right">Тооцоолсон дүн</th>
                <th className="py-2 px-2 font-medium text-right">Оруулсан баланс</th>
                <th className="py-2 pl-2 font-medium text-right">Зөрүү</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.row_key} className="border-b border-slate-100 dark:border-dark-700">
                  <td className="py-2 pr-2 tabular-nums whitespace-nowrap">{row.balance_date}</td>
                  <td className="py-2 px-2 min-w-[160px] font-semibold">
                    {row.scope_type === "all" ? "Бүх админ" : row.admin_name || `ID ${row.admin_id}`}
                  </td>
                  <td className="py-2 px-2 text-right tabular-nums">{fmtRub(row.opening_balance)}</td>
                  <td className="py-2 px-2 text-right tabular-nums text-emerald-600 dark:text-emerald-400">{fmtRub(row.rub_to_mnt_rub)}</td>
                  <td className="py-2 px-2 text-right tabular-nums text-rose-600 dark:text-rose-400">{fmtRub(row.mnt_to_rub_rub)}</td>
                  <td className="py-2 px-2 text-right tabular-nums">{fmtRub(row.adjustment_total)}</td>
                  <td className="py-2 px-2 text-right tabular-nums font-semibold">{fmtRub(row.calculated_balance)}</td>
                  <td className="py-2 px-2 text-right tabular-nums">{row.entered_balance == null ? "—" : fmtRub(row.entered_balance)}</td>
                  <td className={`py-2 pl-2 text-right tabular-nums font-semibold ${row.discrepancy == null ? "text-slate-400" : row.discrepancy > 0 ? "text-emerald-600 dark:text-emerald-400" : row.discrepancy < 0 ? "text-rose-600 dark:text-rose-400" : "text-slate-700 dark:text-ivory-200"}`}>
                    {row.discrepancy == null ? "—" : fmtRub(row.discrepancy)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
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
  accounts,
  adjustments,
  balanceDate,
  totalAdjustment,
  canAdd,
  onChanged,
}: {
  accounts: TreasuryAccount[];
  adjustments: BalanceAdjustment[];
  balanceDate: string;
  totalAdjustment: number;
  canAdd: boolean;
  onChanged: () => void;
}) {
  const adjustableAccounts = useMemo(
    () => accounts.filter((account) => account.admin_id != null),
    [accounts],
  );
  const [formAccountId, setFormAccountId] = useState("");
  const [amount, setAmount] = useState("");
  const [tag, setTag] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    if (adjustableAccounts.some((account) => account.id === formAccountId)) return;
    setFormAccountId(adjustableAccounts[0]?.id || "");
  }, [adjustableAccounts, formAccountId]);

  const add = async () => {
    const selectedAccount = adjustableAccounts.find((account) => account.id === formAccountId);
    const parsedAmount = Number(amount);
    if (!selectedAccount?.admin_id || !tag.trim() || !Number.isFinite(parsedAmount) || parsedAmount === 0) return;
    setSaving(true);
    try {
      await createBalanceAdjustment({
        admin_id: selectedAccount.admin_id,
        treasury_account_id: selectedAccount.id,
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
          <div className="text-sm font-semibold">Бусад орлого / зарлага</div>
          <div className="text-xs text-slate-500 dark:text-ivory-400">Данс бүрт таг, тайлбартай +/− мөр бүртгэнэ. Эдгээр мөр нь тооцоолсон баланст орохгүй.</div>
        </div>
        <div className="text-sm font-semibold tabular-nums">Нийт бүртгэсэн орлого/зарлага: {fmtRub(totalAdjustment)}</div>
      </div>

      {!canAdd ? (
        <div className="rounded-2xl border border-dashed border-slate-200 dark:border-dark-600 px-4 py-5 text-sm text-slate-400">
          Админ сонгосны дараа шинэ орлого / зарлагын мөр нэмнэ.
        </div>
      ) : adjustableAccounts.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 dark:border-dark-600 px-4 py-5 text-sm text-slate-400">
          Бусад орлого/зарлагын мөр нэмэхийн өмнө дор хаяж нэг дансыг админд хуваарилна уу.
        </div>
      ) : (
      <div className="grid grid-cols-1 md:grid-cols-[240px_170px_minmax(0,1fr)_minmax(0,1.4fr)_auto] gap-2 items-end">
        <label>
          <div className="text-[10px] text-slate-400 mb-1">Данс</div>
          <select className={INPUT_CLASS} value={formAccountId} onChange={(e) => setFormAccountId(e.target.value)}>
            <option value="">Данс сонгох</option>
            {adjustableAccounts.map((account) => (
              <option key={account.id} value={account.id}>{`${account.admin_name || `ID ${account.admin_id}`} · ${account.name}`}</option>
            ))}
          </select>
        </label>
        <label>
          <div className="text-[10px] text-slate-400 mb-1">Дүн (₽)</div>
          <input type="number" className={`${INPUT_CLASS} text-right`} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="+1000 эсвэл -500" />
        </label>
        <label>
          <div className="text-[10px] text-slate-400 mb-1">Таг</div>
          <input className={INPUT_CLASS} value={tag} onChange={(e) => setTag(e.target.value)} placeholder="Жишээ: зээл, шимтгэл, буцаалт" />
        </label>
        <label>
          <div className="text-[10px] text-slate-400 mb-1">Тайлбар</div>
          <input className={INPUT_CLASS} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Нэмэлт тайлбар" />
        </label>
        <button
          onClick={add}
          disabled={!formAccountId || !tag.trim() || !amount.trim() || saving}
          className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-maroon-600 text-white text-sm font-semibold hover:bg-maroon-700 transition disabled:opacity-40"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Нэмэх
        </button>
      </div>
      )}

      <div className="space-y-2">
        {adjustments.length === 0 ? (
          <div className="py-6 text-center text-sm text-slate-400 rounded-2xl border border-dashed border-slate-200 dark:border-dark-600">
            Бусад орлого/зарлагын мөр алга байна.
          </div>
        ) : adjustments.map((adjustment) => (
          <div key={adjustment.id} className="flex flex-col gap-2 rounded-2xl border border-slate-200 dark:border-dark-600 bg-white dark:bg-dark-800 px-3 py-3 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-semibold">{adjustment.tag}</span>
                <span className={`tabular-nums font-semibold ${adjustment.amount > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                  {fmtRub(adjustment.amount)}
                </span>
                <span className="text-xs text-slate-400">{adjustment.account_name || "Хуваарилаагүй данс"}</span>
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
  admin_bank_id: string;
  entered_balance: string;
};

function formatAdminBankOption(bank: AdminBankAccountFull) {
  const detail = bank.currency === "RUB"
    ? (bank.card_number || bank.phone || bank.account_number || "")
    : (bank.account_number || bank.card_number || "");
  return [bank.bank_name, bank.owner_name, detail].filter(Boolean).join(" · ");
}

function TreasuryAccountsTable({
  accounts,
  admins,
  dashboardTimeZone,
  selectedAdminId,
  onChanged,
}: {
  accounts: TreasuryAccount[];
  admins: DashboardAdminOption[];
  dashboardTimeZone: DashboardTimeZone;
  selectedAdminId: number | null;
  onChanged: () => void;
}) {
  const adminBanksQ = useQuery({
    queryKey: ["dashboard-admin-bank-accounts"],
    queryFn: fetchDashboardAdminBankAccounts,
    staleTime: 60_000,
  });
  const [drafts, setDrafts] = useState<Record<string, AcctDraft>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [showNewAccountForm, setShowNewAccountForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newBalance, setNewBalance] = useState("");
  const [newAdminId, setNewAdminId] = useState(selectedAdminId != null ? String(selectedAdminId) : "");
  const [newAdminBankId, setNewAdminBankId] = useState("");
  const canAdd = selectedAdminId != null;
  const adminBanks = adminBanksQ.data?.accounts || [];

  useEffect(() => {
    setNewAdminId(selectedAdminId != null ? String(selectedAdminId) : "");
    setNewAdminBankId("");
  }, [selectedAdminId]);

  useEffect(() => {
    if (canAdd) return;
    setShowNewAccountForm(false);
    setNewName("");
    setNewBalance("");
    setNewAdminBankId("");
  }, [canAdd]);

  const availableBanksForAdmin = (adminIdValue: string, currentBankId?: string) => (
    adminBanks.filter((bank) => {
      if (!bank.is_active && bank.id !== currentBankId) return false;
      if (!adminIdValue) return bank.id === currentBankId;
      return bank.admin_id == null || String(bank.admin_id) === adminIdValue || bank.id === currentBankId;
    })
  );

  const draftOf = (account: TreasuryAccount): AcctDraft =>
    drafts[account.id] ?? {
      name: account.name,
      admin_id: account.admin_id != null ? String(account.admin_id) : "",
      admin_bank_id: account.admin_bank_id != null ? String(account.admin_bank_id) : "",
      entered_balance: account.entered_balance != null ? String(account.entered_balance) : "",
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
      || String(draft.admin_bank_id || "") !== String(account.admin_bank_id || "")
      || accountEnteredBalance(draft) !== (account.entered_balance ?? null);
  };

  const save = async (account: TreasuryAccount) => {
    const draft = draftOf(account);
    setBusyId(account.id);
    try {
      await updateTreasuryAccount(account.id, {
        name: draft.name,
        admin_id: draft.admin_id ? Number(draft.admin_id) : null,
        admin_bank_id: draft.admin_bank_id || null,
        entered_balance: accountEnteredBalance(draft),
        tz: dashboardTimeZone,
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
        admin_bank_id: newAdminBankId || null,
        prev_balance: Number(newBalance) || 0,
        display_order: accounts.length,
        tz: dashboardTimeZone,
      });
      setNewName("");
      setNewBalance("");
      setNewAdminId(selectedAdminId != null ? String(selectedAdminId) : "");
      setNewAdminBankId("");
      setShowNewAccountForm(false);
      onChanged();
    } finally {
      setAdding(false);
    }
  };

  const toggleNewAccountForm = () => {
    setShowNewAccountForm((current) => {
      const next = !current;
      if (!next) {
        setNewName("");
        setNewBalance("");
        setNewAdminId(selectedAdminId != null ? String(selectedAdminId) : "");
        setNewAdminBankId("");
      }
      return next;
    });
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:hidden">
        {accounts.map((account) => {
          const draft = draftOf(account);
          const subtotal = accountBalance(account);
          const difference = accountDifference(account, draft);
          return (
            <div key={account.id} className="rounded-2xl border border-slate-200 dark:border-dark-600 p-4 bg-slate-50/80 dark:bg-dark-700/40 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[11px] text-slate-400">Данс</div>
                  <div className="font-semibold">{account.name}</div>
                </div>
                <div className="text-right">
                  <div className="text-[11px] text-slate-400">Тооцоолсон дүн</div>
                  <div className="font-bold tabular-nums text-maroon-600 dark:text-gold-400">{fmtRub(subtotal)}</div>
                  <div className={`text-xs mt-1 tabular-nums ${difference == null ? "text-slate-400" : difference > 0 ? "text-emerald-600 dark:text-emerald-400" : difference < 0 ? "text-rose-600 dark:text-rose-400" : "text-slate-500 dark:text-ivory-400"}`}>
                    Зөрүү: {difference == null ? "—" : fmtRub(difference)}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3">
                <label>
                  <div className="text-[10px] text-slate-400 mb-1">Дансны нэр</div>
                  <input className={INPUT_CLASS} value={draft.name} onChange={(e) => setDraft(account.id, { name: e.target.value })} />
                </label>
                <label>
                  <div className="text-[10px] text-slate-400 mb-1">Хариуцсан админ</div>
                  <select className={INPUT_CLASS} value={draft.admin_id} onChange={(e) => setDraft(account.id, { admin_id: e.target.value, admin_bank_id: "" })}>
                    <option value="">Хуваарилаагүй</option>
                    {admins.map((admin) => (
                      <option key={admin.admin_id} value={admin.admin_id}>{admin.name || `ID ${admin.admin_id}`}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <div className="text-[10px] text-slate-400 mb-1">Холбосон банк</div>
                  <select className={INPUT_CLASS} value={draft.admin_bank_id} onChange={(e) => setDraft(account.id, { admin_bank_id: e.target.value })}>
                    <option value="">Сонгоогүй</option>
                    {availableBanksForAdmin(draft.admin_id, draft.admin_bank_id).map((bank) => (
                      <option key={bank.id} value={bank.id}>{formatAdminBankOption(bank)}</option>
                    ))}
                  </select>
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label>
                    <div className="text-[10px] text-slate-400 mb-1">Өмнөх баланс</div>
                    <div className="rounded-xl border border-slate-200 dark:border-dark-600 bg-white dark:bg-dark-800 px-3 py-2 text-sm text-right tabular-nums">{fmtRub(account.prev_balance)}</div>
                  </label>
                  <label>
                    <div className="text-[10px] text-slate-400 mb-1">Руб→төг</div>
                    <div className="rounded-xl border border-slate-200 dark:border-dark-600 bg-white dark:bg-dark-800 px-3 py-2 text-sm text-right tabular-nums text-emerald-600 dark:text-emerald-400">{fmtRub(account.rub_to_mnt)}</div>
                  </label>
                  <label>
                    <div className="text-[10px] text-slate-400 mb-1">Төг→руб</div>
                    <div className="rounded-xl border border-slate-200 dark:border-dark-600 bg-white dark:bg-dark-800 px-3 py-2 text-sm text-right tabular-nums text-rose-600 dark:text-rose-400">{fmtRub(account.mnt_to_rub)}</div>
                  </label>
                  <label>
                    <div className="text-[10px] text-slate-400 mb-1">Бусад орлого/зарлага</div>
                    <div className="rounded-xl border border-slate-200 dark:border-dark-600 bg-white dark:bg-dark-800 px-3 py-2 text-sm text-right tabular-nums">{fmtRub(accountAdjustmentTotal(account))}</div>
                  </label>
                  <label>
                    <div className="text-[10px] text-slate-400 mb-1">Оруулсан баланс</div>
                    <input type="number" className={`${INPUT_CLASS} text-right`} value={draft.entered_balance} onChange={(e) => setDraft(account.id, { entered_balance: e.target.value })} placeholder="Бодит үлдэгдэл" />
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
              <th className="py-2 px-2 font-medium">Холбосон банк</th>
              <th className="py-2 px-2 font-medium text-right">Өмнөх баланс (₽)</th>
              <th className="py-2 px-2 font-medium text-right">Руб→төг (₽)</th>
              <th className="py-2 px-2 font-medium text-right">Төг→руб (₽)</th>
              <th className="py-2 px-2 font-medium text-right">Бусад орлого/зарлага (₽)</th>
              <th className="py-2 px-2 font-medium text-right">Тооцоолсон дүн (₽)</th>
              <th className="py-2 px-2 font-medium text-right">Оруулсан баланс (₽)</th>
              <th className="py-2 px-2 font-medium text-right">Зөрүү (₽)</th>
              <th className="py-2 pl-2 font-medium text-right">Үйлдэл</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((account) => {
              const draft = draftOf(account);
              const subtotal = accountBalance(account);
              const difference = accountDifference(account, draft);
              return (
                <tr key={account.id} className="border-b border-slate-100 dark:border-dark-700">
                  <td className="py-2 pr-2 min-w-[180px]">
                    <input className={INPUT_CLASS} value={draft.name} onChange={(e) => setDraft(account.id, { name: e.target.value })} />
                  </td>
                  <td className="py-2 px-2 min-w-[180px]">
                    <select className={INPUT_CLASS} value={draft.admin_id} onChange={(e) => setDraft(account.id, { admin_id: e.target.value, admin_bank_id: "" })}>
                      <option value="">Хуваарилаагүй</option>
                      {admins.map((admin) => (
                        <option key={admin.admin_id} value={admin.admin_id}>{admin.name || `ID ${admin.admin_id}`}</option>
                      ))}
                    </select>
                  </td>
                  <td className="py-2 px-2 min-w-[260px]">
                    <select className={INPUT_CLASS} value={draft.admin_bank_id} onChange={(e) => setDraft(account.id, { admin_bank_id: e.target.value })}>
                      <option value="">Сонгоогүй</option>
                      {availableBanksForAdmin(draft.admin_id, draft.admin_bank_id).map((bank) => (
                        <option key={bank.id} value={bank.id}>{formatAdminBankOption(bank)}</option>
                      ))}
                    </select>
                  </td>
                  <td className="py-2 px-2 text-right tabular-nums">{fmtRub(account.prev_balance)}</td>
                  <td className="py-2 px-2 text-right tabular-nums text-emerald-600 dark:text-emerald-400">{fmtRub(account.rub_to_mnt)}</td>
                  <td className="py-2 px-2 text-right tabular-nums text-rose-600 dark:text-rose-400">{fmtRub(account.mnt_to_rub)}</td>
                  <td className="py-2 px-2 w-36">
                    <div className="rounded-xl border border-slate-200 dark:border-dark-600 bg-white dark:bg-dark-800 px-3 py-2 text-sm text-right tabular-nums">{fmtRub(accountAdjustmentTotal(account))}</div>
                  </td>
                  <td className="py-2 px-2 text-right tabular-nums font-semibold">{fmtRub(subtotal)}</td>
                  <td className="py-2 px-2 w-36">
                    <input type="number" className={`${INPUT_CLASS} text-right`} value={draft.entered_balance} onChange={(e) => setDraft(account.id, { entered_balance: e.target.value })} placeholder="Бодит үлдэгдэл" />
                  </td>
                  <td className={`py-2 px-2 text-right tabular-nums font-semibold ${difference == null ? "text-slate-400" : difference > 0 ? "text-emerald-600 dark:text-emerald-400" : difference < 0 ? "text-rose-600 dark:text-rose-400" : "text-slate-700 dark:text-ivory-200"}`}>{difference == null ? "—" : fmtRub(difference)}</td>
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
              <tr><td colSpan={11} className="py-6 text-center text-slate-400">Данс алга. Эхлээд баланс тооцох данс нэмнэ үү.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="rounded-2xl border border-slate-100 dark:border-dark-700 bg-slate-50 dark:bg-dark-700/30 p-3 md:p-4 space-y-3">
        {!canAdd ? (
          <div className="rounded-xl border border-dashed border-slate-200 dark:border-dark-600 bg-white/80 dark:bg-dark-800/70 px-3 py-4 text-sm text-slate-400">
            Админ сонгосны дараа шинэ балансын данс нэмнэ.
          </div>
        ) : (
          <>
            <button
              type="button"
              onClick={toggleNewAccountForm}
              className="w-full flex items-center justify-between gap-3 rounded-xl border border-dashed border-slate-200 dark:border-dark-600 bg-white/80 dark:bg-dark-800/70 px-3 py-3 text-left hover:border-maroon-300 hover:bg-white transition"
            >
              <span className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-maroon-600 text-white shadow-sm">
                  <Plus className={`w-4 h-4 transition-transform ${showNewAccountForm ? "rotate-45" : ""}`} />
                </span>
                <span>
                  <span className="block text-sm font-semibold text-slate-800 dark:text-ivory-100">New bank account</span>
                  <span className="block text-xs text-slate-400">Одоо байгаа данс нэмэх формыг нээх</span>
                </span>
              </span>
              <span className="text-xs font-medium text-slate-500 dark:text-ivory-400">{showNewAccountForm ? "Хаах" : "Нээх"}</span>
            </button>

            {showNewAccountForm && (
              <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_220px_minmax(0,1fr)_180px_auto] gap-2 items-end">
                <label>
                  <div className="text-[10px] text-slate-400 mb-1">Дансны нэр</div>
                  <input className={INPUT_CLASS} placeholder="Жишээ: Сбербанк ₽" value={newName} onChange={(e) => setNewName(e.target.value)} />
                </label>
                <label>
                  <div className="text-[10px] text-slate-400 mb-1">Хариуцсан админ</div>
                  <select className={INPUT_CLASS} value={newAdminId} onChange={(e) => { setNewAdminId(e.target.value); setNewAdminBankId(""); }}>
                    <option value="">Хуваарилаагүй</option>
                    {admins.map((admin) => (
                      <option key={admin.admin_id} value={admin.admin_id}>{admin.name || `ID ${admin.admin_id}`}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <div className="text-[10px] text-slate-400 mb-1">Холбосон банк</div>
                  <select className={INPUT_CLASS} value={newAdminBankId} onChange={(e) => setNewAdminBankId(e.target.value)}>
                    <option value="">Сонгоогүй</option>
                    {availableBanksForAdmin(newAdminId, newAdminBankId).map((bank) => (
                      <option key={bank.id} value={bank.id}>{formatAdminBankOption(bank)}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <div className="text-[10px] text-slate-400 mb-1">Эхлэх баланс</div>
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
            )}
          </>
        )}
      </div>
    </div>
  );
}

function exportBalanceHistoryCsv(rows: BalanceHistoryRow[]) {
  const headers = [
    "balance_date",
    "scope",
    "admin_id",
    "admin_name",
    "opening_balance",
    "rub_to_mnt_rub",
    "mnt_to_rub_rub",
    "adjustment_total",
    "calculated_balance",
    "entered_balance",
    "discrepancy",
  ];
  const escape = (value: unknown) => {
    const str = value == null ? "" : String(value);
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };
  const csv = [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => {
      if (header === "scope") {
        return escape(row.scope_type === "all" ? "Бүх админ" : "Админ");
      }
      return escape((row as unknown as Record<string, unknown>)[header]);
    }).join(",")),
  ].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `dashboard-balance-history-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Section B: Profit calculator ─────────────────────────────────────────────

function ProfitSection({ dashboardTimeZone }: { dashboardTimeZone: DashboardTimeZone }) {
  const [period, setPeriod] = useState<ProfitPeriod>("today");
  const [custom, setCustom] = useState({ start: "", end: "" });
  const [showTransactions, setShowTransactions] = useState(false);
  const range = useMemo(() => profitRange(period, custom, dashboardTimeZone), [period, custom, dashboardTimeZone]);

  const profitQ = useQuery({
    queryKey: ["dashboard-profit", range.start, range.end, dashboardTimeZone],
    queryFn: () => fetchProfit({ start: range.start, end: range.end, tz: dashboardTimeZone }),
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
          <button
            onClick={() => setShowTransactions(true)}
            className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 dark:bg-dark-700 text-xs font-semibold hover:bg-slate-200 dark:hover:bg-dark-600 transition"
          >
            Жагсаалт харах
          </button>
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

      <PlaneTicketSalesManager range={range} dashboardTimeZone={dashboardTimeZone} todayDate={todayIso(dashboardTimeZone)} onSaved={refreshProfit} />
      <CostRateManager range={range} dashboardTimeZone={dashboardTimeZone} todayDate={todayIso(dashboardTimeZone)} onSaved={refreshProfit} />

      {showTransactions && (
        <ProfitTransactionsModal
          range={range}
          dashboardTimeZone={dashboardTimeZone}
          onClose={() => setShowTransactions(false)}
        />
      )}
    </div>
  );
}

function ProfitTransactionsModal({
  range,
  dashboardTimeZone,
  onClose,
}: {
  range: { start?: string; end?: string };
  dashboardTimeZone: DashboardTimeZone;
  onClose: () => void;
}) {
  const [sortBy, setSortBy] = useState<"timestamp" | "invoice_id">("timestamp");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const txQ = useQuery({
    queryKey: ["dashboard-profit-transactions", range.start, range.end, dashboardTimeZone],
    queryFn: () => fetchProfitTransactions({ start: range.start, end: range.end, tz: dashboardTimeZone, include_tickets: true }),
    staleTime: 30_000,
  });

  const sortedItems = useMemo(() => {
    const items = [...(txQ.data?.items || [])];
    const factor = sortDir === "asc" ? 1 : -1;
    items.sort((a, b) => {
      if (sortBy === "invoice_id") {
        const aInvoice = (a.invoice_id || "").toUpperCase();
        const bInvoice = (b.invoice_id || "").toUpperCase();
        if (aInvoice < bInvoice) return -1 * factor;
        if (aInvoice > bInvoice) return 1 * factor;
        const aTs = String(a.timestamp || "");
        const bTs = String(b.timestamp || "");
        return aTs.localeCompare(bTs) * -1;
      }
      const aTs = String(a.timestamp || "");
      const bTs = String(b.timestamp || "");
      const tsCmp = aTs.localeCompare(bTs);
      if (tsCmp !== 0) return tsCmp * factor;
      const aInvoice = (a.invoice_id || "").toUpperCase();
      const bInvoice = (b.invoice_id || "").toUpperCase();
      return aInvoice.localeCompare(bInvoice);
    });
    return items;
  }, [txQ.data?.items, sortBy, sortDir]);

  const toggleSortDir = () => {
    setSortDir((current) => (current === "asc" ? "desc" : "asc"));
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="w-full max-w-6xl max-h-[88vh] overflow-hidden rounded-2xl border border-slate-200 dark:border-dark-600 bg-white dark:bg-dark-800 shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-dark-600">
          <div>
            <div className="text-sm font-bold">Ашгийн дэлгэрэнгүй жагсаалт</div>
            <div className="text-xs text-slate-500 dark:text-ivory-400">Нийт мөр: {txQ.data?.count ?? 0}</div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-dark-700 transition"
            title="Хаах"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 overflow-auto">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="text-xs text-slate-500 dark:text-ivory-400">Эрэмбэлэх:</span>
            <button
              onClick={() => setSortBy("timestamp")}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold transition ${sortBy === "timestamp"
                ? "bg-maroon-600 text-white"
                : "bg-slate-100 dark:bg-dark-700 text-slate-600 dark:text-ivory-300 hover:bg-slate-200 dark:hover:bg-dark-600"}`}
            >
              Timestamp
            </button>
            <button
              onClick={() => setSortBy("invoice_id")}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold transition ${sortBy === "invoice_id"
                ? "bg-maroon-600 text-white"
                : "bg-slate-100 dark:bg-dark-700 text-slate-600 dark:text-ivory-300 hover:bg-slate-200 dark:hover:bg-dark-600"}`}
            >
              Invoice ID
            </button>
            <button
              onClick={toggleSortDir}
              className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 dark:bg-dark-700 text-slate-600 dark:text-ivory-300 hover:bg-slate-200 dark:hover:bg-dark-600 transition"
            >
              {sortDir === "asc" ? "Өсөх" : "Буурах"}
            </button>
          </div>

          {txQ.error ? (
            <div className="text-sm text-red-500 py-8 text-center">Дэлгэрэнгүй жагсаалт ачаалж чадсангүй.</div>
          ) : txQ.isLoading || !txQ.data ? (
            <div className="flex justify-center py-10"><Loader2 className="w-7 h-7 text-maroon-600 animate-spin" /></div>
          ) : txQ.data.items.length === 0 ? (
            <div className="py-8 text-center text-sm text-slate-400">Энэ хугацаанд ашиг бодогдох мөр алга.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-slate-500 dark:text-ivory-400 border-b border-slate-200 dark:border-dark-600">
                    <th className="py-2 pr-2 font-medium">Invoice/ID</th>
                    <th className="py-2 px-2 font-medium">Огноо</th>
                    <th className="py-2 px-2 font-medium">Чиглэл</th>
                    <th className="py-2 px-2 font-medium text-right">Дүн</th>
                    <th className="py-2 px-2 font-medium text-right">Rate</th>
                    <th className="py-2 px-2 font-medium text-right">Өртөг</th>
                    <th className="py-2 px-2 font-medium text-right">RUB</th>
                    <th className="py-2 pl-2 font-medium text-right">Ашиг (₮)</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedItems.map((row, idx) => (
                    <tr key={`${row.invoice_id || "row"}-${idx}`} className="border-b border-slate-100 dark:border-dark-700">
                      <td className="py-2 pr-2 font-mono">{row.invoice_id || "—"}</td>
                      <td className="py-2 px-2 whitespace-nowrap">{row.timestamp ? row.timestamp.slice(0, 19).replace("T", " ") : "—"}</td>
                      <td className="py-2 px-2">{row.direction === "buy" ? "Руб→төг" : row.direction === "sell" ? "Төг→руб" : "Тийз"}</td>
                      <td className="py-2 px-2 text-right tabular-nums">{fmtNum(row.amount, 2)} {row.currency_from || ""}</td>
                      <td className="py-2 px-2 text-right tabular-nums">{fmtRate(row.rate)}</td>
                      <td className="py-2 px-2 text-right tabular-nums">{fmtRate(row.cost_rate)}</td>
                      <td className="py-2 px-2 text-right tabular-nums">{fmtRub(row.rub_equivalent)}</td>
                      <td className={`py-2 pl-2 text-right tabular-nums font-semibold ${row.profit_mnt < 0 ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400"}`}>
                        {fmtMnt(row.profit_mnt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
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

function PlaneTicketSalesManager({
  range,
  dashboardTimeZone,
  todayDate,
  onSaved,
}: {
  range: { start?: string; end?: string; startDate?: string; endDate?: string };
  dashboardTimeZone: DashboardTimeZone;
  todayDate: string;
  onSaved: () => void;
}) {
  const [saleDate, setSaleDate] = useState(todayDate);
  const [soldPrice, setSoldPrice] = useState("");
  const [exchangeRate, setExchangeRate] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setSaleDate(todayDate);
  }, [todayDate]);

  const salesQ = useQuery({
    queryKey: ["dashboard-plane-ticket-sales", range.startDate, range.endDate, dashboardTimeZone],
    queryFn: () => fetchPlaneTicketSales({ start: range.startDate, end: range.endDate, tz: dashboardTimeZone }),
    staleTime: 30_000,
  });

  const costPreviewQ = useQuery({
    queryKey: ["dashboard-cost-rate-preview", saleDate, dashboardTimeZone],
    queryFn: () => fetchCostRates({ end: saleDate, tz: dashboardTimeZone }),
    staleTime: 30_000,
  });

  const costRateRow = useMemo(
    () => (costPreviewQ.data || []).find((rate) => rate.cost_rate != null) ?? null,
    [costPreviewQ.data],
  );

  const costRatePreview = costRateRow?.cost_rate ?? null;
  const soldPriceValue = Number(soldPrice);
  const exchangeRateValue = Number(exchangeRate);
  const manualExchangeRate = exchangeRateValue > 0 ? exchangeRateValue : null;
  const rubPreview = soldPriceValue > 0 && manualExchangeRate ? soldPriceValue / manualExchangeRate : null;
  const profitPreview = rubPreview != null && manualExchangeRate != null && costRatePreview != null
    ? (manualExchangeRate - costRatePreview) * rubPreview
    : null;

  const save = async () => {
    if (!(soldPriceValue > 0) || !(exchangeRateValue > 0)) return;
    setSaving(true);
    setMessage(null);
    try {
      await createPlaneTicketSale({ sale_date: saleDate, sold_price_mnt: soldPriceValue, exchange_rate: exchangeRateValue, notes });
      setSoldPrice("");
      setExchangeRate("");
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
  const canSave = soldPriceValue > 0 && manualExchangeRate != null && costRatePreview != null && !saving;

  return (
    <div className="mt-5 pt-5 border-t border-slate-100 dark:border-dark-700 space-y-4">
      <div className="flex items-center gap-2">
        <Plane className="w-4 h-4 text-maroon-600 dark:text-gold-400" />
        <h3 className="text-sm font-bold">Онгоцны тийзийн борлуулалт</h3>
      </div>

      <p className="text-[11px] text-slate-500 dark:text-ivory-400 leading-relaxed bg-slate-50 dark:bg-dark-700/50 rounded-xl p-3">
        Админ <b>зарагдсан үнэ</b>, <b>ханш</b>, <b>тайлбар</b> оруулна. <b>Ханшийг гараар заавал оруулна.</b> Систем тухайн оруулсан ханш болон өртөг ханшийг ашиглаад руб дүн, ашгийг автоматаар тооцно.
      </p>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <ProfitCard label="Тийзийн мөр" value={fmtNum(summary?.count)} />
        <ProfitCard label="Нийт зарагдсан үнэ" value={fmtMnt(summary?.total_sold_price_mnt)} />
        <ProfitCard label="Тийзийн ашиг" value={fmtMnt(summary?.total_profit)} />
        <ProfitCard label="Өртөг ханш" value={costRatePreview == null ? "—" : fmtRate(costRatePreview)} sub={costRateRow && costRateRow.rate_date !== saleDate ? `${costRateRow.rate_date}-ны ханш ашиглаж байна` : undefined} />
      </div>

      <div className="rounded-2xl border border-slate-100 dark:border-dark-700 bg-slate-50 dark:bg-dark-700/30 p-3 md:p-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-[180px_220px_180px_minmax(0,1fr)_auto] gap-2 items-end">
          <label>
            <div className="text-[10px] text-slate-400 mb-1">Огноо</div>
            <input type="date" className={INPUT_CLASS} value={saleDate} onChange={(e) => setSaleDate(e.target.value)} />
          </label>
          <label>
            <div className="text-[10px] text-slate-400 mb-1">Зарагдсан үнэ (₮)</div>
            <input type="number" className={`${INPUT_CLASS} text-right`} placeholder="0" value={soldPrice} onChange={(e) => setSoldPrice(e.target.value)} />
          </label>
          <label>
            <div className="text-[10px] text-slate-400 mb-1">Ханш</div>
            <input type="number" min="0.0001" step="0.0001" className={`${INPUT_CLASS} text-right`} placeholder="0.0000" value={exchangeRate} onChange={(e) => setExchangeRate(e.target.value)} />
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
          <BalanceStat label="Оруулсан ханш" value={manualExchangeRate == null ? "—" : fmtRate(manualExchangeRate)} />
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
              <Metric label="Ханш" value={fmtRate(sale.exchange_rate)} />
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
              <th className="py-2 px-2 font-medium text-right">Ханш</th>
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

function CostRateManager({
  range,
  dashboardTimeZone,
  todayDate,
  onSaved,
}: {
  range: { start?: string; end?: string; startDate?: string; endDate?: string };
  dashboardTimeZone: DashboardTimeZone;
  todayDate: string;
  onSaved: () => void;
}) {
  const [date, setDate] = useState(todayDate);
  const [usd, setUsd] = useState("");
  const [black, setBlack] = useState("");
  const [fetchingRate, setFetchingRate] = useState(false);
  const [rateMsg, setRateMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [periodUsd, setPeriodUsd] = useState("");
  const [savingPeriod, setSavingPeriod] = useState(false);

  useEffect(() => {
    setDate(todayDate);
  }, [todayDate]);

  useEffect(() => {
    if (!periodStart) setPeriodStart(range.startDate || todayDate);
    if (!periodEnd) setPeriodEnd(range.endDate || todayDate);
  }, [periodEnd, periodStart, range.endDate, range.startDate, todayDate]);

  const listRange = useMemo(() => ({
    start: range.startDate,
    end: range.endDate,
  }), [range.endDate, range.startDate]);

  const ratesQ = useQuery({
    queryKey: ["dashboard-cost-rates", listRange.start, listRange.end, dashboardTimeZone],
    queryFn: () => fetchCostRates({ ...listRange, tz: dashboardTimeZone }),
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

  const savePeriodUsd = async () => {
    const usdRate = Number(periodUsd);
    if (!periodStart || !periodEnd || !(usdRate > 0)) return;
    setSavingPeriod(true);
    setRateMsg(null);
    try {
      const result = await saveCostRatePeriodUsd({
        start: periodStart,
        end: periodEnd,
        usd_rate: usdRate,
        tz: dashboardTimeZone,
      });
      setRateMsg(`${result.updated_count} өдөрт USD ханш (${usdRate}) хадгаллаа.`);
      await ratesQ.refetch();
      onSaved();
    } catch {
      setRateMsg("Period USD ханш хадгалах үед алдаа гарлаа.");
    } finally {
      setSavingPeriod(false);
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

      <div className="mt-3 rounded-2xl border border-slate-100 dark:border-dark-700 bg-slate-50 dark:bg-dark-700/30 p-3">
        <div className="text-[11px] text-slate-500 dark:text-ivory-400 mb-2">
          Нэг хугацаанд ижил USD ханш оруулах
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2 items-end">
          <label>
            <div className="text-[10px] text-slate-400 mb-1">Эхлэх огноо</div>
            <input type="date" className={INPUT_CLASS} value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
          </label>
          <label>
            <div className="text-[10px] text-slate-400 mb-1">Дуусах огноо</div>
            <input type="date" className={INPUT_CLASS} value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
          </label>
          <label>
            <div className="text-[10px] text-slate-400 mb-1">USD ханш</div>
            <input type="number" className={INPUT_CLASS} placeholder="0" value={periodUsd} onChange={(e) => setPeriodUsd(e.target.value)} />
          </label>
          <button
            onClick={savePeriodUsd}
            disabled={!periodStart || !periodEnd || !(Number(periodUsd) > 0) || savingPeriod}
            className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-maroon-600 text-white text-sm font-semibold hover:bg-maroon-700 transition disabled:opacity-40"
          >
            {savingPeriod ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Period USD хадгалах
          </button>
        </div>
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