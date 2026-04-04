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
import { useLang } from "../i18n/useLang";

interface Props {
  onGiftConfirmed?: () => void;
}

// Bank name options
const RUB_BANKS = ["Сбербанк", "Т-Банк", "Альфа-Банк", "ВТБ", "Райффайзен банк", "Газпромбанк", "ПСБ", "Россельхозбанк", "Бусад"];
const MNT_BANKS = ["Хаан банк", "Голомт банк", "М банк", "Хас банк", "Худалдаа хөгжлийн банк", "Ариг банк", "Богд банк", "Төрийн банк", "Капитрон банк", "Бусад"];

export function PendingGiftBanner({ onGiftConfirmed }: Props) {
  const { t } = useLang();
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
      setError(t("gift_banner.bank_required"));
      return;
    }
    if (!accountNumber.trim()) {
      setError(t("gift_banner.account_required"));
      return;
    }
    if (!ownerName.trim()) {
      setError(t("gift_banner.owner_required"));
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
        setError(t("gift_banner.auth_expired"));
      } else if (err?.response?.status === 403) {
        setError(t("gift_banner.no_permission"));
      } else if (err?.response?.status === 400) {
        setError(err?.response?.data?.detail || t("gift_banner.already_confirmed"));
      } else if (err?.response?.status === 404) {
        setError(t("gift_banner.not_found"));
      } else if (err?.response?.status === 500) {
        const detail = err?.response?.data?.detail || "";
        setError(t("gift_banner.server_error", { detail: detail || "Дахин оролдоно уу." }));
      } else {
        setError(t("gift_banner.confirm_error"));
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
                  <div className="text-sm text-pink-700">{t("gift_banner.you_have_gift")}</div>
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
                  <div className="text-lg font-bold text-green-700">{t("gift_banner.confirmed")}</div>
                  <div className="text-sm text-slate-600">
                    {t("gift_banner.admin_process")}
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
                      <div className="text-xs text-slate-500 mb-1">{t("gift_banner.message")}</div>
                      <div className="text-slate-700 italic">"{gift.message}"</div>
                    </div>
                  )}

                  {/* Bank details form */}
                  <div className="bg-white/80 rounded-xl p-4 space-y-3">
                    <div className="text-sm font-medium text-maroon-700 mb-2">
                      {t("gift_banner.bank_info_title")} ({gift.currency_to})
                    </div>

                    {/* Bank name dropdown */}
                    <div>
                      <label className="text-xs text-slate-500 flex items-center gap-1">
                        <Building className="w-3 h-3" /> {t("gift_banner.bank_name_label")}
                      </label>
                      <select
                        value={bankName}
                        onChange={(e) => {
                          setBankName(e.target.value);
                          if (e.target.value !== "Бусад" && e.target.value !== "Бусад") {
                            setCustomBankName("");
                          }
                        }}
                        className="w-full rounded-lg border border-maroon-200 p-3 text-sm bg-white"
                      >
                        <option value="">{t("gift_banner.select_bank")}...</option>
                        {getBankOptions(gift.currency_to).map((bank) => (
                          <option key={bank} value={bank}>{bank === "Бусад" ? t("common.other") : bank}</option>
                        ))}
                      </select>
                    </div>

                    {/* Custom bank name input */}
                    {isCustomBank && (
                      <div>
                        <label className="text-xs text-slate-500">{t("gift_banner.bank_name_custom")}</label>
                        <input
                          type="text"
                          value={customBankName}
                          onChange={(e) => setCustomBankName(e.target.value)}
                          className="w-full rounded-lg border border-maroon-200 p-3 text-sm"
                          placeholder={t("gift_banner.bank_name_placeholder")}
                        />
                      </div>
                    )}

                    {/* Account/Card number */}
                    <div>
                      <label className="text-xs text-slate-500 flex items-center gap-1">
                        <CreditCard className="w-3 h-3" /> {t("gift_banner.account_number")}
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
                        className="w-full rounded-lg border border-maroon-200 p-3 text-sm"
                        placeholder={gift.currency_to === "MNT" ? "MN XX XXXX XX XXXXXXXXXX" : "XXXX XXXX XXXX XXXX"}
                        maxLength={gift.currency_to === "RUB" ? 19 : undefined}
                      />
                    </div>

                    {/* Owner name */}
                    <div>
                      <label className="text-xs text-slate-500">{t("gift_banner.owner_name")}</label>
                      <input
                        type="text"
                        value={ownerName}
                        onChange={(e) => setOwnerName(e.target.value)}
                        className="w-full rounded-lg border border-maroon-200 p-3 text-sm"
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
                          {t("gift_banner.confirming")}
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="w-5 h-5" />
                          {t("gift_banner.confirm")}
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
