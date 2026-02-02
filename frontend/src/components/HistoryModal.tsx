import { useQuery } from "@tanstack/react-query";
import { X, Clock, CheckCircle2, XCircle, Loader2, AlertCircle, ArrowRightLeft, Image } from "lucide-react";
import { fetchHistory } from "../api";
import { useState } from "react";

interface HistoryItem {
  invoice: string;
  amount: number;
  currency_from: string;
  currency_to: string;
  status: string;
  timestamp: string;
  rate: number;
  bill_url?: string;
  receipt_id?: string;
  admin_comment?: string;
}

interface Props {
  userId?: number;
  onClose: () => void;
}

function getStatusInfo(status: string) {
  switch (status) {
    case "completed":
    case "successful": // Legacy status name - treat same as completed
      return {
        label: "Амжилттай",
        color: "bg-green-100 text-green-700",
        icon: CheckCircle2,
      };
    case "approved":
      return {
        label: "Баталгаажсан",
        color: "bg-blue-100 text-blue-700",
        icon: CheckCircle2,
      };
    case "pending":
      return {
        label: "Хүлээгдэж буй",
        color: "bg-amber-100 text-amber-700",
        icon: Clock,
      };
    case "rejected":
      return {
        label: "Татгалзсан",
        color: "bg-red-100 text-red-700",
        icon: XCircle,
      };
    default:
      return {
        label: status,
        color: "bg-slate-100 text-slate-700",
        icon: AlertCircle,
      };
  }
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr.endsWith("Z") ? dateStr : dateStr + "Z");
  return date.toLocaleDateString("mn-MN", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getTimeAgo(dateStr: string): string {
  let then: Date;
  if (dateStr.endsWith("Z") || dateStr.includes("+")) {
    then = new Date(dateStr);
  } else {
    then = new Date(dateStr + "Z");
  }
  const now = Date.now();
  const diff = now - then.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Саяхан";
  if (mins < 60) return `${mins} мин өмнө`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} цаг өмнө`;
  const days = Math.floor(hrs / 24);
  return `${days} өдрийн өмнө`;
}

export function HistoryModal({ userId, onClose }: Props) {
  const [photoModal, setPhotoModal] = useState<string | null>(null);
  
  const { data, isLoading, error } = useQuery({
    queryKey: ["history", userId],
    queryFn: () => fetchHistory(),
    enabled: Boolean(userId),
    staleTime: 0, // Always refetch to ensure fresh user data
  });

  const items: HistoryItem[] = data?.items || [];

  return (
    <>
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-2xl w-full max-w-md max-h-[85vh] overflow-hidden flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-ocean-100">
            <div className="flex items-center gap-2">
              <ArrowRightLeft className="w-5 h-5 text-ocean-600" />
              <span className="font-bold text-ocean-700">Гүйлгээний түүх</span>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-full hover:bg-ocean-50 transition"
            >
              <X className="w-5 h-5 text-slate-500" />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-auto p-4">
            {isLoading && (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 text-ocean-500 animate-spin" />
              </div>
            )}

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-xl text-sm text-center">
                Түүх татахад алдаа гарлаа
              </div>
            )}

            {!isLoading && !error && items.length === 0 && (
              <div className="text-center py-12">
                <ArrowRightLeft className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                <div className="text-slate-500">Гүйлгээ байхгүй байна</div>
                <div className="text-sm text-slate-400 mt-1">
                  Та гүйлгээ хийсний дараа энд таны хийсэн гүйлгээнүүд харагдана
                </div>
              </div>
            )}

            {!isLoading && items.length > 0 && (
              <div className="space-y-3">
                {items.map((item) => {
                  const statusInfo = getStatusInfo(item.status);
                  const StatusIcon = statusInfo.icon;
                  const isBuy = item.currency_from.toUpperCase() === "RUB";
                  // Rate is stored as MNT per RUB (e.g., 46.2 means 1 RUB = 46.2 MNT)
                  // RUB->MNT (buy): user sends RUB, receives MNT = RUB * rate
                  // MNT->RUB (sell): user sends MNT, receives RUB = MNT / rate
                  const rate = Number(item.rate);
                  const amount = Number(item.amount);
                  const receiveAmount = isBuy
                    ? Math.round(amount * rate)
                    : parseFloat((amount / rate).toFixed(2));

                  return (
                    <div
                      key={item.invoice}
                      className="bg-white border border-ocean-100 rounded-xl p-4 shadow-sm"
                    >
                      {/* Top Row: Direction & Status */}
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <span
                            className={`text-xs font-bold px-2 py-1 rounded ${
                              isBuy
                                ? "bg-green-100 text-green-700"
                                : "bg-blue-100 text-blue-700"
                            }`}
                          >
                            {isBuy ? "RUB→MNT" : "MNT→RUB"}
                          </span>
                        </div>
                        <div
                          className={`flex items-center gap-1 text-xs font-medium px-2 py-1 rounded ${statusInfo.color}`}
                        >
                          <StatusIcon className="w-3.5 h-3.5" />
                          {statusInfo.label}
                        </div>
                      </div>

                      {/* Amount Info */}
                      <div className="flex items-center justify-between mb-2">
                        <div>
                          <div className="text-lg font-bold text-ocean-700">
                            {Number(item.amount).toLocaleString()} {item.currency_from}
                          </div>
                          <div className="text-sm text-slate-500">
                            → {Number(receiveAmount).toLocaleString()} {item.currency_to}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-xs text-slate-400">Ханш</div>
                          <div className="text-sm font-medium text-ocean-600">
                            {Number(item.rate).toFixed(2)}
                          </div>
                        </div>
                      </div>

                      {/* Time */}
                      <div className="flex items-center justify-between text-xs text-slate-500 pt-2 border-t border-slate-100">
                        <div className="flex items-center gap-1">
                          <Clock className="w-3.5 h-3.5" />
                          {getTimeAgo(item.timestamp)}
                        </div>
                        <div>{formatDate(item.timestamp)}</div>
                      </div>

                      {/* Admin Comment (if rejected) */}
                      {item.status === "rejected" && item.admin_comment && (
                        <div className="mt-2 p-2 bg-red-50 rounded-lg border border-red-100">
                          <div className="text-xs text-red-600 font-medium mb-1">
                            Татгалзсан шалтгаан:
                          </div>
                          <div className="text-sm text-red-700">{item.admin_comment}</div>
                        </div>
                      )}

                      {/* Bill Image */}
                      {item.bill_url && (
                        <button
                          onClick={() => setPhotoModal(item.bill_url!)}
                          className="mt-2 flex items-center gap-1 text-xs text-ocean-600 hover:text-ocean-700"
                        >
                          <Image className="w-3.5 h-3.5" />
                          Баримт харах
                        </button>
                      )}

                      {/* Invoice ID */}
                      <div className="mt-2 text-xs text-slate-400 font-mono truncate">
                        #{item.invoice}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Photo Modal */}
      {photoModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[60] p-4">
          <div className="relative max-w-2xl max-h-[90vh] bg-white rounded-xl overflow-hidden">
            <button
              onClick={() => setPhotoModal(null)}
              className="absolute top-2 right-2 p-2 bg-white/80 rounded-full hover:bg-white"
            >
              <X className="w-5 h-5" />
            </button>
            <img
              src={photoModal}
              alt="Баримт"
              className="max-w-full max-h-[85vh] object-contain"
            />
          </div>
        </div>
      )}
    </>
  );
}
