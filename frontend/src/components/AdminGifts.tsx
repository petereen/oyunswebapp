import { useState, useEffect } from "react";
import {
  Gift,
  User,
  Phone,
  CreditCard,
  Building,
  Calendar,
  Clock,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Loader2,
  Eye,
  MessageSquare,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Filter,
} from "lucide-react";
import { fetchAdminGifts, approveGift, rejectGift, AdminGift } from "../api";

export function AdminGifts() {
  const [gifts, setGifts] = useState<AdminGift[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expandedGift, setExpandedGift] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [rejectionComment, setRejectionComment] = useState("");
  const [showRejectModal, setShowRejectModal] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");

  // Load gifts
  const loadGifts = async () => {
    try {
      setLoading(true);
      setError("");
      const result = await fetchAdminGifts(statusFilter === "all" ? undefined : statusFilter);
      setGifts(result.gifts || []);
    } catch (err) {
      console.error("Error loading gifts:", err);
      setError("Бэлгүүдийг ачаалахад алдаа гарлаа");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadGifts();
  }, [statusFilter]);

  // Handle approve
  const handleApprove = async (giftId: string) => {
    try {
      setActionLoading(giftId);
      await approveGift(giftId);
      await loadGifts();
    } catch (err) {
      console.error("Error approving gift:", err);
      setError("Зөвшөөрөхөд алдаа гарлаа");
    } finally {
      setActionLoading(null);
    }
  };

  // Handle reject
  const handleReject = async (giftId: string) => {
    if (!rejectionComment.trim()) {
      return;
    }
    try {
      setActionLoading(giftId);
      await rejectGift(giftId, rejectionComment.trim());
      setShowRejectModal(null);
      setRejectionComment("");
      await loadGifts();
    } catch (err) {
      console.error("Error rejecting gift:", err);
      setError("Татгалзахад алдаа гарлаа");
    } finally {
      setActionLoading(null);
    }
  };

  // Status badge
  const getStatusBadge = (status: string) => {
    switch (status) {
      case "pending_recipient":
        return <span className="px-2 py-1 text-xs rounded-full bg-yellow-100 text-yellow-700">Хүлээн авагч хүлээж байна</span>;
      case "pending_admin":
        return <span className="px-2 py-1 text-xs rounded-full bg-orange-100 text-orange-700">Админ хүлээж байна</span>;
      case "approved":
        return <span className="px-2 py-1 text-xs rounded-full bg-blue-100 text-blue-700">Зөвшөөрсөн</span>;
      case "completed":
        return <span className="px-2 py-1 text-xs rounded-full bg-green-100 text-green-700">Дууссан</span>;
      case "rejected":
        return <span className="px-2 py-1 text-xs rounded-full bg-red-100 text-red-700">Татгалзсан</span>;
      default:
        return <span className="px-2 py-1 text-xs rounded-full bg-slate-100 text-slate-700">{status}</span>;
    }
  };

  // Format date
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString("mn-MN", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Gift className="w-6 h-6 text-pink-500" />
          <h2 className="text-xl font-bold text-ocean-700">Бэлгийн хүсэлтүүд</h2>
        </div>
        <button
          onClick={loadGifts}
          disabled={loading}
          className="p-2 rounded-lg hover:bg-ocean-100 transition"
        >
          <RefreshCw className={`w-5 h-5 text-ocean-600 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* Filter */}
      <div className="flex items-center gap-2">
        <Filter className="w-4 h-4 text-slate-500" />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-lg border border-ocean-200 px-3 py-2 text-sm"
        >
          <option value="all">Бүгд</option>
          <option value="pending_recipient">Хүлээн авагч хүлээж байна</option>
          <option value="pending_admin">Админ хүлээж байна</option>
          <option value="approved">Зөвшөөрсөн</option>
          <option value="completed">Дууссан</option>
          <option value="rejected">Татгалзсан</option>
        </select>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          <AlertCircle className="w-4 h-4" />
          {error}
        </div>
      )}

      {/* Loading */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 text-ocean-600 animate-spin" />
        </div>
      ) : gifts.length === 0 ? (
        <div className="text-center py-12 text-slate-500">
          Бэлгийн хүсэлт байхгүй
        </div>
      ) : (
        <div className="space-y-3">
          {gifts.map((gift) => (
            <div
              key={gift.id}
              className="bg-white rounded-xl border border-ocean-200 overflow-hidden shadow-sm"
            >
              {/* Gift header */}
              <div
                className="p-4 cursor-pointer hover:bg-slate-50 transition"
                onClick={() => setExpandedGift(expandedGift === gift.id ? null : gift.id)}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-pink-100 flex items-center justify-center">
                      <Gift className="w-5 h-5 text-pink-500" />
                    </div>
                    <div>
                      <div className="font-mono text-sm text-slate-500">{gift.invoice}</div>
                      <div className="font-bold text-ocean-700">
                        {gift.amount.toLocaleString()} {gift.currency_from} → {gift.currency_to}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {getStatusBadge(gift.status)}
                    {expandedGift === gift.id ? (
                      <ChevronUp className="w-5 h-5 text-slate-400" />
                    ) : (
                      <ChevronDown className="w-5 h-5 text-slate-400" />
                    )}
                  </div>
                </div>

                {/* Quick info */}
                <div className="flex items-center gap-4 mt-2 text-xs text-slate-500">
                  <span className="flex items-center gap-1">
                    <User className="w-3 h-3" />
                    {gift.sender_first_name} → {gift.recipient_first_name}
                  </span>
                  <span className="flex items-center gap-1">
                    <Calendar className="w-3 h-3" />
                    {formatDate(gift.created_at)}
                  </span>
                </div>
              </div>

              {/* Expanded details */}
              {expandedGift === gift.id && (
                <div className="px-4 pb-4 border-t border-slate-100">
                  <div className="grid grid-cols-2 gap-4 py-4">
                    {/* Sender info */}
                    <div className="space-y-2">
                      <div className="text-xs text-slate-500 font-medium uppercase">Илгээгч</div>
                      <div className="p-3 bg-slate-50 rounded-lg text-sm">
                        <div className="font-medium">{gift.sender_last_name} {gift.sender_first_name}</div>
                        <div className="text-slate-500">ID: {gift.sender_user_id}</div>
                      </div>
                    </div>

                    {/* Recipient info */}
                    <div className="space-y-2">
                      <div className="text-xs text-slate-500 font-medium uppercase">Хүлээн авагч</div>
                      <div className="p-3 bg-slate-50 rounded-lg text-sm">
                        <div className="font-medium">{gift.recipient_last_name} {gift.recipient_first_name}</div>
                        <div className="flex items-center gap-1 text-slate-500">
                          <Phone className="w-3 h-3" /> {gift.recipient_phone}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Transaction details */}
                  <div className="p-3 bg-ocean-50 rounded-lg mb-4">
                    <div className="grid grid-cols-3 gap-4 text-sm">
                      <div>
                        <div className="text-xs text-slate-500">Дүн</div>
                        <div className="font-bold">{gift.amount.toLocaleString()} {gift.currency_from}</div>
                      </div>
                      <div>
                        <div className="text-xs text-slate-500">Ханш</div>
                        <div className="font-medium">{gift.rate}</div>
                      </div>
                      <div>
                        <div className="text-xs text-slate-500">Хүлээн авах</div>
                        <div className="font-bold text-green-600">
                          {(gift.direction === "buy" ? gift.amount * gift.rate : gift.amount / gift.rate).toLocaleString("en-US", { maximumFractionDigits: 2 })} {gift.currency_to}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Recipient bank details */}
                  {gift.recipient_bank_details && (
                    <div className="p-3 bg-green-50 border border-green-200 rounded-lg mb-4">
                      <div className="text-xs text-green-600 font-medium mb-1 flex items-center gap-1">
                        <Building className="w-3 h-3" /> Хүлээн авагчийн банк
                      </div>
                      <div className="font-mono text-sm">{gift.recipient_bank_details}</div>
                    </div>
                  )}

                  {/* Message */}
                  {gift.message && (
                    <div className="p-3 bg-pink-50 rounded-lg mb-4">
                      <div className="text-xs text-pink-600 font-medium mb-1 flex items-center gap-1">
                        <MessageSquare className="w-3 h-3" /> Мессеж
                      </div>
                      <div className="text-sm italic">"{gift.message}"</div>
                    </div>
                  )}

                  {/* Images */}
                  <div className="grid grid-cols-2 gap-4 mb-4">
                    {gift.gift_card_url && (
                      <div>
                        <div className="text-xs text-slate-500 mb-1">Бэлгийн карт</div>
                        <a href={gift.gift_card_url} target="_blank" rel="noopener noreferrer">
                          <img
                            src={gift.gift_card_url}
                            alt="Gift card"
                            className="w-full h-32 object-cover rounded-lg border border-slate-200"
                          />
                        </a>
                      </div>
                    )}
                    {gift.sender_receipt_url && (
                      <div>
                        <div className="text-xs text-slate-500 mb-1">Илгээгчийн баримт</div>
                        <a href={gift.sender_receipt_url} target="_blank" rel="noopener noreferrer">
                          <img
                            src={gift.sender_receipt_url}
                            alt="Receipt"
                            className="w-full h-32 object-cover rounded-lg border border-slate-200"
                          />
                        </a>
                      </div>
                    )}
                  </div>

                  {/* Rejection comment */}
                  {gift.rejection_comment && (
                    <div className="p-3 bg-red-50 border border-red-200 rounded-lg mb-4">
                      <div className="text-xs text-red-600 font-medium mb-1">Татгалзсан шалтгаан</div>
                      <div className="text-sm text-red-700">{gift.rejection_comment}</div>
                    </div>
                  )}

                  {/* Actions */}
                  {gift.status === "pending_admin" && (
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleApprove(gift.id)}
                        disabled={actionLoading === gift.id}
                        className="flex-1 py-3 rounded-xl bg-green-600 text-white font-bold hover:bg-green-700 transition disabled:opacity-50 flex items-center justify-center gap-2"
                      >
                        {actionLoading === gift.id ? (
                          <Loader2 className="w-5 h-5 animate-spin" />
                        ) : (
                          <>
                            <CheckCircle2 className="w-5 h-5" />
                            Зөвшөөрөх
                          </>
                        )}
                      </button>
                      <button
                        onClick={() => setShowRejectModal(gift.id)}
                        disabled={actionLoading === gift.id}
                        className="flex-1 py-3 rounded-xl bg-red-500 text-white font-bold hover:bg-red-600 transition disabled:opacity-50 flex items-center justify-center gap-2"
                      >
                        <XCircle className="w-5 h-5" />
                        Татгалзах
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Rejection modal */}
      {showRejectModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md">
            <h3 className="text-lg font-bold text-ocean-700 mb-4">Татгалзах шалтгаан</h3>
            <textarea
              value={rejectionComment}
              onChange={(e) => setRejectionComment(e.target.value)}
              className="w-full rounded-lg border border-ocean-200 p-3 text-sm resize-none"
              rows={3}
              placeholder="Татгалзах шалтгаанаа бичнэ үү..."
            />
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => {
                  setShowRejectModal(null);
                  setRejectionComment("");
                }}
                className="flex-1 py-3 rounded-xl border border-ocean-200 text-ocean-700 font-medium hover:bg-ocean-50 transition"
              >
                Буцах
              </button>
              <button
                onClick={() => handleReject(showRejectModal)}
                disabled={!rejectionComment.trim() || actionLoading === showRejectModal}
                className="flex-1 py-3 rounded-xl bg-red-500 text-white font-bold hover:bg-red-600 transition disabled:opacity-50"
              >
                Татгалзах
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
