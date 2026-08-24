import { useState, useEffect } from "react";
import { History, Search, Filter, ChevronLeft, ChevronRight, Copy, Check, ExternalLink } from "lucide-react";
import { fetchAdminHistory, AdminHistoryItem } from "../api";

const STATUS_OPTIONS = [
  { value: "all", label: "Бүгд" },
  { value: "pending", label: "Хүлээгдэж буй" },
  { value: "approved", label: "Баталгаажсан" },
  { value: "waiting_edit", label: "Засвар хүлээж буй" },
  { value: "completed", label: "Амжилттай" },
  { value: "rejected", label: "Цуцалсан" },
];

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-700",
  approved: "bg-blue-100 text-blue-700",
  waiting_edit: "bg-amber-100 text-amber-700",
  completed: "bg-green-100 text-green-700",
  successful: "bg-green-100 text-green-700",
  rejected: "bg-red-100 text-red-700",
};

const STATUS_LABELS: Record<string, string> = {
  pending: "Хүлээгдэж буй",
  approved: "Баталгаажсан",
  waiting_edit: "Засвар хүлээж буй",
  completed: "Амжилттай",
  successful: "Амжилттай",
  rejected: "Цуцалсан",
};

export function AdminHistory() {
  const [items, setItems] = useState<AdminHistoryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(0);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [expandedItem, setExpandedItem] = useState<string | null>(null);
  
  const ITEMS_PER_PAGE = 20;

  const loadHistory = async () => {
    setLoading(true);
    try {
      const data = await fetchAdminHistory(statusFilter, ITEMS_PER_PAGE, page * ITEMS_PER_PAGE);
      setItems(data.items);
      setTotal(data.total);
    } catch (err) {
      console.error("Failed to load history:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadHistory();
  }, [statusFilter, page]);

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Filter items by search query (client-side)
  const filteredItems = items.filter(item => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      item.invoice?.toLowerCase().includes(query) ||
      item.user_id?.toString().includes(query) ||
      item.user_name?.toLowerCase().includes(query) ||
      item.bank_details?.toLowerCase().includes(query)
    );
  });

  const totalPages = Math.ceil(total / ITEMS_PER_PAGE);

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString("mn-MN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const formatAmount = (amount: number, currency: string) => {
    return new Intl.NumberFormat("mn-MN").format(amount) + (currency === "RUB" ? " ₽" : " ₮");
  };

  const parseBillUrls = (billUrl?: string): string[] => {
    if (!billUrl) return [];
    try {
      const parsed = JSON.parse(billUrl);
      if (Array.isArray(parsed)) return parsed;
      return [billUrl];
    } catch {
      return [billUrl];
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-maroon-700">
          <History className="w-5 h-5" />
          <span className="font-semibold">Гүйлгээний түүх</span>
          <span className="text-sm text-slate-500">({total} гүйлгээ)</span>
        </div>
        <button
          onClick={loadHistory}
          className="text-sm text-maroon-600 hover:text-maroon-700"
        >
          Шинэчлэх
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        {/* Search */}
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Invoice, User ID, Нэр хайх..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-maroon-500"
          />
        </div>
        
        {/* Status Filter */}
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-slate-400" />
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(0);
            }}
            className="px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-maroon-500"
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="text-center py-8 text-slate-500">Уншиж байна...</div>
      ) : filteredItems.length === 0 ? (
        <div className="text-center py-8 text-slate-500">Гүйлгээ олдсонгүй</div>
      ) : (
        <div className="space-y-3">
          {filteredItems.map((item) => (
            <div
              key={item.invoice}
              className="bg-white rounded-xl p-4 shadow-sm border border-slate-100"
            >
              {/* Main row */}
              <div className="flex flex-wrap items-center gap-3 justify-between">
                {/* Invoice & User */}
                <div className="flex-1 min-w-[200px]">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-slate-500">
                      {item.invoice}
                    </span>
                    {item.is_manual && <span className="rounded bg-[#2D62EC]/10 px-2 py-0.5 text-[10px] font-bold text-[#2D62EC]">Manual</span>}
                    <button
                      onClick={() => copyToClipboard(item.invoice, `inv-${item.invoice}`)}
                      className="text-slate-400 hover:text-slate-600"
                    >
                      {copiedId === `inv-${item.invoice}` ? (
                        <Check className="w-3 h-3 text-green-500" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                    </button>
                  </div>
                  <div className="text-sm mt-1">
                    <span className="font-medium">{item.user_name || "—"}</span>
                    <span className="text-slate-400 ml-2">ID: {item.user_id}</span>
                    <button
                      onClick={() => copyToClipboard(item.user_id.toString(), `uid-${item.invoice}`)}
                      className="ml-1 text-slate-400 hover:text-slate-600"
                    >
                      {copiedId === `uid-${item.invoice}` ? (
                        <Check className="w-3 h-3 text-green-500 inline" />
                      ) : (
                        <Copy className="w-3 h-3 inline" />
                      )}
                    </button>
                  </div>
                </div>

                {/* Amount & Direction */}
                <div className="text-right">
                  <div className={`text-sm font-semibold ${item.currency_from.toUpperCase() === "RUB" ? "text-green-600" : "text-orange-600"}`}>
                    {item.currency_from.toUpperCase() === "RUB" ? "ТӨГРӨГ АВАХ" : "РУБЛЬ АВАХ"}
                  </div>
                  <div className="text-lg font-bold">
                    {formatAmount(item.amount, item.currency_from)}
                  </div>
                  <div className="text-sm text-slate-600">
                    → {item.currency_from.toUpperCase() === "RUB" 
                      ? formatAmount(Math.round(item.amount * item.rate), "MNT")
                      : formatAmount(parseFloat((item.amount / item.rate).toFixed(2)), "RUB")}
                  </div>
                  <div className="text-xs text-slate-500">
                    Ханш: {Number(item.rate).toFixed(2)}
                  </div>
                </div>

                {/* Status */}
                <div>
                  <span className={`px-3 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[item.status] || "bg-slate-100 text-slate-700"}`}>
                    {STATUS_LABELS[item.status] || item.status}
                  </span>
                </div>

                {/* Date */}
                <div className="text-xs text-slate-500 min-w-[120px] text-right">
                  {formatDate(item.timestamp)}
                </div>

                {/* Expand button */}
                <button
                  onClick={() => setExpandedItem(expandedItem === item.invoice ? null : item.invoice)}
                  className="text-maroon-600 text-sm hover:underline"
                >
                  {expandedItem === item.invoice ? "Хураах" : "Дэлгэрэнгүй"}
                </button>
              </div>

              {/* Expanded details */}
              {expandedItem === item.invoice && (
                <div className="mt-4 pt-4 border-t border-slate-100 space-y-2 text-sm">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <span className="text-slate-500">Гүйлгээнд ашигласан данс:</span>
                      <div className="font-mono text-xs p-2 rounded mt-1 break-all bg-slate-50">
                        {item.bank_details || "—"}
                      </div>
                      {item.admin_bank_name && (
                        <div className="mt-2 text-xs">
                          <span className="text-slate-500 mr-2">Хүлээн авсан данс:</span>
                          <span className="font-medium bg-blue-50 text-blue-700 px-2 py-0.5 rounded">{item.admin_bank_name}</span>
                        </div>
                      )}
                    </div>
                    <div>
                      <span className="text-slate-500">Валют:</span>
                      <div className="mt-1">
                        {item.currency_from} → {item.currency_to}
                      </div>
                    </div>
                    {item.is_manual && (
                      <div>
                        <span className="text-slate-500">Manual үүсгэсэн админ:</span>
                        <div className="mt-1 font-medium">{item.manual_created_by_admin_id || "—"}</div>
                      </div>
                    )}
                    <div>
                      <span className="text-slate-500">Хэрэглэгчийн авах дүн:</span>
                      <div className="mt-1 font-semibold">
                        {item.currency_from.toUpperCase() === "RUB" 
                          ? formatAmount(Math.round(item.amount * item.rate), "MNT")
                          : formatAmount(parseFloat((item.amount / item.rate).toFixed(2)), "RUB")}
                      </div>
                    </div>
                  </div>
                  
                  {item.rejection_comment && (
                    <div>
                      <span className="text-slate-500">Цуцлах шалтгаан:</span>
                      <div className="text-red-600 mt-1">{item.rejection_comment}</div>
                    </div>
                  )}

                  {/* Links */}
                  <div className="flex flex-wrap gap-3 pt-2">
                    {item.receipt_id && (
                      <a
                        href={item.receipt_id}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-maroon-600 hover:underline"
                      >
                        <ExternalLink className="w-3 h-3" /> Хэрэглэгчийн баримт
                      </a>
                    )}
                    {parseBillUrls(item.bill_url).map((url, idx) => (
                      <a
                        key={`bill-${idx}`}
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-maroon-600 hover:underline"
                      >
                        <ExternalLink className="w-3 h-3" /> Хэрэглэгчийн bill{parseBillUrls(item.bill_url).length > 1 ? ` ${idx + 1}` : ""}
                      </a>
                    ))}
                    {parseBillUrls(item.admin_bill_url).map((url, idx) => (
                      <a
                        key={`admin-bill-${idx}`}
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-green-600 hover:underline"
                      >
                        <ExternalLink className="w-3 h-3" /> Админы баримт{parseBillUrls(item.admin_bill_url).length > 1 ? ` ${idx + 1}` : ""}
                      </a>
                    ))}
                  </div>

                  {item.completed_by_admin && (
                    <div className="text-xs text-slate-500">
                      Гүйцэтгэсэн админ ID: {item.completed_by_admin}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-4 pt-4">
          <button
            onClick={() => setPage(Math.max(0, page - 1))}
            disabled={page === 0}
            className="flex items-center gap-1 px-3 py-2 rounded-lg bg-white border border-slate-200 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-50"
          >
            <ChevronLeft className="w-4 h-4" /> Өмнөх
          </button>
          <span className="text-sm text-slate-600">
            {page + 1} / {totalPages}
          </span>
          <button
            onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
            disabled={page >= totalPages - 1}
            className="flex items-center gap-1 px-3 py-2 rounded-lg bg-white border border-slate-200 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-50"
          >
            Дараах <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}
