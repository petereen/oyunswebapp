import { ChangeEvent, DragEvent, Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  ArrowLeft,
  BellRing,
  Bold,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Clock3,
  Code2,
  FileImage,
  History,
  ImagePlus,
  Italic,
  Link2,
  Pause,
  Pencil,
  Play,
  Plus,
  Search,
  Send,
  Settings2,
  Sparkles,
  Tag,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import { AdminRefreshButton, AdminSectionHeader } from "./AdminPanelPrimitives";
import { sendAdminBroadcast } from "../../api";

type BroadcastView = "composer" | "automated" | "history";
type Audience = "all" | "active" | "tier-1" | "custom";
type RuleStatus = "active" | "paused" | "archived";
type BroadcastType = "manual" | "automatic";

interface BroadcastRule {
  id: string;
  name: string;
  trigger: string;
  frequency: string;
  status: RuleStatus;
  lastTriggered: string | null;
  template: string;
  audience: string;
  pinned?: boolean;
}

interface BroadcastHistoryItem {
  id: string;
  type: BroadcastType;
  snippet: string;
  mediaUrl?: string;
  audience: string;
  sentAt: string;
  status: "sent" | "failed" | "queued";
  delivered: number;
  readRate: number;
}

interface RuleDraft {
  name: string;
  trigger: string;
  frequency: string;
  template: string;
  audience: string;
}

const AUDIENCE_LABELS: Record<Audience, string> = {
  all: "Бүх хэрэглэгч",
  active: "Идэвхтэй хэрэглэгч",
  "tier-1": "Segment: Tier 1",
  custom: "Custom audience",
};

const INITIAL_RULES: BroadcastRule[] = [
  {
    id: "current-rate",
    name: "Current Rate Broadcast",
    trigger: "Шинэ ханш баталгаажихад",
    frequency: "Өдөрт 1 удаа · 11:00–12:00 УБ",
    status: "active",
    lastTriggered: "Өнөөдөр, 11:04",
    template: "{greeting}! Ханшийн мэдээлэл шинэчлэгдлээ.",
    audience: "Telegram subscribers",
    pinned: true,
  },
  {
    id: "rate-digest",
    name: "Өдрийн ханшийн сануулга",
    trigger: "Өдөр тутмын хуваарь",
    frequency: "Өдөр бүр · 18:00 УБ",
    status: "paused",
    lastTriggered: "2026/09/18, 18:00",
    template: "Өнөөдрийн ханшийг дахин хараарай, {first_name}.",
    audience: "Active subscribers",
  },
  {
    id: "tier-welcome",
    name: "Tier 1 welcome",
    trigger: "Хэрэглэгч Tier 1-д ороход",
    frequency: "Нэг удаа / хэрэглэгч",
    status: "active",
    lastTriggered: "2026/09/21, 09:32",
    template: "Тавтай морил, {first_name}! Таны шинэ боломжууд бэлэн боллоо.",
    audience: "Segment: Tier 1",
  },
];

const INITIAL_HISTORY: BroadcastHistoryItem[] = [
  { id: "BR-260922-004", type: "automatic", snippet: "Өнөөдрийн ханшийн мэдээлэл шинэчлэгдлээ.", mediaUrl: "rate", audience: "Бүх хэрэглэгч", sentAt: "2026-09-22T11:04:00+08:00", status: "sent", delivered: 1248, readRate: 76 },
  { id: "BR-260921-003", type: "manual", snippet: "Амралтын өдрийн гүйлгээний хуваарь", mediaUrl: "notice", audience: "Идэвхтэй хэрэглэгч", sentAt: "2026-09-21T16:42:00+08:00", status: "sent", delivered: 912, readRate: 63 },
  { id: "BR-260921-002", type: "automatic", snippet: "Тавтай морил, {first_name}! Таны шинэ боломжууд бэлэн боллоо.", audience: "Segment: Tier 1", sentAt: "2026-09-21T09:32:00+08:00", status: "sent", delivered: 58, readRate: 81 },
  { id: "BR-260920-001", type: "manual", snippet: "Апп шинэчлэгдлээ — хамгийн сүүлийн хувилбарыг ашиглаарай.", audience: "Бүх хэрэглэгч", sentAt: "2026-09-20T14:18:00+08:00", status: "queued", delivered: 0, readRate: 0 },
  { id: "BR-260919-008", type: "manual", snippet: "Засвар үйлчилгээний тухай мэдэгдэл", mediaUrl: "notice", audience: "Идэвхтэй хэрэглэгч", sentAt: "2026-09-19T21:10:00+08:00", status: "failed", delivered: 0, readRate: 0 },
];

const emptyRule: RuleDraft = { name: "", trigger: "", frequency: "", template: "", audience: "Бүх хэрэглэгч" };

function parseTelegramIds(value: string) {
  return value.trim() ? value.trim().split(/[\s,]+/).filter(Boolean) : [];
}

function isTelegramId(value: string) {
  return /^-?\d+$/.test(value);
}

function formatSentAt(value: string) {
  return new Intl.DateTimeFormat("mn-MN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Ulaanbaatar" }).format(new Date(value));
}

function previewText(value: string) {
  return value
    .replaceAll("{first_name}", "Саруул")
    .replaceAll("{greeting}", "Өдрийн мэнд")
    .replaceAll("{rate}", "21.45")
    .replaceAll("{amount}", "10,000₽");
}

function renderPreviewInline(value: string) {
  return value.split(/(\*\*[^*]+\*\*|\[[^\]]+\]\(https?:\/\/[^\s)]+\))/g).map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={`bold-${index}`}>{part.slice(2, -2)}</strong>;
    }

    const link = part.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/);
    if (link) {
      return <a key={`link-${index}`} href={link[2]} target="_blank" rel="noreferrer" className="font-semibold text-[#1d4ed8] underline underline-offset-2">{link[1]}</a>;
    }

    return <Fragment key={`text-${index}`}>{part}</Fragment>;
  });
}

function renderPreviewMessage(value: string) {
  const resolved = previewText(value);
  if (!resolved) return "Таны мессеж энд харагдана.";

  return resolved.split("\n").map((line, index, lines) => (
    <Fragment key={`line-${index}`}>
      {renderPreviewInline(line)}
      {index < lines.length - 1 && <br />}
    </Fragment>
  ));
}

function statusLabel(status: BroadcastHistoryItem["status"] | RuleStatus) {
  return { sent: "Илгээгдсэн", failed: "Алдаатай", queued: "Дараалалд", active: "Идэвхтэй", paused: "Түр зогсоосон", archived: "Архивласан" }[status];
}

function StatusPill({ status }: { status: BroadcastHistoryItem["status"] | RuleStatus }) {
  const styles = {
    sent: "bg-emerald-50 text-emerald-700 ring-emerald-600/10 dark:bg-emerald-900/20 dark:text-emerald-300",
    active: "bg-emerald-50 text-emerald-700 ring-emerald-600/10 dark:bg-emerald-900/20 dark:text-emerald-300",
    failed: "bg-rose-50 text-rose-700 ring-rose-600/10 dark:bg-rose-900/20 dark:text-rose-300",
    paused: "bg-amber-50 text-amber-700 ring-amber-600/10 dark:bg-amber-900/20 dark:text-amber-300",
    archived: "bg-slate-100 text-slate-600 ring-slate-600/10 dark:bg-dark-700 dark:text-ivory-300",
    queued: "bg-blue-50 text-blue-700 ring-blue-600/10 dark:bg-blue-900/20 dark:text-blue-300",
  };
  return <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-bold ring-1 ring-inset ${styles[status]}`}><span className="size-1.5 rounded-full bg-current" />{statusLabel(status)}</span>;
}

function AppMessagePreview({ text, mediaUrl }: { text: string; mediaUrl?: string }) {
  return (
    <div className="overflow-hidden rounded-[1.45rem] border border-slate-200 bg-[#e7eef6] shadow-sm dark:border-dark-600 dark:bg-[#17273a]">
      <div className="flex items-center gap-2 border-b border-slate-200/70 bg-white/80 px-4 py-3 dark:border-dark-600 dark:bg-dark-800/70">
        <span className="grid size-8 place-items-center rounded-xl bg-[#1d4ed8] text-white"><BellRing className="size-4" /></span>
        <div><div className="text-xs font-bold text-slate-800 dark:text-ivory-100">OYUNS ALL-IN-ONE</div><div className="text-[10px] text-slate-500 dark:text-ivory-400">одоо</div></div>
      </div>
      {mediaUrl && <div className="flex aspect-[2.25/1] items-center justify-center bg-gradient-to-br from-[#173c78] via-[#2862c8] to-[#f4c700] text-white"><ImagePlus className="size-7 opacity-80" /></div>}
      <div className="space-y-2 px-4 py-4 text-[13px] leading-6 text-slate-700 dark:text-ivory-200"><p>{renderPreviewMessage(text)}</p><div className="text-right text-[10px] text-slate-400">11:42 ✓✓</div></div>
    </div>
  );
}

function BroadcastModal({ children, onClose, title, wide = false }: { children: React.ReactNode; onClose: () => void; title: string; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-[110] flex items-end justify-center bg-slate-950/45 p-0 backdrop-blur-sm sm:items-center sm:p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className={`max-h-[92vh] w-full overflow-y-auto rounded-t-[1.6rem] border border-white/70 bg-white shadow-2xl dark:border-dark-600 dark:bg-dark-800 sm:rounded-[1.6rem] ${wide ? "max-w-3xl" : "max-w-lg"}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white/95 px-5 py-4 backdrop-blur dark:border-dark-600 dark:bg-dark-800/95"><div className="text-sm font-bold text-slate-800 dark:text-ivory-100">{title}</div><button type="button" aria-label="Хаах" onClick={onClose} className="rounded-full p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-dark-700"><X className="size-4" /></button></div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export function AdminBroadcasts() {
  const [view, setView] = useState<BroadcastView>("composer");
  const [message, setMessage] = useState("{greeting}, {first_name}!\n\nӨнөөдрийн ханш шинэчлэгдлээ. Апп-аас хамгийн сүүлийн мэдээллээ хараарай.");
  const [audience, setAudience] = useState<Audience>("all");
  const [customAudience, setCustomAudience] = useState("");
  const [media, setMedia] = useState<{ name: string; url: string } | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [confirmSend, setConfirmSend] = useState(false);
  const [toast, setToast] = useState("");
  const [rules, setRules] = useState(INITIAL_RULES);
  const [showArchived, setShowArchived] = useState(false);
  const [ruleModal, setRuleModal] = useState<"create" | "edit" | null>(null);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [ruleDraft, setRuleDraft] = useState<RuleDraft>(emptyRule);
  const [deleteRule, setDeleteRule] = useState<BroadcastRule | null>(null);
  const [history, setHistory] = useState(INITIAL_HISTORY);
  const [historySearch, setHistorySearch] = useState("");
  const [historyType, setHistoryType] = useState<"all" | BroadcastType>("all");
  const [historyFrom, setHistoryFrom] = useState("");
  const [historyTo, setHistoryTo] = useState("");
  const [historyPage, setHistoryPage] = useState(1);
  const messageInputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => () => {
    if (media?.url.startsWith("blob:")) URL.revokeObjectURL(media.url);
  }, [media]);

  const flash = (text: string) => { setToast(text); window.setTimeout(() => setToast(""), 2600); };

  const chooseMedia = (file?: File) => {
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) { flash("PNG, JPG эсвэл WebP зураг сонгоно уу."); return; }
    if (file.size > 5 * 1024 * 1024) { flash("Зургийн хэмжээ 5MB-аас бага байх ёстой."); return; }
    setMedia({ name: file.name, url: URL.createObjectURL(file) });
  };

  const filteredRules = rules.filter((rule) => showArchived ? rule.status === "archived" : rule.status !== "archived");
  const filteredHistory = useMemo(() => history.filter((item) => {
    const matchesSearch = !historySearch.trim() || `${item.id} ${item.snippet} ${item.audience}`.toLowerCase().includes(historySearch.toLowerCase());
    const date = item.sentAt.slice(0, 10);
    const matchesFrom = !historyFrom || date >= historyFrom;
    const matchesTo = !historyTo || date <= historyTo;
    return matchesSearch && matchesFrom && matchesTo && (historyType === "all" || item.type === historyType);
  }), [history, historySearch, historyType, historyFrom, historyTo]);
  const historyPageCount = Math.max(1, Math.ceil(filteredHistory.length / 25));
  const visibleHistory = filteredHistory.slice((historyPage - 1) * 25, historyPage * 25);

  const audienceLabel = audience === "custom" ? `Custom audience · ${parseTelegramIds(customAudience).length} Telegram ID${parseTelegramIds(customAudience).length === 1 ? "" : "s"}` : AUDIENCE_LABELS[audience];
  const prepareSend = () => {
    if (!message.trim()) { flash("Мессежийн текстээ оруулна уу."); return; }
    if (audience === "custom") {
      const ids = parseTelegramIds(customAudience);
      if (!ids.length) { flash("Хамгийн багадаа нэг Telegram ID оруулна уу."); return; }
      if (ids.some((id) => !isTelegramId(id))) { flash("Telegram ID-ууд зөвхөн тоо, зай, таслалаар тусгаарлагдсан байна."); return; }
    }
    setConfirmSend(false); setPreviewOpen(true);
  };
  const sendBroadcast = async () => {
    if (media) { flash("Одоогоор текст broadcast илгээх боломжтой."); return; }
    try {
      const result = await sendAdminBroadcast({
        body_markdown: message,
        audience_type: audience === "tier-1" ? "segment" : audience,
        audience_filter: audience === "custom"
          ? { ids: parseTelegramIds(customAudience).map(Number) }
          : audience === "tier-1" ? { segment: "tier-1" } : {},
      });
      setHistory((current) => [{
        id: result.id,
        type: "manual",
        snippet: previewText(message).slice(0, 110),
        audience: audienceLabel,
        sentAt: result.sent_at || new Date().toISOString(),
        status: result.status,
        delivered: result.delivered_count,
        readRate: 0,
      }, ...current]);
      setPreviewOpen(false); setConfirmSend(false); setView("history");
      flash(result.status === "sent" ? `Broadcast илгээгдлээ (${result.delivered_count}/${result.total_recipients}).` : "Broadcast илгээгдсэнгүй.");
    } catch (error) {
      flash(error instanceof Error ? error.message : "Broadcast илгээхэд алдаа гарлаа.");
    }
  };

  const insertMessageToken = (value: string) => {
    const textarea = messageInputRef.current;
    const start = textarea?.selectionStart ?? message.length;
    const end = textarea?.selectionEnd ?? start;
    const nextMessage = `${message.slice(0, start)}${value}${message.slice(end)}`;
    setMessage(nextMessage);

    requestAnimationFrame(() => {
      textarea?.focus();
      textarea?.setSelectionRange(start + value.length, start + value.length);
    });
  };

  const openCreateRule = () => { setEditingRuleId(null); setRuleDraft(emptyRule); setRuleModal("create"); };
  const openEditRule = (rule: BroadcastRule) => { setEditingRuleId(rule.id); setRuleDraft({ name: rule.name, trigger: rule.trigger, frequency: rule.frequency, template: rule.template, audience: rule.audience }); setRuleModal("edit"); };
  const saveRule = () => {
    if (!ruleDraft.name.trim() || !ruleDraft.trigger.trim() || !ruleDraft.frequency.trim()) { flash("Дүрмийн нэр, trigger, давтамжийг бөглөнө үү."); return; }
    if (editingRuleId) setRules((current) => current.map((rule) => rule.id === editingRuleId ? { ...rule, ...ruleDraft, status: rule.status === "archived" ? "paused" : rule.status } : rule));
    else setRules((current) => [...current, { id: `rule-${Date.now()}`, ...ruleDraft, status: "paused", lastTriggered: null }]);
    setRuleModal(null); flash(editingRuleId ? "Дүрэм шинэчлэгдлээ." : "Шинэ автомат дүрэм үүслээ.");
  };

  const handleFileInput = (event: ChangeEvent<HTMLInputElement>) => chooseMedia(event.target.files?.[0]);
  const handleDrop = (event: DragEvent<HTMLLabelElement>) => { event.preventDefault(); chooseMedia(event.dataTransfer.files?.[0]); };

  return (
    <div className="space-y-4">
      <AdminSectionHeader icon={BellRing} title="Broadcast management" action={<AdminRefreshButton onClick={() => flash("Broadcast өгөгдөл шинэчлэгдлээ.")} loading={false} label="Broadcast шинэчлэх" />} />
      <div className="grid grid-cols-3 gap-2 sm:gap-3"><div className="glass-card rounded-2xl p-3 sm:p-4"><div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Дараагийн trigger</div><div className="mt-1 flex items-center gap-1.5 text-sm font-bold text-slate-800 dark:text-ivory-100"><Clock3 className="size-4 text-[#1d4ed8]" /> 18:00 УБ</div></div><div className="glass-card rounded-2xl p-3 sm:p-4"><div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Өнөөдөр илгээсэн</div><div className="mt-1 text-lg font-black text-slate-800 dark:text-ivory-100">1,248 <span className="text-[10px] font-bold text-emerald-600">+12%</span></div></div><div className="glass-card rounded-2xl p-3 sm:p-4"><div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Дундаж уншилт</div><div className="mt-1 text-lg font-black text-slate-800 dark:text-ivory-100">72.4%</div></div></div>

      <div className="admin-radio-group admin-radio-group--broadcast" role="tablist" aria-label="Broadcast хэсгүүд"><button type="button" role="tab" aria-selected={view === "composer"} onClick={() => setView("composer")} className={`admin-radio ${view === "composer" ? "admin-radio--active" : ""}`}><Send className="size-4" /> Composer</button><button type="button" role="tab" aria-selected={view === "automated"} onClick={() => setView("automated")} className={`admin-radio ${view === "automated" ? "admin-radio--active" : ""}`}><Settings2 className="size-4" /> Automated</button><button type="button" role="tab" aria-selected={view === "history"} onClick={() => setView("history")} className={`admin-radio ${view === "history" ? "admin-radio--active" : ""}`}><History className="size-4" /> History</button></div>

      {view === "composer" && <section className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(300px,0.8fr)]"><div className="glass-card rounded-[1.5rem] p-4 sm:p-5"><div className="mb-5 flex items-start justify-between gap-3"><div><div className="text-xs font-black uppercase tracking-[0.16em] text-[#1d4ed8]">01 / Compose</div><h4 className="mt-1 text-lg font-black text-slate-800 dark:text-ivory-100">Manual broadcast</h4><p className="mt-1 text-xs text-slate-500 dark:text-ivory-400">Мессежээ бичээд илгээхээс өмнө яг харагдах байдлаар нь шалгана.</p></div><span className="rounded-full bg-blue-50 px-3 py-1 text-[10px] font-bold text-blue-700 dark:bg-blue-900/20 dark:text-blue-300">Draft</span></div><label className="block text-xs font-bold text-slate-600 dark:text-ivory-300">Message body<textarea ref={messageInputRef} value={message} onChange={(event) => setMessage(event.target.value)} rows={8} placeholder="Мессежээ энд бичнэ үү..." className="input-modern mt-2 resize-y leading-6" /></label><div className="mt-2 flex flex-wrap items-center gap-1.5"><span className="mr-1 text-[10px] font-bold text-slate-400">Оруулах:</span>{[{ label: "Bold", value: "**текст**", icon: Bold }, { label: "Link", value: "[холбоос](https://)", icon: Link2 }, { label: "first_name", value: "{first_name}", icon: Tag }, { label: "rate", value: "{rate}", icon: Code2 }].map(({ label, value, icon: Icon }) => <button key={label} type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => insertMessageToken(value)} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[10px] font-bold text-slate-600 transition hover:border-blue-300 hover:text-blue-700 dark:border-dark-600 dark:bg-dark-800 dark:text-ivory-300"><Icon className="size-3" />{label}</button>)}</div><div className="mt-1 text-right text-[10px] text-slate-400">{message.length}/4,000 тэмдэгт</div><div className="my-5 h-px bg-slate-100 dark:bg-dark-600" /><label className="block text-xs font-bold text-slate-600 dark:text-ivory-300">Audience<select value={audience} onChange={(event) => setAudience(event.target.value as Audience)} className="input-modern mt-2"><option value="all">All Users · Бүх хэрэглэгч</option><option value="active">Active Subscribers · Идэвхтэй хэрэглэгч</option><option value="tier-1">Segment: Tier 1</option><option value="custom">Custom Telegram IDs</option></select></label>{audience === "custom" && <label className="mt-3 block text-xs font-bold text-slate-600 dark:text-ivory-300">Telegram IDs<textarea aria-label="Custom Telegram IDs" value={customAudience} onChange={(event) => setCustomAudience(event.target.value)} rows={4} placeholder="123456789, 987654321\n123456789" className="input-modern mt-2 resize-y font-mono text-sm leading-6" /><span className="mt-1 block text-[10px] font-normal text-slate-400">ID-уудыг шинэ мөр, зай эсвэл таслалаар тусгаарлана.</span></label>}<div className="mt-5"><div className="mb-2 text-xs font-bold text-slate-600 dark:text-ivory-300">Media attachment <span className="font-normal text-slate-400">optional · max 5MB</span></div>{media ? <div className="flex items-center gap-3 rounded-2xl border border-blue-100 bg-blue-50/60 p-3 dark:border-blue-900/40 dark:bg-blue-900/10"><img src={media.url} alt="Broadcast attachment preview" className="size-14 rounded-xl object-cover" /><div className="min-w-0 flex-1"><div className="truncate text-xs font-bold text-slate-700 dark:text-ivory-200">{media.name}</div><div className="mt-1 text-[10px] text-emerald-600">Зураг бэлэн</div></div><button type="button" onClick={() => setMedia(null)} className="rounded-full p-2 text-slate-400 hover:bg-white hover:text-rose-600" aria-label="Зураг устгах"><X className="size-4" /></button></div> : <label onDragOver={(event) => event.preventDefault()} onDrop={handleDrop} className="flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50/70 px-5 py-7 text-center transition hover:border-blue-300 hover:bg-blue-50/40 dark:border-dark-600 dark:bg-dark-800/40"><input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={handleFileInput} /><span className="mb-2 grid size-10 place-items-center rounded-2xl bg-white text-[#1d4ed8] shadow-sm dark:bg-dark-700"><UploadCloud className="size-5" /></span><span className="text-xs font-bold text-slate-600 dark:text-ivory-300">Зургаа чирж оруулах эсвэл сонгох</span><span className="mt-1 text-[10px] text-slate-400">PNG, JPG, WebP · 5MB хүртэл</span></label>}</div><div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button type="button" onClick={() => { setMessage(""); setMedia(null); }} className="rounded-xl px-4 py-3 text-xs font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-dark-700">Цэвэрлэх</button><button type="button" onClick={prepareSend} className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#1d4ed8] px-5 py-3 text-xs font-bold text-white shadow-lg shadow-blue-700/15 transition hover:bg-[#173fae]"><Send className="size-4" /> Prepare broadcast</button></div></div><div className="glass-card rounded-[1.5rem] p-4 sm:p-5 xl:sticky xl:top-4 xl:h-fit"><div className="mb-4 flex items-center justify-between"><div className="text-lg font-black text-slate-800 dark:text-ivory-100">Preview</div></div><AppMessagePreview text={message} mediaUrl={media?.url} /><div className="mt-4 rounded-2xl bg-slate-50 p-3 text-[11px] leading-5 text-slate-500 dark:bg-dark-700/70 dark:text-ivory-400"><span className="font-bold text-slate-700 dark:text-ivory-200">Audience:</span> {audienceLabel}<br /><span className="font-bold text-slate-700 dark:text-ivory-200">Dynamic tags:</span> sample values shown</div></div></section>}

      {view === "automated" && <section className="glass-card overflow-hidden rounded-[1.5rem]"><div className="flex flex-col gap-4 border-b border-slate-100 p-4 dark:border-dark-600 sm:flex-row sm:items-end sm:justify-between sm:p-5"><div><div className="text-xs font-black uppercase tracking-[0.16em] text-[#1d4ed8]">02 / Rules engine</div><h4 className="mt-1 text-lg font-black text-slate-800 dark:text-ivory-100">Automated broadcasts</h4><p className="mt-1 text-xs text-slate-500 dark:text-ivory-400">Системийн trigger-үүдийг хянаж, шинэ workflow нэмнэ.</p></div><div className="flex gap-2"><button type="button" onClick={() => setShowArchived((current) => !current)} className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-bold transition ${showArchived ? "border-blue-300 bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300" : "border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-dark-600 dark:text-ivory-300 dark:hover:bg-dark-700"}`}><Archive className="size-4" />{showArchived ? "Active rules" : "Archived"}</button><button type="button" onClick={openCreateRule} className="inline-flex items-center gap-2 rounded-xl bg-[#1d4ed8] px-3 py-2.5 text-xs font-bold text-white hover:bg-[#173fae]"><Plus className="size-4" /> Create rule</button></div></div><div className="overflow-x-auto"><table className="w-full min-w-[780px] text-left text-xs"><thead className="bg-slate-50/80 text-[10px] uppercase tracking-wider text-slate-400 dark:bg-dark-700/50"><tr><th className="px-5 py-3 font-bold">Rule name</th><th className="px-4 py-3 font-bold">Trigger condition</th><th className="px-4 py-3 font-bold">Frequency</th><th className="px-4 py-3 font-bold">Status</th><th className="px-4 py-3 font-bold">Last triggered</th><th className="px-4 py-3 text-right font-bold">Actions</th></tr></thead><tbody className="divide-y divide-slate-100 dark:divide-dark-600">{filteredRules.length === 0 ? <tr><td colSpan={6} className="px-5 py-12 text-center text-slate-400">Архивласан дүрэм алга байна.</td></tr> : filteredRules.map((rule) => <tr key={rule.id} className="align-top transition hover:bg-blue-50/30 dark:hover:bg-blue-900/10"><td className="px-5 py-4"><div className="flex items-start gap-2"><span className={`mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg ${rule.pinned ? "bg-amber-100 text-amber-700 dark:bg-amber-900/25 dark:text-amber-300" : "bg-slate-100 text-slate-500 dark:bg-dark-700 dark:text-ivory-400"}`}>{rule.pinned ? <Sparkles className="size-3.5" /> : <Settings2 className="size-3.5" />}</span><div><div className="font-bold text-slate-800 dark:text-ivory-100">{rule.name}</div>{rule.pinned && <div className="mt-1 text-[10px] font-bold text-amber-600">#1 · System pinned</div>}</div></div></td><td className="px-4 py-4 text-slate-600 dark:text-ivory-300">{rule.trigger}</td><td className="px-4 py-4 text-slate-600 dark:text-ivory-300">{rule.frequency}</td><td className="px-4 py-4"><StatusPill status={rule.status} /></td><td className="px-4 py-4 text-slate-500 dark:text-ivory-400">{rule.lastTriggered || "—"}</td><td className="px-4 py-4"><div className="flex justify-end gap-1">{rule.pinned ? <span className="rounded-lg bg-slate-100 px-2 py-1.5 text-[10px] font-bold text-slate-400 dark:bg-dark-700">Protected</span> : <><button type="button" onClick={() => setRules((current) => current.map((item) => item.id === rule.id ? { ...item, status: item.status === "active" ? "paused" : "active" } : item))} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-[#1d4ed8] dark:hover:bg-dark-700" aria-label={rule.status === "active" ? "Түр зогсоох" : "Идэвхжүүлэх"}>{rule.status === "active" ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}</button><button type="button" onClick={() => openEditRule(rule)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-[#1d4ed8] dark:hover:bg-dark-700" aria-label="Дүрэм засах"><Pencil className="size-3.5" /></button><button type="button" onClick={() => setRules((current) => current.map((item) => item.id === rule.id ? { ...item, status: "archived" } : item))} className="rounded-lg p-2 text-slate-400 hover:bg-amber-50 hover:text-amber-600 dark:hover:bg-dark-700" aria-label="Дүрэм архивлах"><Archive className="size-3.5" /></button><button type="button" onClick={() => setDeleteRule(rule)} className="rounded-lg p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-dark-700" aria-label="Дүрэм устгах"><Trash2 className="size-3.5" /></button></>}</div></td></tr>)}</tbody></table></div></section>}

      {view === "history" && <section className="glass-card overflow-hidden rounded-[1.5rem]"><div className="border-b border-slate-100 p-4 dark:border-dark-600 sm:p-5"><div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"><div><div className="text-xs font-black uppercase tracking-[0.16em] text-[#1d4ed8]">03 / Audit log</div><h4 className="mt-1 text-lg font-black text-slate-800 dark:text-ivory-100">Broadcast history</h4><p className="mt-1 text-xs text-slate-500 dark:text-ivory-400">Илгээсэн бүх мессеж, хүргэлт болон уншилтын мэдээлэл.</p></div><div className="flex flex-wrap gap-2"><label className="relative"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" /><input value={historySearch} onChange={(event) => { setHistorySearch(event.target.value); setHistoryPage(1); }} placeholder="ID, мессеж, audience..." className="input-modern min-w-0 pl-9 sm:w-64" /></label><select value={historyType} onChange={(event) => { setHistoryType(event.target.value as "all" | BroadcastType); setHistoryPage(1); }} className="input-modern sm:w-36"><option value="all">Бүх төрөл</option><option value="manual">Manual</option><option value="automatic">Automatic</option></select><input type="date" aria-label="Эхлэх огноо" value={historyFrom} onChange={(event) => { setHistoryFrom(event.target.value); setHistoryPage(1); }} className="input-modern sm:w-36" /><input type="date" aria-label="Дуусах огноо" value={historyTo} onChange={(event) => { setHistoryTo(event.target.value); setHistoryPage(1); }} className="input-modern sm:w-36" /></div></div></div><div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-xs"><thead className="bg-slate-50/80 text-[10px] uppercase tracking-wider text-slate-400 dark:bg-dark-700/50"><tr><th className="px-5 py-3 font-bold">Broadcast ID</th><th className="px-4 py-3 font-bold">Type / message</th><th className="px-4 py-3 font-bold">Audience</th><th className="px-4 py-3 font-bold">Sent at · UB</th><th className="px-4 py-3 font-bold">Delivery</th><th className="px-4 py-3 text-right font-bold">Metrics</th></tr></thead><tbody className="divide-y divide-slate-100 dark:divide-dark-600">{visibleHistory.length === 0 ? <tr><td colSpan={6} className="px-5 py-12 text-center text-slate-400">Тохирох broadcast олдсонгүй.</td></tr> : visibleHistory.map((item) => <tr key={item.id} className="align-middle transition hover:bg-blue-50/30 dark:hover:bg-blue-900/10"><td className="px-5 py-4 font-mono text-[11px] font-bold text-slate-500 dark:text-ivory-400">{item.id}</td><td className="max-w-[360px] px-4 py-4"><div className="flex gap-3"><div className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-xl bg-slate-100 text-slate-400 dark:bg-dark-700">{item.mediaUrl ? <FileImage className="size-4" /> : <BellRing className="size-4" />}</div><div className="min-w-0"><div className={`mb-1 inline-flex rounded-md px-1.5 py-0.5 text-[9px] font-black uppercase ${item.type === "automatic" ? "bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300" : "bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300"}`}>{item.type}</div><div className="truncate font-semibold text-slate-700 dark:text-ivory-200">{item.snippet}</div></div></div></td><td className="px-4 py-4 text-slate-600 dark:text-ivory-300">{item.audience}</td><td className="whitespace-nowrap px-4 py-4 text-slate-500 dark:text-ivory-400">{formatSentAt(item.sentAt)}</td><td className="px-4 py-4"><StatusPill status={item.status} /></td><td className="px-4 py-4 text-right"><div className="font-bold text-slate-700 dark:text-ivory-200">{item.delivered.toLocaleString()} delivered</div><div className="mt-1 text-[10px] font-semibold text-slate-400">{item.readRate ? `${item.readRate}% read` : "Metrics pending"}</div></td></tr>)}</tbody></table></div><div className="flex items-center justify-between border-t border-slate-100 px-5 py-3 text-xs dark:border-dark-600"><span className="text-slate-400">25 items / page · {filteredHistory.length} total</span><div className="flex items-center gap-2"><button type="button" disabled={historyPage <= 1} onClick={() => setHistoryPage((current) => Math.max(1, current - 1))} className="rounded-lg border border-slate-200 p-1.5 text-slate-500 disabled:opacity-30 dark:border-dark-600" aria-label="Өмнөх хуудас"><ChevronLeft className="size-4" /></button><span className="font-bold text-slate-600 dark:text-ivory-300">{historyPage} / {historyPageCount}</span><button type="button" disabled={historyPage >= historyPageCount} onClick={() => setHistoryPage((current) => Math.min(historyPageCount, current + 1))} className="rounded-lg border border-slate-200 p-1.5 text-slate-500 disabled:opacity-30 dark:border-dark-600" aria-label="Дараах хуудас"><ChevronRight className="size-4" /></button></div></div></section>}

      {previewOpen && <BroadcastModal title="Broadcast preview" onClose={() => { setPreviewOpen(false); setConfirmSend(false); }}><div className="grid gap-5 md:grid-cols-[minmax(0,0.9fr)_minmax(240px,0.8fr)]"><div><div className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-400">Recipient preview</div><AppMessagePreview text={message} mediaUrl={media?.url} /></div><div className="flex flex-col justify-between"><div className="space-y-3"><div className="rounded-2xl bg-slate-50 p-3 text-xs leading-5 text-slate-600 dark:bg-dark-700 dark:text-ivory-300"><div className="mb-2 font-bold text-slate-800 dark:text-ivory-100">Илгээх тохиргоо</div><div className="flex justify-between gap-3"><span>Audience</span><strong>{audienceLabel}</strong></div><div className="mt-1 flex justify-between gap-3"><span>Attachment</span><strong>{media ? "1 image" : "None"}</strong></div></div>{confirmSend && <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-800 dark:border-amber-800/50 dark:bg-amber-900/20 dark:text-amber-200"><div className="flex gap-2"><CircleAlert className="mt-0.5 size-4 shrink-0" /><span><strong>Анхаар:</strong> Confirm & Send дарсны дараа энэ мессежийг буцаах боломжгүй.</span></div></div>}</div><div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button type="button" onClick={() => { setPreviewOpen(false); setConfirmSend(false); }} className="rounded-xl px-4 py-3 text-xs font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-dark-700">Edit</button>{confirmSend ? <button type="button" onClick={sendBroadcast} className="inline-flex items-center justify-center gap-2 rounded-xl bg-rose-600 px-4 py-3 text-xs font-bold text-white hover:bg-rose-700"><Check className="size-4" /> Confirm & Send</button> : <button type="button" onClick={() => setConfirmSend(true)} className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#1d4ed8] px-4 py-3 text-xs font-bold text-white hover:bg-[#173fae]"><ArrowLeft className="hidden size-4" /> Continue</button>}</div></div></div></BroadcastModal>}

      {ruleModal && <BroadcastModal title={ruleModal === "create" ? "Create automated rule" : "Edit automated rule"} onClose={() => setRuleModal(null)}><div className="space-y-4"><label className="block text-xs font-bold text-slate-600 dark:text-ivory-300">Rule name<input value={ruleDraft.name} onChange={(event) => setRuleDraft({ ...ruleDraft, name: event.target.value })} className="input-modern mt-2" placeholder="Жишээ: Weekend reminder" /></label><label className="block text-xs font-bold text-slate-600 dark:text-ivory-300">Trigger condition<input value={ruleDraft.trigger} onChange={(event) => setRuleDraft({ ...ruleDraft, trigger: event.target.value })} className="input-modern mt-2" placeholder="Хэрэглэгч ямар үйлдэл хийхэд?" /></label><div className="grid gap-4 sm:grid-cols-2"><label className="block text-xs font-bold text-slate-600 dark:text-ivory-300">Frequency / interval<input value={ruleDraft.frequency} onChange={(event) => setRuleDraft({ ...ruleDraft, frequency: event.target.value })} className="input-modern mt-2" placeholder="Өдөр бүр · 18:00 УБ" /></label><label className="block text-xs font-bold text-slate-600 dark:text-ivory-300">Audience<select value={ruleDraft.audience} onChange={(event) => setRuleDraft({ ...ruleDraft, audience: event.target.value })} className="input-modern mt-2"><option>Бүх хэрэглэгч</option><option>Идэвхтэй хэрэглэгч</option><option>Segment: Tier 1</option></select></label></div><label className="block text-xs font-bold text-slate-600 dark:text-ivory-300">Message template<textarea value={ruleDraft.template} onChange={(event) => setRuleDraft({ ...ruleDraft, template: event.target.value })} rows={4} className="input-modern mt-2 resize-y" placeholder="{first_name} зэрэг dynamic tag ашиглаж болно." /></label><div className="flex justify-end gap-2"><button type="button" onClick={() => setRuleModal(null)} className="rounded-xl px-4 py-2.5 text-xs font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-dark-700">Cancel</button><button type="button" onClick={saveRule} className="rounded-xl bg-[#1d4ed8] px-4 py-2.5 text-xs font-bold text-white hover:bg-[#173fae]">Save rule</button></div></div></BroadcastModal>}

      {deleteRule && <BroadcastModal title="Delete automated rule" onClose={() => setDeleteRule(null)}><div className="space-y-4"><div className="flex gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm leading-6 text-rose-800 dark:border-rose-900/50 dark:bg-rose-900/15 dark:text-rose-200"><CircleAlert className="mt-0.5 size-5 shrink-0" /><span><strong>{deleteRule.name}</strong>-г бүрмөсөн устгах гэж байна. Энэ үйлдлийг буцаах боломжгүй.</span></div><div className="flex justify-end gap-2"><button type="button" onClick={() => setDeleteRule(null)} className="rounded-xl px-4 py-2.5 text-xs font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-dark-700">Cancel</button><button type="button" onClick={() => { setRules((current) => current.filter((rule) => rule.id !== deleteRule.id)); setDeleteRule(null); flash("Дүрэм бүрмөсөн устгагдлаа."); }} className="rounded-xl bg-rose-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-rose-700">Delete permanently</button></div></div></BroadcastModal>}

      {toast && <div className="fixed bottom-5 left-1/2 z-[60] flex -translate-x-1/2 items-center gap-2 rounded-full bg-slate-900 px-4 py-3 text-xs font-bold text-white shadow-xl dark:bg-white dark:text-slate-900"><Check className="size-4 text-emerald-400 dark:text-emerald-600" />{toast}</div>}
    </div>
  );
}
