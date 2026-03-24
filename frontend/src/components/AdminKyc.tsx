import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  XCircle,
  User,
  Phone,
  CreditCard,
  Building,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  FileText,
  Clock,
  ExternalLink,
} from "lucide-react";
import { fetchKycPending, kycAction, KycItem } from "../api";

// No props needed - auth is removed
export function AdminKyc() {
  const queryClient = useQueryClient();
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [rejectingUserId, setRejectingUserId] = useState<number | null>(null);
  const [rejectionComment, setRejectionComment] = useState("");

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["adminKyc"],
    queryFn: () => fetchKycPending(),
    refetchInterval: 30000,
  });

  const pending = data?.items || [];

  const actionMutation = useMutation({
    mutationFn: ({ userId, action, rejection_reason }: { userId: number; action: "approve" | "reject"; rejection_reason?: string }) =>
      kycAction({ user_id: userId, action, rejection_reason }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["adminKyc"] });
      setRejectingUserId(null);
      setRejectionComment("");
    },
  });

  const handleAction = (userId: number, action: "approve" | "reject", rejection_reason?: string) => {
    actionMutation.mutate({ userId, action, rejection_reason });
  };

  const handleRejectClick = (userId: number) => {
    setRejectingUserId(userId);
    setRejectionComment("");
  };

  const handleConfirmReject = () => {
    if (rejectingUserId) {
      handleAction(rejectingUserId, "reject", rejectionComment || undefined);
    }
  };

  const handleCancelReject = () => {
    setRejectingUserId(null);
    setRejectionComment("");
  };

  const formatDate = (dateString: string | null | undefined) => {
    if (!dateString) return "—";
    return new Date(dateString).toLocaleDateString("mn-MN", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const parseRubBank = (bankStr: string | null | undefined) => {
    if (!bankStr || bankStr === ",,,") return null; // Return null if empty or just commas
    const parts = bankStr.split(",").map((p) => p.trim());
    // Check if all parts are empty
    if (parts.every(p => !p)) return null;
    return {
      bankName: parts[0] || "—",
      phoneSbp: parts[1] || "—",
      cardNumber: parts[2] || "—",
      ownerName: parts[3] || "—",
    };
  };

  const parseMntBank = (bankStr: string | null | undefined) => {
    if (!bankStr) return { bankName: "—", accountNumber: "—", ownerName: "—" };
    const parts = bankStr.split(",").map((p) => p.trim());
    return {
      bankName: parts[0] || "—",
      accountNumber: parts[1] || "—",
      ownerName: parts[2] || "—",
    };
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-4 border-maroon-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
          <FileText className="w-5 h-5 text-maroon-600" />
          Баталгаажуулалт хүлээж буй ({pending.length})
        </h2>
        <button
          onClick={() => refetch()}
          className="p-2 rounded-full bg-maroon-100 text-maroon-600 hover:bg-maroon-200 transition"
        >
          <RefreshCw className="w-5 h-5" />
        </button>
      </div>

      {pending.length === 0 ? (
        <div className="text-center py-12 bg-white/50 rounded-xl border border-maroon-100">
          <CheckCircle2 className="w-12 h-12 mx-auto text-green-500 mb-2" />
          <p className="text-slate-600">Хүлээгдэж буй баталгаажуулалт байхгүй байна</p>
        </div>
      ) : (
        <div className="space-y-3">
          {pending.map((item: KycItem) => {
            const isExpanded = expandedId === item.user_id;
            const rubBank = parseRubBank(item.bank_rub);
            const mntBank = parseMntBank(item.bank_mnt);

            return (
              <div
                key={item.user_id}
                className="bg-white/80 rounded-xl border border-maroon-100 overflow-hidden"
              >
                {/* Summary Row */}
                <div
                  className="p-4 flex items-center justify-between cursor-pointer hover:bg-maroon-50/50 transition"
                  onClick={() => setExpandedId(isExpanded ? null : item.user_id)}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-maroon-100 flex items-center justify-center">
                      <User className="w-5 h-5 text-maroon-600" />
                    </div>
                    <div>
                      <p className="font-semibold text-slate-800">
                        {item.last_name || ""} {item.first_name || ""}
                      </p>
                      <div className="flex items-center gap-2 text-xs text-slate-500">
                        <Phone className="w-3 h-3" />
                        {item.phone || "—"}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right text-xs text-slate-400">
                      <Clock className="w-3 h-3 inline-block mr-1" />
                      {formatDate(item.updated_at)}
                    </div>
                    {isExpanded ? (
                      <ChevronUp className="w-5 h-5 text-slate-400" />
                    ) : (
                      <ChevronDown className="w-5 h-5 text-slate-400" />
                    )}
                  </div>
                </div>

                {/* Expanded Details */}
                {isExpanded && (
                  <div className="border-t border-maroon-100 p-4 space-y-4 bg-maroon-50/30">
                    {/* RUB Bank Details - Only show if available */}
                    {rubBank ? (
                      <div className="space-y-2">
                        <h4 className="text-sm font-semibold text-maroon-700 flex items-center gap-2">
                          <CreditCard className="w-4 h-4" />
                          RUB банкны мэдээлэл
                        </h4>
                        <div className="grid grid-cols-2 gap-2 text-sm">
                          <div className="bg-white rounded-lg p-2">
                            <span className="text-xs text-slate-500">Банк</span>
                            <p className="font-medium">{rubBank.bankName}</p>
                          </div>
                          <div className="bg-white rounded-lg p-2">
                            <span className="text-xs text-slate-500">СБП утас</span>
                            <p className="font-medium">{rubBank.phoneSbp}</p>
                          </div>
                          <div className="bg-white rounded-lg p-2">
                            <span className="text-xs text-slate-500">Карт</span>
                            <p className="font-medium">{rubBank.cardNumber}</p>
                          </div>
                          <div className="bg-white rounded-lg p-2">
                            <span className="text-xs text-slate-500">Эзэмшигч</span>
                            <p className="font-medium">{rubBank.ownerName}</p>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="p-3 bg-slate-50 rounded-lg text-sm text-slate-500 flex items-center gap-2">
                        <CreditCard className="w-4 h-4" />
                        <span>RUB банкны мэдээлэл оруулаагүй</span>
                      </div>
                    )}

                    {/* MNT Bank Details */}
                    <div className="space-y-2">
                      <h4 className="text-sm font-semibold text-maroon-700 flex items-center gap-2">
                        <Building className="w-4 h-4" />
                        MNT банкны мэдээлэл
                      </h4>
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div className="bg-white rounded-lg p-2">
                          <span className="text-xs text-slate-500">Банк</span>
                          <p className="font-medium">{mntBank.bankName}</p>
                        </div>
                        <div className="bg-white rounded-lg p-2">
                          <span className="text-xs text-slate-500">Данс</span>
                          <p className="font-medium">{mntBank.accountNumber}</p>
                        </div>
                        <div className="bg-white rounded-lg p-2 col-span-2">
                          <span className="text-xs text-slate-500">Эзэмшигч</span>
                          <p className="font-medium">{mntBank.ownerName}</p>
                        </div>
                      </div>
                    </div>

                    {/* Passport Photo */}
                    {item.passport_storage_url && (
                      <div className="space-y-2">
                        <h4 className="text-sm font-semibold text-maroon-700 flex items-center gap-2">
                          <FileText className="w-4 h-4" />
                          Паспортын зураг
                        </h4>
                        <a
                          href={item.passport_storage_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block"
                        >
                          <img
                            src={item.passport_storage_url}
                            alt="Passport"
                            className="max-h-48 rounded-lg border border-maroon-200 hover:opacity-80 transition"
                          />
                          <span className="text-xs text-maroon-600 flex items-center gap-1 mt-1">
                            <ExternalLink className="w-3 h-3" />
                            Томруулж харах
                          </span>
                        </a>
                      </div>
                    )}

                    {/* Action Buttons */}
                    <div className="flex gap-3 pt-2">
                      <button
                        onClick={() => handleAction(item.user_id, "approve")}
                        disabled={actionMutation.isPending}
                        className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-green-600 text-white font-bold hover:bg-green-700 transition disabled:opacity-50"
                      >
                        <CheckCircle2 className="w-5 h-5" />
                        Баталгаажуулах
                      </button>
                      <button
                        onClick={() => handleRejectClick(item.user_id)}
                        disabled={actionMutation.isPending}
                        className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-red-500 text-white font-bold hover:bg-red-600 transition disabled:opacity-50"
                      >
                        <XCircle className="w-5 h-5" />
                        Татгалзах
                      </button>
                    </div>

                    {/* Rejection Comment Modal */}
                    {rejectingUserId === item.user_id && (
                      <div className="mt-4 p-4 bg-red-50 rounded-xl border border-red-200">
                        <h4 className="text-sm font-semibold text-red-700 mb-2">Татгалзах шалтгаан</h4>
                        <textarea
                          value={rejectionComment}
                          onChange={(e) => setRejectionComment(e.target.value)}
                          placeholder="Шалтгааныг оруулна уу (заавал биш)"
                          className="w-full p-3 rounded-lg border border-red-200 focus:ring-2 focus:ring-red-500 focus:border-red-500 text-sm resize-none"
                          rows={3}
                        />
                        <div className="flex gap-2 mt-3">
                          <button
                            onClick={handleConfirmReject}
                            disabled={actionMutation.isPending}
                            className="flex-1 py-2 rounded-lg bg-red-600 text-white font-semibold hover:bg-red-700 transition disabled:opacity-50"
                          >
                            Татгалзах
                          </button>
                          <button
                            onClick={handleCancelReject}
                            className="px-4 py-2 rounded-lg bg-gray-200 text-gray-700 font-semibold hover:bg-gray-300 transition"
                          >
                            Цуцлах
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
