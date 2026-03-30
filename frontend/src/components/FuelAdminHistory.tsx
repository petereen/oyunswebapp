import { useState, useEffect } from "react";
import { History, Search, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, MapPin, Image, X, Clock } from "lucide-react";
import { fetchFuelAdminHistory, FuelOrder } from "../api";
import { FuelChat } from "./FuelChat";

const STATUS_OPTIONS = [
  { value: "all", label: "Бүгд" },
  { value: "completed", label: "Дууссан" },
  { value: "approved", label: "Зөвшөөрсөн" },
  { value: "pending", label: "Хүлээгдэж байна" },
  { value: "rejected", label: "Цуцалсан" },
  { value: "cancelled", label: "Цуцалсан (хэрэглэгч)" },
];

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-700",
  pending_payment: "bg-yellow-100 text-yellow-700",
  approved: "bg-green-100 text-green-700",
  paid: "bg-green-100 text-green-700",
  in_progress: "bg-green-100 text-green-700",
  fueling_complete: "bg-green-100 text-green-700",
  completed: "bg-blue-100 text-blue-700",
  rejected: "bg-red-100 text-red-700",
  cancelled: "bg-slate-100 text-slate-700",
};

const STATUS_LABELS: Record<string, string> = {
  pending: "Хүлээгдэж байна",
  pending_payment: "Хүлээгдэж байна",
  approved: "Зөвшөөрсөн",
  paid: "Зөвшөөрсөн",
  in_progress: "Зөвшөөрсөн",
  fueling_complete: "Зөвшөөрсөн",
  completed: "Дууссан",
  rejected: "Цуцалсан",
  cancelled: "Цуцалсан",
};

const PAGE_SIZE = 20;

export function FuelAdminHistory() {
  const [orders, setOrders] = useState<FuelOrder[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [photoModal, setPhotoModal] = useState<string | null>(null);

  const loadHistory = async () => {
    setLoading(true);
    try {
      const status = statusFilter === "all" ? undefined : statusFilter;
      const res = await fetchFuelAdminHistory(status, PAGE_SIZE, page * PAGE_SIZE);
      setOrders(res.orders || []);
      setTotal(res.total || 0);
    } catch {
      /* ignore */
    }
    setLoading(false);
  };

  useEffect(() => {
    loadHistory();
  }, [statusFilter, page]);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="space-y-3">
      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <History className="w-4 h-4 text-amber-600" />
        <div className="text-sm font-semibold text-dark-800 dark:text-ivory-200">Түүх ({total})</div>
        <div className="ml-auto">
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(0); }}
            className="text-xs px-2 py-1.5 rounded-lg border border-silver/60 dark:border-dark-600 bg-white dark:bg-dark-700 text-dark-800 dark:text-ivory-200"
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
      </div>

      {loading && <div className="text-center text-sm text-slate-500 py-8">Ачааллаж байна...</div>}

      {!loading && orders.length === 0 && (
        <div className="text-center text-sm text-slate-500 py-8">Түүх байхгүй</div>
      )}

      {orders.map((order) => {
        const expanded = expandedId === order.id;
        return (
          <div
            key={order.id}
            className="bg-white dark:bg-dark-800 rounded-2xl border border-silver/60 dark:border-dark-600 overflow-hidden"
          >
            <button
              onClick={() => setExpandedId(expanded ? null : order.id)}
              className="w-full p-3 flex items-center gap-3 text-left"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[order.status] || "bg-slate-100 text-slate-700"}`}>
                    {STATUS_LABELS[order.status] || order.status}
                  </span>
                  <span className="text-[10px] text-slate-400">#{order.invoice}</span>
                </div>
                <div className="text-xs font-medium text-dark-800 dark:text-ivory-200">
                  {order.station_name} • {order.liters}л • {order.final_amount.toLocaleString()} {order.payment_currency}
                </div>
                <div className="text-[10px] text-slate-400">
                  {new Date(order.created_at).toLocaleString("mn-MN")}
                </div>
              </div>
              {expanded ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
            </button>

            {expanded && (
              <div className="px-3 pb-3 space-y-3 border-t border-silver/40 dark:border-dark-600 pt-3">
                <div className="grid grid-cols-2 gap-1.5 text-xs">
                  <div><span className="text-slate-400">User ID:</span> <span className="font-medium">{order.user_id}</span></div>
                  <div><span className="text-slate-400">Үнэ/л:</span> <span className="font-medium">{order.station_price_per_liter}₽</span></div>
                  <div><span className="text-slate-400">Нийт:</span> <span className="font-medium">{order.gross_amount.toLocaleString()}₽</span></div>
                  <div><span className="text-slate-400">Хөнгөлөлт:</span> <span className="font-medium text-green-600">{order.discount_percent}%</span></div>
                  <div><span className="text-slate-400">Бүхэл:</span> <span className="font-bold text-amber-600">{order.rounded_amount.toLocaleString()}₽</span></div>
                  {order.exchange_rate && (
                    <div><span className="text-slate-400">Ханш:</span> <span className="font-medium">{order.exchange_rate}</span></div>
                  )}
                </div>

                {order.location_text && (
                  <div className="flex items-center gap-1 text-xs text-slate-500">
                    <MapPin className="w-3 h-3" /> {order.location_text}
                  </div>
                )}

                {/* Photos */}
                <div className="flex gap-2">
                  {order.payment_receipt_url && (
                    <div>
                      <div className="text-[10px] text-slate-400 mb-1">Баримт:</div>
                      <img
                        src={order.payment_receipt_url}
                        alt="receipt"
                        className="h-16 rounded-lg cursor-pointer border border-silver/40"
                        onClick={() => setPhotoModal(order.payment_receipt_url!)}
                      />
                    </div>
                  )}
                  {order.pump_photo_url && (
                    <div>
                      <div className="text-[10px] text-slate-400 mb-1">Насос:</div>
                      <img
                        src={order.pump_photo_url}
                        alt="pump"
                        className="h-16 rounded-lg cursor-pointer border border-silver/40"
                        onClick={() => setPhotoModal(order.pump_photo_url!)}
                      />
                    </div>
                  )}
                </div>

                {order.rejection_comment && (
                  <div className="text-xs text-red-600 bg-red-50 dark:bg-red-900/20 p-2 rounded-lg">
                    Цуцлах шалтгаан: {order.rejection_comment}
                  </div>
                )}

                <FuelChat orderId={order.id} isAdmin={true} />
              </div>
            )}
          </div>
        );
      })}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-4 pt-2">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="p-2 rounded-lg hover:bg-amber-100 dark:hover:bg-dark-700 transition disabled:opacity-30"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-xs text-slate-500">
            {page + 1} / {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
            className="p-2 rounded-lg hover:bg-amber-100 dark:hover:bg-dark-700 transition disabled:opacity-30"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Photo modal */}
      {photoModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4" onClick={() => setPhotoModal(null)}>
          <button className="absolute top-4 right-4 text-white" onClick={() => setPhotoModal(null)}>
            <X className="w-6 h-6" />
          </button>
          <img src={photoModal} alt="photo" className="max-w-full max-h-[85vh] rounded-lg" />
        </div>
      )}
    </div>
  );
}
