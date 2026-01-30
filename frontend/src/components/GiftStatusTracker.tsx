import { useQuery } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { Gift, Clock, UserCheck, ThumbsUp, CheckCircle2, X, AlertTriangle, MessageCircle } from "lucide-react";
import { fetchSentGifts, SentGift } from "../api";

interface GiftStatusTrackerProps {
  userId?: number;
}

export function GiftStatusTracker({ userId }: GiftStatusTrackerProps) {
  // Track which gifts user has dismissed
  const [dismissedInvoices, setDismissedInvoices] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem("dismissedGifts");
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  const { data, isLoading } = useQuery({
    queryKey: ["sentGifts", userId],
    queryFn: () => fetchSentGifts(),
    enabled: Boolean(userId),
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  // Save dismissed invoices to localStorage
  useEffect(() => {
    localStorage.setItem("dismissedGifts", JSON.stringify(dismissedInvoices));
  }, [dismissedInvoices]);

  const handleDismiss = (invoice: string) => {
    setDismissedInvoices((prev) => [...prev, invoice]);
  };

  if (isLoading || !data) return null;

  // Filter out dismissed gifts (only completed/rejected ones can be dismissed)
  const visibleGifts = data.gifts.filter(
    (gift) =>
      !dismissedInvoices.includes(gift.invoice) ||
      gift.status === "pending_recipient" ||
      gift.status === "pending_admin"
  );

  // Only show active or recently completed/rejected gifts
  const activeGifts = visibleGifts.filter(
    (gift) =>
      gift.status === "pending_recipient" ||
      gift.status === "pending_admin" ||
      ((gift.status === "completed" || gift.status === "approved") &&
        !dismissedInvoices.includes(gift.invoice)) ||
      (gift.status === "rejected" && !dismissedInvoices.includes(gift.invoice))
  );

  if (activeGifts.length === 0) return null;

  return (
    <div className="space-y-2 mb-4">
      {activeGifts.map((gift) => (
        <GiftStatusCard
          key={gift.invoice}
          gift={gift}
          onDismiss={
            gift.status === "completed" ||
            gift.status === "approved" ||
            gift.status === "rejected"
              ? () => handleDismiss(gift.invoice)
              : undefined
          }
        />
      ))}
    </div>
  );
}

interface GiftStatusCardProps {
  gift: SentGift;
  onDismiss?: () => void;
}

function GiftStatusCard({ gift, onDismiss }: GiftStatusCardProps) {
  const { status, invoice, amount, currency_from, currency_to, recipient_first_name, recipient_last_name } =
    gift;

  const getStatusConfig = () => {
    switch (status) {
      case "pending_recipient":
        return {
          icon: Clock,
          iconBg: "bg-amber-100",
          iconColor: "text-amber-600",
          barColor: "bg-amber-400",
          barBg: "bg-amber-100",
          progress: 25,
          label: "Хүлээн авагч хүлээгдэж байна",
          description: "Хүлээн авагч банкны мэдээллээ оруулаагүй байна",
        };
      case "pending_admin":
        return {
          icon: UserCheck,
          iconBg: "bg-blue-100",
          iconColor: "text-blue-600",
          barColor: "bg-blue-400",
          barBg: "bg-blue-100",
          progress: 50,
          label: "Админ хүлээгдэж байна",
          description: "Хүлээн авагч банкаа баталгаажуулсан, админ шалгаж байна",
        };
      case "approved":
        return {
          icon: ThumbsUp,
          iconBg: "bg-green-100",
          iconColor: "text-green-500",
          barColor: "bg-green-400",
          barBg: "bg-green-100",
          progress: 75,
          label: "Баталгаажсан",
          description: "Админ бэлгийг баталгаажуулсан, шилжүүлж байна",
        };
      case "completed":
        return {
          icon: CheckCircle2,
          iconBg: "bg-green-100",
          iconColor: "text-green-600",
          barColor: "bg-green-500",
          barBg: "bg-green-100",
          progress: 100,
          label: "Амжилттай",
          description: "Бэлэг амжилттай хүргэгдлээ!",
        };
      case "rejected":
        return {
          icon: AlertTriangle,
          iconBg: "bg-red-100",
          iconColor: "text-red-600",
          barColor: "bg-red-500",
          barBg: "bg-red-100",
          progress: 100,
          label: "Цуцлагдсан",
          description: "Бэлэг цуцлагдсан",
        };
      default:
        return {
          icon: Clock,
          iconBg: "bg-slate-100",
          iconColor: "text-slate-600",
          barColor: "bg-slate-400",
          barBg: "bg-slate-100",
          progress: 0,
          label: "Тодорхойгүй",
          description: "",
        };
    }
  };

  const config = getStatusConfig();
  const Icon = config.icon;

  return (
    <div
      className={`relative p-4 rounded-xl border ${
        status === "rejected"
          ? "bg-red-50 border-red-200"
          : "bg-gradient-to-r from-pink-50 to-purple-50 border-pink-200"
      }`}
    >
      {/* Dismiss button for completed/rejected */}
      {onDismiss && (
        <button
          onClick={onDismiss}
          className="absolute top-2 right-2 p-1 rounded-full hover:bg-slate-100 transition"
          title="Хаах"
        >
          <X className="w-4 h-4 text-slate-400" />
        </button>
      )}

      <div className="flex items-center gap-3 mb-3">
        {/* Status Icon */}
        <div className={`p-2 rounded-full ${config.iconBg}`}>
          <Icon className={`w-5 h-5 ${config.iconColor}`} />
        </div>

        {/* Gift Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <Gift className="w-4 h-4 text-pink-500" />
            <span className="font-semibold text-sm text-slate-700">{config.label}</span>
          </div>
          <div className="text-xs text-slate-500 truncate">
            {recipient_first_name} {recipient_last_name} руу • {amount.toLocaleString()} {currency_from} →{" "}
            {currency_to}
          </div>
        </div>
      </div>

      {/* Progress Bar */}
      <div className={`h-2 rounded-full overflow-hidden ${config.barBg}`}>
        <div
          className={`h-full transition-all duration-500 ${config.barColor}`}
          style={{ width: `${config.progress}%` }}
        />
      </div>

      {/* Step indicators */}
      <div className="flex justify-between mt-2 text-[10px] text-slate-400">
        <span className={status !== "rejected" ? "text-pink-500 font-medium" : ""}>Илгээсэн</span>
        <span
          className={
            status === "pending_admin" ||
            status === "approved" ||
            status === "completed"
              ? "text-pink-500 font-medium"
              : ""
          }
        >
          Хүлээн авсан
        </span>
        <span
          className={status === "approved" || status === "completed" ? "text-pink-500 font-medium" : ""}
        >
          Баталгаажсан
        </span>
        <span className={status === "completed" ? "text-green-500 font-medium" : ""}>Дууссан</span>
      </div>

      {/* Description */}
      <p className="text-xs text-slate-500 mt-2">{config.description}</p>

      {/* Invoice */}
      <p className="text-[10px] text-slate-400 mt-1">#{invoice}</p>

      {/* Support contact for rejected */}
      {status === "rejected" && (
        <a
          href="https://t.me/oyuns_finance"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 flex items-center justify-center gap-2 text-xs text-red-600 hover:text-red-700 transition"
        >
          <MessageCircle className="w-4 h-4" />
          <span>Асуудалтай гэж бодвол тусламжтай холбогдоорой</span>
        </a>
      )}
    </div>
  );
}
