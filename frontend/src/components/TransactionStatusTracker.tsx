import { useQuery } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { Clock, ThumbsUp, CheckCircle2, X, AlertTriangle, MessageCircle } from "lucide-react";
import { fetchActiveTransactions, ActiveTransaction } from "../api";
import { useLang } from "../i18n/useLang";
import { useSwipeToDismiss } from "../hooks/useSwipeToDismiss";

interface TransactionStatusTrackerProps {
  userId?: number;
  onEditRequest?: (invoice: string) => void;
}

export function TransactionStatusTracker({ userId, onEditRequest }: TransactionStatusTrackerProps) {
  // Track which transactions user has dismissed
  const [dismissedInvoices, setDismissedInvoices] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem("dismissedTransactions");
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  const { data, isLoading } = useQuery({
    queryKey: ["activeTransactions", userId],
    queryFn: () => fetchActiveTransactions(),
    enabled: Boolean(userId),
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  // Save dismissed invoices to localStorage
  useEffect(() => {
    localStorage.setItem("dismissedTransactions", JSON.stringify(dismissedInvoices));
  }, [dismissedInvoices]);

  const handleDismiss = (invoice: string) => {
    setDismissedInvoices(prev => [...prev, invoice]);
  };

  if (isLoading || !data) return null;

  // Filter out dismissed transactions
  const visibleTransactions = data.transactions.filter(
    (trx) => !dismissedInvoices.includes(trx.invoice)
  );

  // Only show pending/approved OR recently completed/successful/rejected that haven't been dismissed
  const activeTransactions = visibleTransactions.filter(
    (trx) => trx.status === "pending" || trx.status === "approved" || 
             ((trx.status === "completed" || trx.status === "successful") && !dismissedInvoices.includes(trx.invoice)) ||
             ((trx.status === "rejected" || trx.status === "waiting_edit") && !dismissedInvoices.includes(trx.invoice))
  );

  if (activeTransactions.length === 0) return null;

  return (
    <div className="space-y-2 mb-4">
      {activeTransactions.map((trx) => (
        <TransactionStatusCard
          key={trx.invoice}
          transaction={trx}
          onDismiss={() => handleDismiss(trx.invoice)}
          onEditRequest={onEditRequest}
        />
      ))}
    </div>
  );
}

interface TransactionStatusCardProps {
  transaction: ActiveTransaction;
  onDismiss?: () => void;
  onEditRequest?: (invoice: string) => void;
}

function TransactionStatusCard({ transaction, onDismiss, onEditRequest }: TransactionStatusCardProps) {
  const { status, invoice, amount, currency_from, currency_to, admin_comment } = transaction;
  const { t } = useLang();

  const getStatusConfig = () => {
    switch (status) {
      case "pending":
        return {
          icon: Clock,
          iconBg: "bg-amber-100",
          iconColor: "text-amber-600",
          barColor: "bg-amber-400",
          barBg: "bg-amber-100",
          progress: 33,
          label: t("status.pending"),
          description: t("status.pending_desc"),
        };
      case "approved":
        return {
          icon: ThumbsUp,
          iconBg: "bg-green-100",
          iconColor: "text-green-500",
          barColor: "bg-green-400",
          barBg: "bg-green-100",
          progress: 66,
          label: t("status.approved"),
          description: t("status.approved_desc"),
        };
      case "completed":
      case "successful": // Legacy status name
        return {
          icon: CheckCircle2,
          iconBg: "bg-green-100",
          iconColor: "text-green-600",
          barColor: "bg-green-500",
          barBg: "bg-green-100",
          progress: 100,
          label: t("status.completed"),
          description: t("status.completed_desc"),
        };
      case "rejected":
        return {
          icon: AlertTriangle,
          iconBg: "bg-red-100",
          iconColor: "text-red-600",
          barColor: "bg-red-500",
          barBg: "bg-red-100",
          progress: 100,
          label: t("status.rejected"),
          description: admin_comment || t("status.rejected_desc"),
        };
      case "waiting_edit":
        return {
          icon: AlertTriangle,
          iconBg: "bg-amber-100",
          iconColor: "text-amber-600",
          barColor: "bg-amber-500",
          barBg: "bg-amber-100",
          progress: 100,
          label: t("status.waiting_edit"),
          description: admin_comment || t("status.waiting_edit_desc"),
        };
      default:
        return {
          icon: Clock,
          iconBg: "bg-slate-100",
          iconColor: "text-slate-600",
          barColor: "bg-slate-400",
          barBg: "bg-slate-100",
          progress: 0,
          label: t("status.unknown"),
          description: "",
        };
    }
  };

  const config = getStatusConfig();
  const Icon = config.icon;
  const canDismiss = Boolean(onDismiss && (status === "completed" || status === "successful" || status === "rejected"));
  const { swipeHandlers, swipeStyle } = useSwipeToDismiss({ onDismiss: canDismiss ? onDismiss : undefined });

  return (
    <div
      {...swipeHandlers}
      style={swipeStyle}
      className={`relative p-4 rounded-xl border ${status === "rejected" ? "bg-red-50 border-red-200" : "bg-white border-maroon-100"}`}
    >
      {/* Dismiss button for completed/rejected */}
      {canDismiss && (
        <button
          onClick={onDismiss}
          className="absolute top-2 right-2 p-1 rounded-full hover:bg-slate-100 transition"
          title={t("status.close")}
        >
          <X className="w-4 h-4 text-slate-400" />
        </button>
      )}

      <div className="flex items-center gap-3 mb-3">
        {/* Status Icon */}
        <div className={`p-2 rounded-full ${config.iconBg}`}>
          <Icon className={`w-5 h-5 ${config.iconColor}`} />
        </div>

        {/* Transaction Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm text-slate-700">{config.label}</span>
            <span className="text-xs text-slate-400">#{invoice}</span>
          </div>
          <div className="text-xs text-slate-500 truncate">
            {amount.toLocaleString()} {currency_from} → {currency_to}
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

      {/* Description */}
      <p className="text-xs text-slate-500 mt-2">{config.description}</p>

      {status === "waiting_edit" && onEditRequest && (
        <button
          onClick={() => onEditRequest(invoice)}
          className="mt-3 w-full rounded-lg bg-amber-600 text-white py-2 text-xs font-semibold hover:bg-amber-700 transition"
        >
          {t("status.edit_request")}
        </button>
      )}

      {/* Support contact for rejected */}
      {(status === "rejected" || status === "waiting_edit") && (
        <a
          href="https://t.me/oyuns_finance"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 flex items-center justify-center gap-2 text-xs text-red-600 hover:text-red-700 transition"
        >
          <MessageCircle className="w-4 h-4" />
          <span>{t("status.support_contact")}</span>
        </a>
      )}
    </div>
  );
}
