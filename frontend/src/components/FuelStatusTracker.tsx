import { useQuery } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import {
  Fuel,
  Clock,
  CheckCircle2,
  X,
  AlertTriangle,
  MessageCircle,
  ChevronRight,
} from "lucide-react";
import { fetchActiveFuelOrders, FuelOrder } from "../api";
import { useLang } from "../i18n/useLang";
import { useSwipeToDismiss } from "../hooks/useSwipeToDismiss";

interface Props {
  userId?: number;
  onOpenOrder?: (orderId: string) => void;
}

export function FuelStatusTracker({ userId, onOpenOrder }: Props) {
  const [dismissed, setDismissed] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem("dismissedFuelOrders");
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  const { data, isLoading } = useQuery({
    queryKey: ["activeFuelOrders", userId],
    queryFn: () => fetchActiveFuelOrders(),
    enabled: Boolean(userId),
    refetchInterval: 30000,
  });

  useEffect(() => {
    localStorage.setItem("dismissedFuelOrders", JSON.stringify(dismissed));
  }, [dismissed]);

  const handleDismiss = (id: string) => {
    setDismissed((prev) => [...prev, id]);
  };

  if (isLoading || !data) return null;

  const visible = data.orders.filter(
    (o) =>
      !dismissed.includes(o.id) ||
      !["completed", "rejected", "cancelled"].includes(o.status)
  );

  if (visible.length === 0) return null;

  return (
    <div className="space-y-2 mb-4">
      {visible.map((order) => (
        <FuelStatusCard
          key={order.id}
          order={order}
          onOpen={onOpenOrder ? () => onOpenOrder(order.id) : undefined}
          onDismiss={() => handleDismiss(order.id)}
        />
      ))}
    </div>
  );
}

function FuelStatusCard({
  order,
  onOpen,
  onDismiss,
}: {
  order: FuelOrder;
  onOpen?: () => void;
  onDismiss?: () => void;
}) {
  const { t } = useLang();
  const cfg = getStatusConfig(order.status, order.rejection_comment, t);
  const Icon = cfg.icon;
  const { swipeHandlers, swipeStyle } = useSwipeToDismiss({ onDismiss });

  return (
    <div
      {...swipeHandlers}
      style={swipeStyle}
      onClick={onOpen}
      className={`relative p-4 rounded-xl border ${onOpen ? "cursor-pointer active:scale-[0.98] transition-transform" : ""} ${
        order.status === "rejected" || order.status === "cancelled"
          ? "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800"
          : "bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-900/20 dark:to-orange-900/20 border-amber-200 dark:border-amber-800"
      }`}
    >
      {onDismiss && (
        <button
          onClick={onDismiss}
          className="absolute top-2 right-2 p-1 rounded-full hover:bg-slate-100 dark:hover:bg-dark-700 transition"
          title={t("status.close")}
        >
          <X className="w-4 h-4 text-slate-400" />
        </button>
      )}

      <div className="flex items-center gap-3 mb-3">
        <div className={`p-2 rounded-full ${cfg.iconBg}`}>
          <Icon className={`w-5 h-5 ${cfg.iconColor}`} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <Fuel className="w-4 h-4 text-amber-500" />
            <span className="font-semibold text-sm text-slate-700 dark:text-ivory-200">
              {cfg.label}
            </span>
          </div>
          <div className="text-xs text-slate-500 dark:text-ivory-400 truncate">
            {order.station_name} • {order.liters}л • {order.final_amount.toLocaleString()}{" "}
            {order.payment_currency}
          </div>
        </div>
      </div>

      <div className={`h-2 rounded-full overflow-hidden ${cfg.barBg}`}>
        <div
          className={`h-full transition-all duration-500 ${cfg.barColor}`}
          style={{ width: `${cfg.progress}%` }}
        />
      </div>

      <p className="text-xs text-slate-500 dark:text-ivory-400 mt-2">
        {cfg.description}
      </p>

      {onOpen && (
        <div className="flex items-center justify-end gap-1 mt-2 text-xs text-amber-600 dark:text-amber-400 font-medium">
          <span>{t("fuel_status.details")}</span>
          <ChevronRight className="w-3.5 h-3.5" />
        </div>
      )}

      {(order.status === "rejected" || order.status === "cancelled") && (
        <a
          href="https://t.me/oyuns_finance"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 flex items-center justify-center gap-2 text-xs text-red-600 hover:text-red-700 transition"
        >
          <MessageCircle className="w-4 h-4" />
          <span>{t("fuel_status.get_help")}</span>
        </a>
      )}
    </div>
  );
}

function getStatusConfig(status: string, rejectionComment?: string, t?: (key: string) => string) {
  switch (status) {
    case "pending":
    case "pending_payment":
      return {
        icon: Clock,
        iconBg: "bg-amber-100 dark:bg-amber-900/40",
        iconColor: "text-amber-600",
        barColor: "bg-amber-400",
        barBg: "bg-amber-100 dark:bg-amber-900/40",
        progress: 33,
        label: t?.("fuel_status.pending") ?? "Хүлээгдэж байна",
        description: t?.("fuel_status.pending_desc") ?? "Админ таны хүсэлтийг шалгаж байна",
      };
    case "approved":
    case "paid":
    case "in_progress":
    case "fueling_complete":
      return {
        icon: Fuel,
        iconBg: "bg-green-100 dark:bg-green-900/40",
        iconColor: "text-green-500",
        barColor: "bg-green-400",
        barBg: "bg-green-100 dark:bg-green-900/40",
        progress: 66,
        label: t?.("fuel_status.approved") ?? "Зөвшөөрсөн",
        description: t?.("fuel_status.approved_desc") ?? "Колонкны дэлгэцийн зургаа оруулна уу",
      };
    case "completed":
      return {
        icon: CheckCircle2,
        iconBg: "bg-green-100 dark:bg-green-900/40",
        iconColor: "text-green-600",
        barColor: "bg-green-500",
        barBg: "bg-green-100 dark:bg-green-900/40",
        progress: 100,
        label: t?.("fuel_status.completed") ?? "Амжилттай",
        description: t?.("fuel_status.completed_desc") ?? "Шатахуун амжилттай цэнэглэгдлээ!",
      };
    case "rejected":
      return {
        icon: AlertTriangle,
        iconBg: "bg-red-100 dark:bg-red-900/40",
        iconColor: "text-red-600",
        barColor: "bg-red-500",
        barBg: "bg-red-100 dark:bg-red-900/40",
        progress: 100,
        label: t?.("fuel_status.rejected") ?? "Цуцлагдсан",
        description: rejectionComment || (t?.("fuel_status.rejected_desc") ?? "Хүсэлт цуцлагдсан"),
      };
    case "cancelled":
      return {
        icon: X,
        iconBg: "bg-slate-100 dark:bg-slate-800",
        iconColor: "text-slate-600",
        barColor: "bg-slate-400",
        barBg: "bg-slate-100 dark:bg-slate-800",
        progress: 100,
        label: t?.("fuel_status.cancelled") ?? "Цуцалсан",
        description: t?.("fuel_status.cancelled_desc") ?? "Захиалга цуцлагдсан",
      };
    default:
      return {
        icon: Clock,
        iconBg: "bg-slate-100",
        iconColor: "text-slate-600",
        barColor: "bg-slate-400",
        barBg: "bg-slate-100",
        progress: 0,
        label: t?.("status.unknown") ?? "Тодорхойгүй",
        description: "",
      };
  }
}
