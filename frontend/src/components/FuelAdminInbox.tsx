import { useState, useEffect } from "react";
import {
  RefreshCw,
  Image,
  X,
  CheckCircle2,
  XCircle,
  Play,
  Fuel,
  MapPin,
  ChevronDown,
  ChevronUp,
  Clock,
  Upload,
  Loader2,
  Camera,
  MessageCircle,
} from "lucide-react";
import {
  fetchFuelAdminInbox,
  fuelAdminAction,
  requestPresignAdmin,
  FuelOrder,
} from "../api";
import { FuelChat } from "./FuelChat";
import { useFuelLang } from "../i18n/useFuelLang";

function getTimeAgo(dateStr: string, t: (key: string, params?: Record<string, string | number>) => string): string {
  const then = dateStr.endsWith("Z") || dateStr.includes("+")
    ? new Date(dateStr)
    : new Date(dateStr + "Z");
  const diffMs = Date.now() - then.getTime();
  if (diffMs < 0) return t("time.justNow");
  const mins = Math.floor(diffMs / 60000);
  const hrs = Math.floor(mins / 60);
  const days = Math.floor(hrs / 24);
  if (mins < 1) return t("time.justNow");
  if (mins < 60) return `${mins} ${t("time.minAgo")}`;
  if (hrs < 24) return `${hrs} ${t("time.hrMin", { remainMins: mins % 60 })}`;
  return `${days} ${t("time.dayHr", { remainHrs: hrs % 24 })}`;
}

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

export function FuelAdminInbox() {
  const { t } = useFuelLang();

  const STATUS_LABELS: Record<string, string> = {
    pending: t("status.pending"),
    pending_payment: t("status.pending"),
    approved: t("status.approved"),
    paid: t("status.approved"),
    in_progress: t("status.approved"),
    fueling_complete: t("status.approved"),
    completed: t("status.completed"),
    rejected: t("status.rejected"),
    cancelled: t("status.cancelled"),
  };
  const [orders, setOrders] = useState<FuelOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [photoModal, setPhotoModal] = useState<string | null>(null);
  const [rejectModal, setRejectModal] = useState<string | null>(null);
  const [rejectComment, setRejectComment] = useState("");
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [approvalImageUrl, setApprovalImageUrl] = useState<Record<string, string>>({});
  const [approvalUploading, setApprovalUploading] = useState<string | null>(null);
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetchFuelAdminInbox();
      setOrders(res.orders || []);
      if (res.unread_counts) setUnreadCounts(res.unread_counts);
    } catch {
      /* ignore */
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
    const interval = setInterval(load, 15000);
    return () => clearInterval(interval);
  }, []);

  const handleAction = async (orderId: string, status: string, rejectionComment?: string) => {
    setActionLoading(orderId);
    try {
      await fuelAdminAction({
        order_id: orderId,
        status,
        rejection_comment: rejectionComment,
        approval_image_url: status === "approved" ? approvalImageUrl[orderId] : undefined,
      });
      await load();
    } catch {
      /* ignore */
    }
    setActionLoading(null);
    setRejectModal(null);
    setRejectComment("");
  };

  const handleApprovalImageUpload = async (orderId: string, file: File) => {
    setApprovalUploading(orderId);
    try {
      const ext = file.name.split(".").pop() || "jpg";
      const path = `fuel/approval/${orderId}_${Date.now()}.${ext}`;
      const presigned = await requestPresignAdmin({ bucket: "bills", path });
      await fetch(presigned.upload_url, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type },
      });
      setApprovalImageUrl((prev) => ({ ...prev, [orderId]: presigned.public_url }));
    } catch {
      /* ignore */
    }
    setApprovalUploading(null);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-dark-800 dark:text-ivory-200">
          {t("inbox.title")} ({orders.length})
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="p-2 rounded-lg hover:bg-amber-100 dark:hover:bg-dark-700 transition"
        >
          <RefreshCw className={`w-4 h-4 text-amber-600 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {loading && orders.length === 0 && (
        <div className="text-center text-sm text-slate-500 py-8">{t("common.loading")}</div>
      )}

      {!loading && orders.length === 0 && (
        <div className="text-center text-sm text-slate-500 py-8">{t("inbox.empty")}</div>
      )}

      {orders.map((order) => {
        const expanded = expandedId === order.id;
        return (
          <div
            key={order.id}
            className="bg-white dark:bg-dark-800 rounded-2xl border border-silver/60 dark:border-dark-600 overflow-hidden"
          >
            {/* Header - always visible */}
            <button
              onClick={() => setExpandedId(expanded ? null : order.id)}
              className="w-full p-4 flex items-center gap-3 text-left"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[order.status] || "bg-slate-100 text-slate-700"}`}>
                    {STATUS_LABELS[order.status] || order.status}
                  </span>
                  <span className="text-[10px] text-slate-400">
                    #{order.invoice}
                  </span>
                  {(unreadCounts[order.id] ?? 0) > 0 && !expanded && (
                    <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-red-500 text-white font-medium">
                      <MessageCircle className="w-3 h-3" />
                      {unreadCounts[order.id]}
                    </span>
                  )}
                </div>
                <div className="text-sm font-semibold text-dark-800 dark:text-ivory-200">
                  {order.station_name} • {order.liters}л
                </div>
                <div className="text-xs text-slate-500 dark:text-ivory-400">
                  {order.final_amount.toLocaleString()} {order.payment_currency} •{" "}
                  <Clock className="w-3 h-3 inline" /> {getTimeAgo(order.created_at, t)}
                </div>
              </div>
              {expanded ? (
                <ChevronUp className="w-5 h-5 text-slate-400 flex-shrink-0" />
              ) : (
                <ChevronDown className="w-5 h-5 text-slate-400 flex-shrink-0" />
              )}
            </button>

            {/* Expanded details */}
            {expanded && (
              <div className="px-4 pb-4 space-y-3 border-t border-silver/40 dark:border-dark-600 pt-3">
                {/* Order info grid */}
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-slate-400">User ID:</span>{" "}
                    <span className="font-medium text-dark-800 dark:text-ivory-200">{order.user_id}</span>
                  </div>
                  <div>
                    <span className="text-slate-400">{t("inbox.station")}</span>{" "}
                    <span className="font-medium text-dark-800 dark:text-ivory-200">{order.station_name}</span>
                  </div>
                  {order.dispenser_number && (
                  <div>
                    <span className="text-slate-400">{t("inbox.dispenser")}</span>{" "}
                    <span className="font-bold text-blue-600 dark:text-blue-400">№{order.dispenser_number}</span>
                  </div>
                  )}
                  <div>
                    <span className="text-slate-400">{t("inbox.liters")}</span>{" "}
                    <span className="font-medium text-dark-800 dark:text-ivory-200">{order.liters}л</span>
                  </div>
                  <div>
                    <span className="text-slate-400">{t("inbox.pricePerLiter")}</span>{" "}
                    <span className="font-medium text-dark-800 dark:text-ivory-200">{order.station_price_per_liter}₽</span>
                  </div>
                  <div>
                    <span className="text-slate-400">{t("inbox.total")}</span>{" "}
                    <span className="font-medium text-dark-800 dark:text-ivory-200">{order.gross_amount.toLocaleString()}₽</span>
                  </div>
                  <div>
                    <span className="text-slate-400">{t("inbox.discount")}</span>{" "}
                    <span className="font-medium text-green-600">{order.discount_percent}% (-{order.discount_amount.toLocaleString()}₽)</span>
                  </div>
                  <div>
                    <span className="text-slate-400">{t("inbox.netAmount")}</span>{" "}
                    <span className="font-medium text-dark-800 dark:text-ivory-200">{order.net_amount.toLocaleString()}₽</span>
                  </div>
                  <div>
                    <span className="text-slate-400">{t("inbox.roundedAmount")}</span>{" "}
                    <span className="font-bold text-amber-600">{order.rounded_amount.toLocaleString()}₽</span>
                  </div>
                  {order.exchange_rate && (
                    <div className="col-span-2">
                      <span className="text-slate-400">{t("inbox.rate")}</span>{" "}
                      <span className="font-medium text-dark-800 dark:text-ivory-200">{order.exchange_rate}</span>
                      <span className="text-slate-400 ml-2">{t("inbox.toPay")}</span>{" "}
                      <span className="font-bold text-amber-600">{order.final_amount.toLocaleString()} {order.payment_currency}</span>
                    </div>
                  )}
                  {order.admin_bank_name && (
                    <div className="col-span-2">
                      <span className="text-slate-400">{t("inbox.bankAccount") || "Реквизит:"}</span>{" "}
                      <span className="font-medium text-dark-800 dark:text-ivory-200">
                        {order.admin_bank_name}
                        {order.admin_bank_card ? ` • ${order.admin_bank_card}` : ""}
                        {order.admin_bank_owner ? ` (${order.admin_bank_owner})` : ""}
                      </span>
                    </div>
                  )}
                </div>

                {/* Location */}
                {order.location_text && (
                  <div className="flex items-center gap-1 text-xs text-slate-500">
                    <MapPin className="w-3 h-3" /> {order.location_text}
                  </div>
                )}
                {order.station_latitude && order.station_longitude && (
                  <a
                    href={`https://www.google.com/maps?q=${order.station_latitude},${order.station_longitude}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
                  >
                    <MapPin className="w-3 h-3" /> {t("inbox.viewOnMap")}
                  </a>
                )}

                {/* Receipt photo */}
                {order.payment_receipt_url && (
                  <div>
                    <div className="text-xs text-slate-400 mb-1">{t("inbox.paymentReceipt")}</div>
                    <img
                      src={order.payment_receipt_url}
                      alt="receipt"
                      className="h-24 rounded-lg cursor-pointer border border-silver/40"
                      onClick={() => setPhotoModal(order.payment_receipt_url!)}
                    />
                  </div>
                )}

                {/* Pump photo */}
                {order.pump_photo_url && (
                  <div>
                    <div className="text-xs text-slate-400 mb-1">{t("inbox.pumpPhoto")}</div>
                    <img
                      src={order.pump_photo_url}
                      alt="pump"
                      className="h-24 rounded-lg cursor-pointer border border-silver/40"
                      onClick={() => setPhotoModal(order.pump_photo_url!)}
                    />
                  </div>
                )}

                {/* Chat */}
                <FuelChat orderId={order.id} isAdmin={true} />

                {/* Dispenser number highlight for admin */}
                {order.dispenser_number && ["pending", "pending_payment", "approved", "paid", "in_progress"].includes(order.status) && (
                  <div className="p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl flex items-center gap-2">
                    <span className="text-2xl">🔢</span>
                    <div>
                      <div className="text-sm font-bold text-blue-700 dark:text-blue-400">
                        {t("inbox.dispenserTitle")} №{order.dispenser_number}
                      </div>
                      <p className="text-[10px] text-blue-600 dark:text-blue-400 mt-0.5">
                        {order.station_name} — {t("inbox.turnOnDispenser")}
                      </p>
                    </div>
                  </div>
                )}

                {/* QR/Barcode upload for non-dispenser stations (before approve) */}
                {!order.dispenser_number && ["pending", "pending_payment"].includes(order.status) && (
                  <div className="p-3 bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-xl space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-base">📱</span>
                      <span className="text-xs font-semibold text-purple-700 dark:text-purple-400">
                        {t("inbox.qrUploadTitle")}
                      </span>
                    </div>
                    <label className="block cursor-pointer">
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) handleApprovalImageUpload(order.id, file);
                        }}
                      />
                      <div className={`border-2 border-dashed rounded-lg p-3 text-center transition ${
                        approvalImageUrl[order.id]
                          ? "border-green-400 bg-green-50 dark:bg-green-900/10"
                          : "border-purple-300 dark:border-purple-700 hover:border-purple-400"
                      }`}>
                        {approvalUploading === order.id ? (
                          <Loader2 className="w-5 h-5 text-purple-500 animate-spin mx-auto" />
                        ) : approvalImageUrl[order.id] ? (
                          <div className="space-y-1">
                            <CheckCircle2 className="w-5 h-5 text-green-500 mx-auto" />
                            <img src={approvalImageUrl[order.id]} alt="qr" className="max-h-20 mx-auto rounded" />
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setApprovalImageUrl((prev) => {
                                  const next = { ...prev };
                                  delete next[order.id];
                                  return next;
                                });
                              }}
                              className="text-[10px] text-red-500 hover:underline"
                            >
                              {t("common.delete")}
                            </button>
                          </div>
                        ) : (
                          <div className="space-y-1">
                            <Camera className="w-5 h-5 text-purple-400 mx-auto" />
                            <div className="text-[10px] text-purple-600 dark:text-purple-400">{t("inbox.qrLabel")}</div>
                          </div>
                        )}
                      </div>
                    </label>
                  </div>
                )}

                {/* Approved - waiting for user completion */}
                {["approved", "paid", "in_progress", "fueling_complete"].includes(order.status) && (
                  <div className="p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-600" />
                    <span className="text-xs text-green-700 dark:text-green-400 font-medium">
                      {t("inbox.approvedWaiting")}
                    </span>
                  </div>
                )}

                {/* Action buttons: Approve + Reject for pending orders */}
                {["pending", "pending_payment"].includes(order.status) && (
                  <div className="flex flex-wrap gap-2 pt-2">
                    <button
                      onClick={() => handleAction(order.id, "approved")}
                      disabled={actionLoading === order.id || (!order.dispenser_number && !approvalImageUrl[order.id])}
                      className="flex-1 flex items-center justify-center gap-1 px-3 py-2 bg-green-500 text-white text-xs font-semibold rounded-xl hover:bg-green-600 transition disabled:opacity-50"
                    >
                      <CheckCircle2 className="w-3 h-3" /> {t("inbox.approve")}
                    </button>
                    <button
                      onClick={() => setRejectModal(order.id)}
                      disabled={actionLoading === order.id}
                      className="flex items-center justify-center gap-1 px-3 py-2 bg-red-500 text-white text-xs font-semibold rounded-xl hover:bg-red-600 transition disabled:opacity-50"
                    >
                      <XCircle className="w-3 h-3" /> {t("inbox.reject")}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* Photo modal */}
      {photoModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4" onClick={() => setPhotoModal(null)}>
          <button className="absolute top-4 right-4 text-white" onClick={() => setPhotoModal(null)}>
            <X className="w-6 h-6" />
          </button>
          <img src={photoModal} alt="photo" className="max-w-full max-h-[85vh] rounded-lg" />
        </div>
      )}

      {/* Reject modal */}
      {rejectModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-dark-800 rounded-2xl p-6 max-w-sm w-full space-y-4">
            <h3 className="font-bold text-dark-800 dark:text-ivory-200">{t("inbox.rejectTitle")}</h3>
            <textarea
              value={rejectComment}
              onChange={(e) => setRejectComment(e.target.value)}
              placeholder={t("inbox.rejectReason")}
              className="w-full px-3 py-2 border border-silver/60 dark:border-dark-600 rounded-xl text-sm bg-white dark:bg-dark-700 text-dark-800 dark:text-ivory-200 focus:outline-none focus:ring-1 focus:ring-amber-400"
              rows={3}
            />
            <div className="flex gap-2">
              <button
                onClick={() => handleAction(rejectModal, "rejected", rejectComment || undefined)}
                className="flex-1 bg-red-500 text-white py-2 rounded-xl text-sm font-semibold hover:bg-red-600 transition"
              >
                {t("inbox.reject")}
              </button>
              <button
                onClick={() => { setRejectModal(null); setRejectComment(""); }}
                className="flex-1 bg-slate-200 dark:bg-dark-600 text-dark-800 dark:text-ivory-200 py-2 rounded-xl text-sm font-semibold hover:bg-slate-300 dark:hover:bg-dark-500 transition"
              >
                {t("common.cancel")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
