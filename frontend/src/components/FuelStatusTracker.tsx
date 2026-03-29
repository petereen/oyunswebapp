import { useQuery } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import {
  Fuel,
  Clock,
  CreditCard,
  Wrench,
  CheckCircle2,
  X,
  AlertTriangle,
  MessageCircle,
} from "lucide-react";
import { fetchActiveFuelOrders, FuelOrder } from "../api";

interface Props {
  userId?: number;
}

export function FuelStatusTracker({ userId }: Props) {
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
          onDismiss={
            ["completed", "rejected", "cancelled"].includes(order.status)
              ? () => handleDismiss(order.id)
              : undefined
          }
        />
      ))}
    </div>
  );
}

function FuelStatusCard({
  order,
  onDismiss,
}: {
  order: FuelOrder;
  onDismiss?: () => void;
}) {
  const cfg = getStatusConfig(order.status, order.rejection_comment);
  const Icon = cfg.icon;

  return (
    <div
      className={`relative p-4 rounded-xl border ${
        order.status === "rejected" || order.status === "cancelled"
          ? "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800"
          : "bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-900/20 dark:to-orange-900/20 border-amber-200 dark:border-amber-800"
      }`}
    >
      {onDismiss && (
        <button
          onClick={onDismiss}
          className="absolute top-2 right-2 p-1 rounded-full hover:bg-slate-100 dark:hover:bg-dark-700 transition"
          title="Хаах"
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

      {(order.status === "rejected" || order.status === "cancelled") && (
        <a
          href="https://t.me/oyuns_finance"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 flex items-center justify-center gap-2 text-xs text-red-600 hover:text-red-700 transition"
        >
          <MessageCircle className="w-4 h-4" />
          <span>Тусламж авах</span>
        </a>
      )}
    </div>
  );
}

function getStatusConfig(status: string, rejectionComment?: string) {
  switch (status) {
    case "pending_payment":
      return {
        icon: CreditCard,
        iconBg: "bg-amber-100 dark:bg-amber-900/40",
        iconColor: "text-amber-600",
        barColor: "bg-amber-400",
        barBg: "bg-amber-100 dark:bg-amber-900/40",
        progress: 15,
        label: "Төлбөр хүлээгдэж байна",
        description: "Төлбөрийн баримтаа илгээнэ үү",
      };
    case "paid":
      return {
        icon: Clock,
        iconBg: "bg-blue-100 dark:bg-blue-900/40",
        iconColor: "text-blue-600",
        barColor: "bg-blue-400",
        barBg: "bg-blue-100 dark:bg-blue-900/40",
        progress: 35,
        label: "Төлбөр илгээгдсэн",
        description: "Админ баталгаажуулж байна",
      };
    case "in_progress":
      return {
        icon: Wrench,
        iconBg: "bg-orange-100 dark:bg-orange-900/40",
        iconColor: "text-orange-600",
        barColor: "bg-orange-400",
        barBg: "bg-orange-100 dark:bg-orange-900/40",
        progress: 60,
        label: "Түлш цэнэглэж байна",
        description: "Админ түлш цэнэглэж байна, түр хүлээнэ үү",
      };
    case "fueling_complete":
      return {
        icon: Fuel,
        iconBg: "bg-green-100 dark:bg-green-900/40",
        iconColor: "text-green-500",
        barColor: "bg-green-400",
        barBg: "bg-green-100 dark:bg-green-900/40",
        progress: 80,
        label: "Цэнэглэлт дууссан",
        description: "Насосны зургаа илгээнэ үү",
      };
    case "completed":
      return {
        icon: CheckCircle2,
        iconBg: "bg-green-100 dark:bg-green-900/40",
        iconColor: "text-green-600",
        barColor: "bg-green-500",
        barBg: "bg-green-100 dark:bg-green-900/40",
        progress: 100,
        label: "Амжилттай",
        description: "Түлш амжилттай цэнэглэгдлээ!",
      };
    case "rejected":
      return {
        icon: AlertTriangle,
        iconBg: "bg-red-100 dark:bg-red-900/40",
        iconColor: "text-red-600",
        barColor: "bg-red-500",
        barBg: "bg-red-100 dark:bg-red-900/40",
        progress: 100,
        label: "Цуцлагдсан",
        description: rejectionComment || "Таны хүсэлт цуцлагдсан",
      };
    case "cancelled":
      return {
        icon: X,
        iconBg: "bg-slate-100 dark:bg-slate-800",
        iconColor: "text-slate-600",
        barColor: "bg-slate-400",
        barBg: "bg-slate-100 dark:bg-slate-800",
        progress: 100,
        label: "Цуцалсан",
        description: "Хүсэлт цуцлагдсан",
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
}
