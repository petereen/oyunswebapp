import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle, Calculator, Calendar, Loader2, LogOut, Plus, RefreshCw,
  Save, Trash2, TrendingUp, Wallet,
} from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell,
} from "recharts";
import {
  BalanceSummary, CostRate, ProfitSummary, TreasuryAccount,
  createTreasuryAccount, deleteTreasuryAccount, fetchBalanceSummary, fetchBlackRates,
  fetchCostRates, fetchProfit, saveCostRate, updateTreasuryAccount,
} from "../api";

type ProfitPeriod = "today" | "7d" | "month" | "year" | "custom";

const PROFIT_PERIODS: { key: ProfitPeriod; label: string }[] = [
  { key: "today", label: "Өнөөдөр" },
  { key: "7d", label: "7 хоног" },
  { key: "month", label: "Энэ сар" },
  { key: "year", label: "1 жил" },
  { key: "custom", label: "Хугацаа сонгох" },
];

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const fmtNum = (n: number | null | undefined, digits = 0) =>
  (n ?? 0).toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: 0 });
const fmtRub = (n: number | null | undefined) => `${fmtNum(n)} ₽`;
const fmtMnt = (n: number | null | undefined) => `${fmtNum(n)} ₮`;

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

// ─────────────────────────────────────────────────────────────────────────────

export function BalanceProfitPage({ onLogout, pageTabs }: { onLogout: () => void; pageTabs?: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-dark-900 text-slate-800 dark:text-ivory-200">
      <div className="max-w-7xl mx-auto px-4 md:px-6 py-5 space-y-5">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-maroon-600 flex items-center justify-center">
              <Wallet className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-lg md:text-xl font-bold leading-tight">Баланс ба Ашиг · Oyuns AIO Bot</h1>
              <p className="text-xs text-slate-500 dark:text-ivory-400">Балансын бүртгэл ба ашгийн тооцоо</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {pageTabs}
            <button
              onClick={onLogout}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white dark:bg-dark-800 border border-slate-200 dark:border-dark-600 text-sm font-medium hover:bg-slate-100 dark:hover:bg-dark-700 transition"
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
  const [date, setDate] = useState(todayIso());
  const { data, isLoading, isFetching, refetch, error } = useQuery({
    queryKey: ["dashboard-balance", date],
    queryFn: () => fetchBalanceSummary(date),
    staleTime: 30_000,
  });

  return (
    <div className="bg-white dark:bg-dark-800 rounded-2xl border border-slate-200 dark:border-dark-600 shadow-sm p-4 md:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <Wallet className="w-5 h-5 text-maroon-600 dark:text-gold-400" />
          <h2 className="text-base font-bold">Балансын бүртгэл</h2>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 bg-slate-50 dark:bg-dark-700 px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-dark-600">
            <Calendar className="w-4 h-4 text-slate-400" />
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="bg-transparent text-xs outline-none"
            />
          </div>
          <button
            onClick={() => refetch()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-dark-700 text-xs font-semibold hover:bg-slate-200 dark:hover:bg-dark-600 transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} /> Шинэчлэх
          </button>
        </div>
      </div>

      {error ? (
        <div className="text-sm text-red-500 py-6 text-center">Баланс ачаалж чадсангүй.</div>
      ) : isLoading || !data ? (
        <div className="flex justify-center py-10"><Loader2 className="w-7 h-7 text-maroon-600 animate-spin" /></div>
      ) : (
        <BalanceBody data={data} onChanged={refetch} />
      )}
    </div>
  );
}

function BalanceBody({ data, onChanged }: { data: BalanceSummary; onChanged: () => void }) {
  return (
    <div className="space-y-5">
      <TreasuryAccountsTable accounts={data.accounts} onChanged={onChanged} />

      {/* Balance summary */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <BalanceStat label="Өмнөх өдрийн баланс" value={fmtRub(data.prev_balance_total)} />
        <BalanceStat label="Өнөөдрийн руб→төг" value={fmtRub(data.rub_to_mnt_rub)} tone="pos" />
        <BalanceStat label="Өнөөдрийн төг→руб" value={fmtRub(data.mnt_to_rub_rub)} tone="neg" />
        <BalanceStat label="Тохируулга" value={fmtRub(data.adjustment_total)} />
        <BalanceStat label="Нийт баланс" value={fmtRub(data.total_balance)} accent />
      </div>
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

function TreasuryAccountsTable({ accounts, onChanged }: { accounts: TreasuryAccount[]; onChanged: () => void }) {
  const [drafts, setDrafts] = useState<Record<string, { name: string; prev_balance: string; adjustment: string }>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newBalance, setNewBalance] = useState("");

  const draftOf = (a: TreasuryAccount) =>
    drafts[a.id] ?? { name: a.name, prev_balance: String(a.prev_balance ?? 0), adjustment: String(a.adjustment ?? 0) };

  const setDraft = (id: string, patch: Partial<{ name: string; prev_balance: string; adjustment: string }>) =>
    setDrafts((d) => ({ ...d, [id]: { ...draftOf(accounts.find((a) => a.id === id)!), ...d[id], ...patch } }));

  const isDirty = (a: TreasuryAccount) => {
    const d = drafts[a.id];
    if (!d) return false;
    return d.name !== a.name || Number(d.prev_balance) !== a.prev_balance || Number(d.adjustment) !== a.adjustment;
  };

  const save = async (a: TreasuryAccount) => {
    const d = draftOf(a);
    setBusyId(a.id);
    try {
      await updateTreasuryAccount(a.id, {
        name: d.name,
        prev_balance: Number(d.prev_balance) || 0,
        adjustment: Number(d.adjustment) || 0,
      });
      setDrafts((prev) => { const n = { ...prev }; delete n[a.id]; return n; });
      onChanged();
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (a: TreasuryAccount) => {
    if (!window.confirm(`"${a.name}" дансыг устгах уу?`)) return;
    setBusyId(a.id);
    try {
      await deleteTreasuryAccount(a.id);
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

  const inputCls = "w-full rounded-lg border border-slate-200 dark:border-dark-600 bg-slate-50 dark:bg-dark-700 px-2 py-1.5 text-xs tabular-nums outline-none focus:ring-2 focus:ring-maroon-500";

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-slate-500 dark:text-ivory-400 border-b border-slate-200 dark:border-dark-600">
            <th className="py-2 pr-2 font-medium">Дансны нэр</th>
            <th className="py-2 px-2 font-medium text-right">Өмнөх өдрийн баланс (₽)</th>
            <th className="py-2 px-2 font-medium text-right">Тохируулга ± (₽)</th>
            <th className="py-2 px-2 font-medium text-right">Дансны дүн (₽)</th>
            <th className="py-2 pl-2 font-medium text-right">Үйлдэл</th>
          </tr>
        </thead>
        <tbody>
          {accounts.map((a) => {
            const d = draftOf(a);
            const subtotal = (Number(d.prev_balance) || 0) + (Number(d.adjustment) || 0);
            return (
              <tr key={a.id} className="border-b border-slate-100 dark:border-dark-700">
                <td className="py-2 pr-2 min-w-[140px]">
                  <input className={inputCls} value={d.name} onChange={(e) => setDraft(a.id, { name: e.target.value })} />
                </td>
                <td className="py-2 px-2 w-36">
                  <input type="number" className={`${inputCls} text-right`} value={d.prev_balance}
                    onChange={(e) => setDraft(a.id, { prev_balance: e.target.value })} />
                </td>
                <td className="py-2 px-2 w-32">
                  <input type="number" className={`${inputCls} text-right`} value={d.adjustment}
                    onChange={(e) => setDraft(a.id, { adjustment: e.target.value })} />
                </td>
                <td className="py-2 px-2 text-right tabular-nums font-semibold">{fmtRub(subtotal)}</td>
                <td className="py-2 pl-2">
                  <div className="flex items-center justify-end gap-1.5">
                    <button
                      onClick={() => save(a)}
                      disabled={!isDirty(a) || busyId === a.id}
                      className="p-1.5 rounded-lg bg-maroon-600 text-white disabled:opacity-30 hover:bg-maroon-700 transition"
                      title="Хадгалах"
                    >
                      {busyId === a.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                    </button>
                    <button
                      onClick={() => remove(a)}
                      disabled={busyId === a.id}
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
            <tr><td colSpan={5} className="py-6 text-center text-slate-400">Данс алга. Эхлээд баланс тооцох данс нэмнэ үү.</td></tr>
          )}
        </tbody>
      </table>

      {/* Add account */}
      <div className="flex flex-wrap items-end gap-2 mt-3 pt-3 border-t border-slate-100 dark:border-dark-700">
        <div className="flex-1 min-w-[160px]">
          <label className="text-[10px] text-slate-400">Шинэ дансны нэр</label>
          <input className={inputCls} placeholder="Жишээ: Сбербанк ₽" value={newName} onChange={(e) => setNewName(e.target.value)} />
        </div>
        <div className="w-40">
          <label className="text-[10px] text-slate-400">Өмнөх өдрийн баланс</label>
          <input type="number" className={`${inputCls} text-right`} placeholder="0" value={newBalance} onChange={(e) => setNewBalance(e.target.value)} />
        </div>
        <button
          onClick={add}
          disabled={!newName.trim() || adding}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-maroon-600 text-white text-xs font-semibold hover:bg-maroon-700 transition disabled:opacity-40"
        >
          {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Данс нэмэх
        </button>
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

  return (
    <div className="bg-white dark:bg-dark-800 rounded-2xl border border-slate-200 dark:border-dark-600 shadow-sm p-4 md:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <Calculator className="w-5 h-5 text-maroon-600 dark:text-gold-400" />
          <h2 className="text-base font-bold">Ашгийн тооцоо</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap items-center gap-1 bg-slate-50 dark:bg-dark-700 p-1 rounded-2xl border border-slate-200 dark:border-dark-600">
            {PROFIT_PERIODS.map((p) => (
              <button
                key={p.key}
                onClick={() => setPeriod(p.key)}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition ${
                  period === p.key ? "bg-maroon-600 text-white shadow" : "text-slate-600 dark:text-ivory-400 hover:bg-slate-200 dark:hover:bg-dark-600"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          {period === "custom" && (
            <div className="flex items-center gap-2 bg-slate-50 dark:bg-dark-700 p-1.5 rounded-2xl border border-slate-200 dark:border-dark-600">
              <input type="date" value={custom.start} onChange={(e) => setCustom((c) => ({ ...c, start: e.target.value }))} className="bg-transparent text-xs p-1 outline-none" />
              <span className="text-slate-400 text-xs">→</span>
              <input type="date" value={custom.end} onChange={(e) => setCustom((c) => ({ ...c, end: e.target.value }))} className="bg-transparent text-xs p-1 outline-none" />
            </div>
          )}
        </div>
      </div>

      <div className="text-[11px] text-slate-500 dark:text-ivory-400 mb-4 leading-relaxed bg-slate-50 dark:bg-dark-700/50 rounded-xl p-3">
        <b>Ашигийн томьёо:</b><br />
        Руб/төг: ( өртөг ханш − руб авах ханш ) × дүн &nbsp;·&nbsp;
        Төг/руб: ( руб зарж буй ханш − өртөг ханш ) × дүн<br />
        <span className="text-slate-400">өртөг ханш = USD ханш ÷ black ханш (Google Sheets). Ашиг ₮-өөр илэрхийлэгдэнэ.</span>
      </div>

      {/* Profit summary */}
      {profitQ.error ? (
        <div className="text-sm text-red-500 py-6 text-center">Ашиг тооцоолж чадсангүй.</div>
      ) : profitQ.isLoading || !profitQ.data ? (
        <div className="flex justify-center py-10"><Loader2 className="w-7 h-7 text-maroon-600 animate-spin" /></div>
      ) : (
        <ProfitBody data={profitQ.data} />
      )}

      <CostRateManager range={range} onSaved={() => profitQ.refetch()} />
    </div>
  );
}

function ProfitBody({ data }: { data: ProfitSummary }) {
  const chartData = data.by_day;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <ProfitCard label="Нийт ашиг" value={fmtMnt(data.total_profit)} accent="bg-maroon-600 text-white" big />
        <ProfitCard label="Руб/төг ашиг" value={fmtMnt(data.buy_profit)} />
        <ProfitCard label="Төг/руб ашиг" value={fmtMnt(data.sell_profit)} />
        <ProfitCard label="Тооцсон гүйлгээ" value={fmtNum(data.counted)} />
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
              <YAxis tick={{ fontSize: 10 }} width={56} tickFormatter={(v: number) => fmtNum(v)} />
              <Tooltip formatter={(v: any) => [fmtMnt(Number(v)), "Ашиг"]} contentStyle={{ borderRadius: 12, fontSize: 12 }} />
              <Bar dataKey="profit" radius={[4, 4, 0, 0]}>
                {chartData.map((d, i) => <Cell key={i} fill={d.profit >= 0 ? "#10b981" : "#ef4444"} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

function ProfitCard({ label, value, accent, big }: { label: string; value: string; accent?: string; big?: boolean }) {
  return (
    <div className={`rounded-2xl border border-slate-200 dark:border-dark-600 p-4 ${accent || "bg-slate-50 dark:bg-dark-700"}`}>
      <div className={`text-xs font-medium ${accent ? "text-white/80" : "text-slate-500 dark:text-ivory-400"}`}>{label}</div>
      <div className={`${big ? "text-2xl" : "text-xl"} font-bold mt-1 tabular-nums`}>{value}</div>
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
    const u = Number(usd), b = Number(black);
    if (!u || !b) return null;
    return u / b;
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
          // Fall back to the latest "Ханш" row when this date has no entry.
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
    const u = Number(usd), b = Number(black);
    if (!u || !b) return;
    setSaving(true);
    try {
      await saveCostRate({ date, usd_rate: u, black_rate: b });
      setUsd("");
      setBlack("");
      setRateMsg(null);
      ratesQ.refetch();
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  const inputCls = "w-full rounded-lg border border-slate-200 dark:border-dark-600 bg-slate-50 dark:bg-dark-700 px-2.5 py-2 text-xs tabular-nums outline-none focus:ring-2 focus:ring-maroon-500";

  return (
    <div className="mt-5 pt-5 border-t border-slate-100 dark:border-dark-700">
      <div className="flex items-center gap-2 mb-3">
        <TrendingUp className="w-4 h-4 text-maroon-600 dark:text-gold-400" />
        <h3 className="text-sm font-bold">Өртөг ханш (USD ханш ÷ black ханш)</h3>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-5 gap-2 items-end">
        <div>
          <label className="text-[10px] text-slate-400">Огноо</label>
          <input type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div>
          <label className="text-[10px] text-slate-400">Black ханш (Sheets)</label>
          <div className="flex gap-1">
            <input type="number" className={inputCls} placeholder="0" value={black} onChange={(e) => setBlack(e.target.value)} />
            <button
              onClick={fetchBlack}
              disabled={fetchingRate}
              className="px-2 rounded-lg bg-slate-100 dark:bg-dark-700 hover:bg-slate-200 transition shrink-0"
              title="Google Sheets-ээс татах"
            >
              {fetchingRate ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            </button>
          </div>
        </div>
        <div>
          <label className="text-[10px] text-slate-400">USD ханш</label>
          <input type="number" className={inputCls} placeholder="0" value={usd} onChange={(e) => setUsd(e.target.value)} />
        </div>
        <div>
          <label className="text-[10px] text-slate-400">Өртөг ханш</label>
          <div className={`${inputCls} flex items-center font-semibold ${costPreview == null ? "text-slate-300" : "text-maroon-600 dark:text-gold-400"}`}>
            {costPreview == null ? "—" : costPreview.toFixed(4)}
          </div>
        </div>
        <button
          onClick={save}
          disabled={!costPreview || saving}
          className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-maroon-600 text-white text-xs font-semibold hover:bg-maroon-700 transition disabled:opacity-40"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Хадгалах
        </button>
      </div>
      {rateMsg && <div className="text-[11px] text-slate-500 dark:text-ivory-400 mt-2">{rateMsg}</div>}

      {/* Saved cost rates for the period */}
      <div className="mt-4 overflow-x-auto">
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
            {(ratesQ.data || []).map((r: CostRate) => (
              <tr key={r.rate_date} className="border-b border-slate-100 dark:border-dark-700">
                <td className="py-2 pr-2 font-mono">{r.rate_date}</td>
                <td className="py-2 px-2 text-right tabular-nums">{fmtNum(r.usd_rate, 2)}</td>
                <td className="py-2 px-2 text-right tabular-nums">{fmtNum(r.black_rate, 2)}</td>
                <td className="py-2 pl-2 text-right tabular-nums font-semibold text-maroon-600 dark:text-gold-400">{r.cost_rate != null ? r.cost_rate.toFixed(4) : "—"}</td>
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
