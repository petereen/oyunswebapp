import { useState, useEffect } from "react";
import {
  Gift,
  AlertCircle,
  CheckCircle2,
  Loader2,
  X,
  Building,
  CreditCard,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { fetchPendingGifts, confirmGiftReceipt, PendingGift } from "../api";
import { formatRussianPhone, formatCardNumber, formatIBAN, formatMongolianPhone } from "./RegistrationModal";

interface Props {
  onGiftConfirmed?: () => void;
}

// Bank name options
const RUB_BANKS = ["Сбербанк", "Т-Банк", "Альфа-Банк", "ВТБ", "Райффайзен банк", "Газпромбанк", "ПСБ", "Россельхозбанк", "Бусад"];
const MNT_BANKS = ["Хаан банк", "Голомт банк", "М банк", "Хас банк", "Худалдаа хөгжлийн банк", "Ариг банк", "Богд банк", "Төрийн банк", "Капитрон банк", "Бусад"];

export function PendingGiftBanner({ onGiftConfirmed }: Props) {
  const [pendingGifts, setPendingGifts] = useState<PendingGift[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const [successGiftId, setSuccessGiftId] = useState<string | null>(null);

  // Bank details form
  const [bankName, setBankName] = useState("");
  const [customBankName, setCustomBankName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [ownerName, setOwnerName] = useState("");

  // Determine if custom bank input is needed
  const isCustomBank = bankName === "Бусад" || bankName === "Бусад";

  // Load pending gifts
  useEffect(() => {
    const loadGifts = async () => {
      try {
        const result = await fetchPendingGifts();
        setPendingGifts(result.gifts || []);
        // Auto-expand first gift
        if (result.gifts && result.gifts.length > 0) {
          setExpanded(result.gifts[0].id);
        }
      } catch (err) {
        console.error("Error loading pending gifts:", err);
      } finally {
        setLoading(false);
      }
    };
    loadGifts();
  }, []);

  // Handle confirmation
  const handleConfirm = async (gift: PendingGift) => {
    const finalBankName = isCustomBank ? customBankName : bankName;
    
    if (!finalBankName.trim()) {
      setError("Банкны нэр оруулна уу");
      return;
    }
    if (!accountNumber.trim()) {
      setError("Дансны дугаар эсвэл картын дугаар оруулна уу");
      return;
    }
    if (!ownerName.trim()) {
      setError("Эзэмшигчийн нэр оруулна уу");
      return;
    }

    try {
      setConfirming(true);
      setError("");
      
      const bankDetails = `${finalBankName.trim()} | ${accountNumber.trim()} | ${ownerName.trim()}`;
      
      await confirmGiftReceipt(gift.id, bankDetails);
      setSuccessGiftId(gift.id);
      
      // Remove from list after 3 seconds
      setTimeout(() => {
        setPendingGifts((prev) => prev.filter((g) => g.id !== gift.id));
        setSuccessGiftId(null);
        setBankName("");
        setCustomBankName("");
        setAccountNumber("");
        setOwnerName("");
        onGiftConfirmed?.();
      }, 3000);
    } catch (err: any) {
      console.error("Error confirming gift:", err);
      // Check for specific error codes
      if (err?.response?.status === 401) {
        setError("Нэвтрэлт хугацаа дууссан. Аппыг дахин нээнэ үү.");
      } else if (err?.response?.status === 403) {
        setError("Танд энэ бэлгийг авах эрх байхгүй байна.");
      } else if (err?.response?.status === 400) {
        setError(err?.response?.data?.detail || "Бэлэг аль хэдийн баталгаажсан байна.");
      } else if (err?.response?.status === 404) {
        setError("Бэлэг олдсонгүй. Хуудсыг дахин ачааллана уу.");
      } else if (err?.response?.status === 500) {
        const detail = err?.response?.data?.detail || "";
        setError(`Серверийн алдаа: ${detail || "Дахин оролдоно уу."}`);
      } else {
        setError("Баталгаажуулахад алдаа гарлаа. Дахин оролдоно уу.");
      }
    } finally {
      setConfirming(false);
    }
  };

  // Get bank options based on currency
  const getBankOptions = (currencyTo: string) => {
    return currencyTo === "RUB" ? RUB_BANKS : MNT_BANKS;
  };

  if (loading) return null;
  if (pendingGifts.length === 0) return null;

  return (
    <div className="space-y-4 mb-6">
      {pendingGifts.map((gift) => (
        <div
          key={gift.id}
          className={`rounded-2xl overflow-hidden transition-all ${
            successGiftId === gift.id
              ? "bg-green-50 border-2 border-green-300"
              : "bg-gradient-to-r from-pink-100 to-purple-100 border-2 border-pink-300"
          }`}
        >
          {/* Header */}
          <div
            className="p-4 cursor-pointer"
            onClick={() => setExpanded(expanded === gift.id ? null : gift.id)}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-pink-200 flex items-center justify-center">
                  <Gift className="w-6 h-6 text-pink-600" />
                </div>
                <div>
                  <div className="text-sm text-pink-700">🎁 Танд бэлэг ирлээ!</div>
                  <div className="text-lg font-bold text-purple-800">
                    {gift.from_name || `${gift.sender_first_name} ${gift.sender_last_name}`}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="text-right">
                  <div className="text-lg font-bold text-purple-700">
                    {gift.amount.toLocaleString()} {gift.currency_from}
                  </div>
                  <div className="text-xs text-slate-500">
                    → {(gift.direction === "buy" ? gift.amount * gift.rate : gift.amount / gift.rate).toLocaleString("en-US", { maximumFractionDigits: 2 })} {gift.currency_to}
                  </div>
                </div>
                {expanded === gift.id ? (
                  <ChevronUp className="w-5 h-5 text-pink-600" />
                ) : (
                  <ChevronDown className="w-5 h-5 text-pink-600" />
                )}
              </div>
            </div>
          </div>

          {/* Expanded content */}
          {expanded === gift.id && (
            <div className="px-4 pb-4">
              {successGiftId === gift.id ? (
                <div className="text-center py-6">
                  <CheckCircle2 className="w-16 h-16 text-green-500 mx-auto mb-3" />
                  <div className="text-lg font-bold text-green-700">Баталгаажууллаа!</div>
                  <div className="text-sm text-slate-600">
                    Админ таны хүсэлтийг удахгүй шийдвэрлэнэ
                  </div>
                </div>
              ) : (
                <>
                  {/* Gift card */}
                  {gift.gift_card_url && (
                    <div className="mb-4">
                      <img
                        src={gift.gift_card_url}
                        alt="Gift card"
                        className="w-full max-w-xs mx-auto rounded-xl shadow-lg"
                      />
                    </div>
                  )}

                  {/* Message */}
                  {gift.message && (
                    <div className="mb-4 p-4 bg-white/60 rounded-xl">
                      <div className="text-xs text-slate-500 mb-1">Мессеж:</div>
                      <div className="text-slate-700 italic">"{gift.message}"</div>
                    </div>
                  )}

                  {/* Bank details form */}
                  <div className="bg-white/80 rounded-xl p-4 space-y-3">
                    <div className="text-sm font-medium text-ocean-700 mb-2">
                      💳 Мөнгө хүлээн авах банкны мэдээлэл оруулна уу ({gift.currency_to})
                    </div>

                    {/* Bank name dropdown */}
                    <div>
                      <label className="text-xs text-slate-500 flex items-center gap-1">
                        <Building className="w-3 h-3" /> Банкны нэр
                      </label>
                      <select
                        value={bankName}
                        onChange={(e) => {
                          setBankName(e.target.value);
                          if (e.target.value !== "Бусад" && e.target.value !== "Бусад") {
                            setCustomBankName("");
                          }
                        }}
                        className="w-full rounded-lg border border-ocean-200 p-3 text-sm bg-white"
                      >
                        <option value="">Банк сонгох...</option>
                        {getBankOptions(gift.currency_to).map((bank) => (
                          <option key={bank} value={bank}>{bank}</option>
                        ))}
                      </select>
                    </div>

                    {/* Custom bank name input */}
                    {isCustomBank && (
                      <div>
                        <label className="text-xs text-slate-500">Банкны нэр бичих</label>
                        <input
                          type="text"
                          value={customBankName}
                          onChange={(e) => setCustomBankName(e.target.value)}
                          className="w-full rounded-lg border border-ocean-200 p-3 text-sm"
                          placeholder="Банкны нэрээ оруулна уу"
                        />
                      </div>
                    )}

                    {/* Account/Card number */}
                    <div>
                      <label className="text-xs text-slate-500 flex items-center gap-1">
                        <CreditCard className="w-3 h-3" /> Дансны дугаар / Картын дугаар
                      </label>
                      <input
                        type="text"
                        value={accountNumber}
                        onChange={(e) => {
                          // Format based on currency
                          if (gift.currency_to === "MNT") {
                            setAccountNumber(formatIBAN(e.target.value));
                          } else if (gift.currency_to === "RUB") {
                            setAccountNumber(formatCardNumber(e.target.value));
                          } else {
                            setAccountNumber(e.target.value);
                          }
                        }}
                        className="w-full rounded-lg border border-ocean-200 p-3 text-sm"
                        placeholder={gift.currency_to === "MNT" ? "MN XX XXXX XX XXXXXXXXXX" : "XXXX XXXX XXXX XXXX"}
                        maxLength={gift.currency_to === "RUB" ? 19 : undefined}
                      />
                    </div>

                    {/* Owner name */}
                    <div>
                      <label className="text-xs text-slate-500">Эзэмшигчийн нэр</label>
                      <input
                        type="text"
                        value={ownerName}
                        onChange={(e) => setOwnerName(e.target.value)}
                        className="w-full rounded-lg border border-ocean-200 p-3 text-sm"
                        placeholder="IVANOV IVAN"
                      />
                    </div>

                    {/* Error */}
                    {error && (
                      <div className="flex items-center gap-2 p-2 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                        <AlertCircle className="w-4 h-4" />
                        {error}
                      </div>
                    )}

                    {/* Confirm button */}
                    <button
                      onClick={() => handleConfirm(gift)}
                      disabled={confirming}
                      className="w-full py-4 rounded-xl bg-gradient-to-r from-pink-500 to-purple-500 text-white font-bold hover:from-pink-600 hover:to-purple-600 transition disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      {confirming ? (
                        <>
                          <Loader2 className="w-5 h-5 animate-spin" />
                          Баталгаажуулж байна...
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="w-5 h-5" />
                          Бэлэг хүлээн авах
                        </>
                      )}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
