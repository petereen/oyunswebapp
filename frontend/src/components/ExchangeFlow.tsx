import { useState, useMemo, useEffect } from "react";
import { ArrowLeft, ArrowRightLeft, CheckCircle2, Copy, CreditCard, Upload, Edit3, Tag, Gift } from "lucide-react";
import { DEFAULT_MIN_RUB_AMOUNT, DEFAULT_MIN_RUB_BUY, createExchange, ExchangeCreateInput, requestPresign, fetchAdminBankAccounts, validatePromoCode, AdminBankAccount, fetchUserPromoCodes, UserPromoCode, fetchAppSettings } from "../api";
import { formatRussianPhone, formatCardNumber, formatIBAN, formatMongolianPhone } from "./RegistrationModal";
import { useLang } from "../i18n/useLang";

interface Props {
  initData: string;
  buyRate: number;
  sellRate: number;
  savedBankRub?: string;
  savedBankMnt?: string;
  onBack: () => void;
}

const RUB_BANKS = ["Сбербанк", "Т-Банк", "Альфа-Банк", "ВТБ", "Райффайзен банк", "Газпромбанк", "ПСБ", "Россельхозбанк", "Бусад"];
const MNT_BANKS = ["Хаан банк", "Голомт банк", "М банк", "Хас банк", "Худалдаа хөгжлийн банк", "Ариг банк", "Богд банк", "Төрийн банк", "Капитрон банк", "Бусад"];

// Parse saved bank info
function parseSavedBank(saved: string | undefined): Record<string, string> {
  if (!saved) return {};
  const result: Record<string, string> = {};
  const parts = saved.split("•").map((s) => s.trim());
  parts.forEach((part) => {
    const [key, ...rest] = part.split(":");
    if (key && rest.length > 0) {
      result[key.trim().toLowerCase()] = rest.join(":").trim();
    }
  });
  return result;
}

export function ExchangeFlow({ initData, buyRate, sellRate, savedBankRub, savedBankMnt, onBack }: Props) {
  const { t } = useLang();
  // Steps:
  // 0: Direction selection
  // 1: Promo code (optional)
  // 2: Amount entry
  // 3: Select admin bank account (for RUB->MNT) OR show universal MNT account (for MNT->RUB)
  // 4: Upload transaction receipt
  // 5: User's receiving bank (saved or custom)
  // 6: Success

  const [step, setStep] = useState<number>(0);
  const [direction, setDirection] = useState<"buy" | "sell" | null>(null);
  
  // Promo code
  const [promoCode, setPromoCode] = useState<string>("");
  const [promoDiscount, setPromoDiscount] = useState<number>(0);
  const [promoValidating, setPromoValidating] = useState(false);
  const [promoError, setPromoError] = useState("");
  const [promoValid, setPromoValid] = useState(false);
  const [promoMessage, setPromoMessage] = useState("");
  const [userPromoCodes, setUserPromoCodes] = useState<UserPromoCode[]>([]);
  
  // Amount
  const [amount, setAmount] = useState<number>(0);
  
  // Admin bank accounts (for RUB->MNT direction)
  const [adminBanks, setAdminBanks] = useState<AdminBankAccount[]>([]);
  const [selectedAdminBank, setSelectedAdminBank] = useState<AdminBankAccount | null>(null);
  
  // MNT admin bank for MNT->RUB (sell) direction
  const [selectedMntAdminBank, setSelectedMntAdminBank] = useState<AdminBankAccount | null>(null);
  
  // User's receiving bank fields
  // For MNT->RUB (sell): need СБП phone, card, owner name
  const [rubBank, setRubBank] = useState<string>("");
  const [rubCardNumber, setRubCardNumber] = useState<string>("");
  const [rubPhone, setRubPhone] = useState<string>("");
  const [rubOwnerName, setRubOwnerName] = useState<string>("");
  
  // For RUB->MNT (buy): need IBAN, owner name
  const [mntBank, setMntBank] = useState<string>("");
  const [mntIban, setMntIban] = useState<string>("");
  const [mntOwnerName, setMntOwnerName] = useState<string>("");
  
  // Receipt upload - now supports multiple
  const [receiptUrls, setReceiptUrls] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  
  // Invoice ID (generated when entering step 3)
  const [invoiceId, setInvoiceId] = useState<string>("");
  
  // App settings
  const [minRubAmount, setMinRubAmount] = useState<number>(DEFAULT_MIN_RUB_AMOUNT);
  const [minRubBuy, setMinRubBuy] = useState<number>(DEFAULT_MIN_RUB_BUY);
  
  // Final
  const [useSavedBank, setUseSavedBank] = useState<boolean | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [successInvoice, setSuccessInvoice] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [copied, setCopied] = useState<string>("");

  // Generate invoice ID using Moscow timezone
  const generateInvoiceId = () => {
    const now = new Date();
    // Convert to Moscow time (UTC+3)
    const moscowOffset = 3 * 60; // minutes
    const localOffset = now.getTimezoneOffset(); // minutes (negative for east of UTC)
    const moscowTime = new Date(now.getTime() + (moscowOffset + localOffset) * 60 * 1000);
    
    const year = moscowTime.getFullYear();
    const month = String(moscowTime.getMonth() + 1).padStart(2, '0');
    const day = String(moscowTime.getDate()).padStart(2, '0');
    const hours = String(moscowTime.getHours()).padStart(2, '0');
    const minutes = String(moscowTime.getMinutes()).padStart(2, '0');
    const seconds = String(moscowTime.getSeconds()).padStart(2, '0');
    const random = String(Math.floor(Math.random() * 100)).padStart(2, '0');
    
    return `${year}${month}${day}-${hours}${minutes}${seconds}-${random}`;
  };

  // Load admin bank accounts and user promo codes
  useEffect(() => {
    fetchAdminBankAccounts()
      .then((res) => setAdminBanks(res.accounts || []))
      .catch(() => setAdminBanks([]));
    
    // Load app settings (min_rub_amount, min_rub_buy)
    fetchAppSettings()
      .then((res) => {
        setMinRubAmount(res.min_rub_amount);
        setMinRubBuy(res.min_rub_buy);
      })
      .catch(() => {
        setMinRubAmount(DEFAULT_MIN_RUB_AMOUNT);
        setMinRubBuy(DEFAULT_MIN_RUB_BUY);
      });
    
    // Load user's promo codes (active codes belonging to this user)
    fetchUserPromoCodes()
      .then((res) => {
        console.log("User promo codes response:", res);
        // Show all active promo codes that belong to the user
        // Filter out only 'default' source codes (these are general codes, not user-specific)
        const userCodes = (res.promo_codes || []).filter(
          p => p.active && p.source !== "default"
        );
        console.log("User's promo codes (excluding default):", userCodes);
        setUserPromoCodes(userCodes);
      })
      .catch((err) => {
        console.error("Error fetching user promo codes:", err);
        setUserPromoCodes([]);
      });
  }, []);

  // Calculate effective rate with promo discount
  const baseRate = useMemo(() => {
    if (!direction) return 0;
    return direction === "buy" ? buyRate : sellRate;
  }, [direction, buyRate, sellRate]);

  // Volume discount: 0.3 MNT rate adjustment for large transactions (100k+ RUB)
  const VOLUME_DISCOUNT = 0.3;
  const VOLUME_THRESHOLD_RUB = 100_000;

  const hasVolumeDiscount = useMemo(() => {
    if (!amount || !baseRate || !direction) return false;
    if (direction === "buy") {
      // RUB→MNT: threshold is 100k RUB (amount is in RUB)
      return amount >= VOLUME_THRESHOLD_RUB;
    } else {
      // MNT→RUB: threshold is 100k * baseRate MNT (amount is in MNT)
      return amount >= VOLUME_THRESHOLD_RUB * baseRate;
    }
  }, [amount, baseRate, direction]);

  const effectiveRate = useMemo((): number => {
    const base = Number(baseRate) || 0;
    if (!base) return 0;
    const discount = Number(promoDiscount) || 0;
    // Volume discount only applies when no promo code is active
    const volumeAdj = !discount && hasVolumeDiscount ? VOLUME_DISCOUNT : 0;
    console.log("effectiveRate calc - base:", base, "discount:", discount, "volumeAdj:", volumeAdj, "direction:", direction);
    const adj = discount || volumeAdj;
    if (adj > 0) {
      const result = direction === "buy" 
        ? base + adj 
        : base - adj;
      const roundedResult = Math.round(result * 10) / 10;
      console.log("effectiveRate result:", roundedResult);
      return roundedResult;
    }
    return base;
  }, [baseRate, promoDiscount, direction, hasVolumeDiscount]);

  const currencyFrom = direction === "buy" ? "RUB" : "MNT";
  const currencyTo = direction === "buy" ? "MNT" : "RUB";

  const convertedAmount = useMemo(() => {
    if (!effectiveRate || !amount) return 0;
    return direction === "buy" ? amount * effectiveRate : amount / effectiveRate;
  }, [amount, effectiveRate, direction]);

  // Get filtered admin banks for current direction
  const availableAdminBanks = useMemo(() => {
    if (direction === "buy") {
      // User sends RUB, so admin needs RUB accounts
      return adminBanks.filter((b) => b.currency === "RUB" && b.is_active);
    }
    return [];
  }, [adminBanks, direction]);

  // Get available MNT admin banks for sell direction (user sends MNT)
  const availableMntAdminBanks = useMemo(() => {
    if (direction === "sell") {
      return adminBanks.filter((b) => b.currency === "MNT" && b.is_active);
    }
    return [];
  }, [adminBanks, direction]);

  // Auto-select the first MNT bank when available for sell direction
  useEffect(() => {
    if (direction === "sell" && availableMntAdminBanks.length > 0 && !selectedMntAdminBank) {
      setSelectedMntAdminBank(availableMntAdminBanks[0]);
    }
  }, [direction, availableMntAdminBanks, selectedMntAdminBank]);

  const handleSelectDirection = (dir: "buy" | "sell") => {
    setDirection(dir);
    setStep(1); // Go to promo code step
  };

  const handleValidatePromo = async () => {
    if (!promoCode.trim() || !direction) {
      setStep(2); // Skip to amount if no promo
      return;
    }
    
    setPromoValidating(true);
    setPromoError("");
    try {
      const res = await validatePromoCode(promoCode.trim(), direction);
      console.log("Promo validation response:", res);
      if (res.valid) {
        const discount = Number(res.discount_amount) || 0;
        console.log("Setting promoDiscount to:", discount);
        setPromoDiscount(discount);
        setPromoValid(true);
        setPromoMessage(res.message || "");
        setStep(2); // Only proceed to next step if promo is valid
      } else {
        setPromoError(res.message || t("txn.promo_not_found"));
        setPromoDiscount(0);
        setPromoValid(false);
        // Stay on current step - don't proceed
      }
    } catch (err) {
      console.error("Promo validation error:", err);
      setPromoError(t("txn.promo_error"));
      setPromoDiscount(0);
      setPromoValid(false);
      // Stay on current step - don't proceed
    } finally {
      setPromoValidating(false);
    }
  };

  const handleSkipPromo = () => {
    setPromoCode("");
    setPromoDiscount(0);
    setPromoValid(false);
    setStep(2);
  };

  const handleCopy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text.replace(/\s/g, ""));
      setCopied(label);
      setTimeout(() => setCopied(""), 2000);
    } catch (err) {
      console.error("Clipboard error:", err);
      // Fallback for older browsers or when clipboard API fails
      const textArea = document.createElement("textarea");
      textArea.value = text.replace(/\s/g, "");
      document.body.appendChild(textArea);
      textArea.select();
      try {
        document.execCommand("copy");
        setCopied(label);
        setTimeout(() => setCopied(""), 2000);
      } catch {
        setError(t("txn.copy_failed"));
      }
      document.body.removeChild(textArea);
    }
  };

  const handleUpload = async (file: File) => {
    try {
      setError("");
      setUploading(true);
      const path = `${direction}/${Date.now()}-${file.name}`;
      const presigned = await requestPresign({ bucket: "bills", path });
      await fetch(presigned.upload_url, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type },
      });
      setReceiptUrls(prev => [...prev, presigned.public_url]);
    } catch (err) {
      console.error(err);
      setError(t("txn.upload_error"));
    } finally {
      setUploading(false);
    }
  };

  const handleMultipleUpload = async (files: FileList) => {
    for (const file of Array.from(files)) {
      await handleUpload(file);
    }
  };

  const removeReceipt = (index: number) => {
    setReceiptUrls(prev => prev.filter((_, i) => i !== index));
  };

  const getSavedBankForDirection = (dir: "buy" | "sell"): string | undefined => {
    const saved = dir === "buy" ? savedBankMnt : savedBankRub;
    // Return undefined if empty string so falsy check works correctly
    if (!saved || saved.trim() === "") return undefined;
    console.log("getSavedBankForDirection:", dir, "saved:", saved);
    return saved;
  };

  const initEmptyBankFields = (dir: "buy" | "sell") => {
    if (dir === "buy") {
      setMntBank("");
      setMntIban("");
      setMntOwnerName("");
    } else {
      setRubBank("");
      setRubCardNumber("");
      setRubPhone("");
      setRubOwnerName("");
    }
  };

  const prefillSavedBank = (dir: "buy" | "sell") => {
    const saved = getSavedBankForDirection(dir);
    if (!saved) return;
    const parsed = parseSavedBank(saved);
    
    if (dir === "buy") {
      setMntBank(parsed["bank"] || "");
      setMntIban(parsed["iban"] || parsed["account"] || "");
      setMntOwnerName(parsed["owner"] || parsed["name"] || "");
    } else {
      setRubBank(parsed["bank"] || "");
      setRubCardNumber(parsed["card"] || parsed["account"] || "");
      setRubPhone(parsed["phone"] || parsed["сбп"] || "");
      setRubOwnerName(parsed["owner"] || parsed["name"] || "");
    }
  };

  const handleUseSaved = (use: boolean) => {
    setUseSavedBank(use);
    if (use && direction) {
      // If using saved bank, submit directly with saved bank details
      const savedBankDetails = buildBankDetailsFromSaved(direction);
      handleSubmit(savedBankDetails);
    } else if (direction) {
      initEmptyBankFields(direction);
    }
  };

  const buildBankDetailsFromSaved = (dir: "buy" | "sell"): string => {
    const saved = getSavedBankForDirection(dir);
    return saved || "";
  };

  const buildBankDetails = (): string => {
    if (direction === "buy") {
      // Format: bank,account,owner
      return `${mntBank},${mntIban},${mntOwnerName}`;
    } else {
      // Format: bank,phone,card,owner
      return `${rubBank},${rubPhone},${rubCardNumber},${rubOwnerName}`;
    }
  };

  const isBankValid = (): boolean => {
    if (direction === "buy") {
      return !!(mntBank && mntIban && mntOwnerName);
    } else {
      return !!(rubBank && rubCardNumber && rubPhone && rubOwnerName);
    }
  };

  const handleSubmit = async (overrideBankDetails?: string) => {
    if (!direction) return;
    setLoading(true);
    setError("");
    try {
      const payload: ExchangeCreateInput = {
        direction,
        amount,
        currency_from: currencyFrom,
        currency_to: currencyTo,
        rate: effectiveRate,
        bank_details: overrideBankDetails || buildBankDetails(),
        receipt_path: receiptUrls[0], // First image for backward compatibility
        receipt_paths: receiptUrls, // All images
        promo_code: promoValid ? promoCode : undefined,
        admin_bank_id: selectedAdminBank?.id != null ? Number(selectedAdminBank.id) : undefined,
        invoice: invoiceId, // Pass the pre-generated invoice ID
      };
      console.log("Creating exchange with payload:", payload);
      const res = await createExchange(payload);
      console.log("Exchange created:", res);
      setSuccessInvoice(res.invoice);
      setStep(6);
    } catch (err) {
      console.error("Exchange creation error:", err);
      setError(t("txn.exchange_error"));
    } finally {
      setLoading(false);
    }
  };

  const handleBack = () => {
    if (step === 1) {
      setStep(0);
      setDirection(null);
    } else if (step === 2) {
      setStep(1);
    } else if (step === 3) {
      setStep(2);
    } else if (step === 4) {
      setStep(3);
      setUseSavedBank(null); // Reset so saved bank choice shows again when going forward
    } else if (step === 5) {
      setStep(4);
      setUseSavedBank(null); // Reset so saved bank choice shows again
    }
  };

  return (
    <div className="glass-card p-5 rounded-2xl border border-white/60 flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        {step > 0 && step < 6 && (
          <button onClick={handleBack} className="p-2 hover:bg-maroon-100 rounded-full">
            <ArrowLeft className="w-5 h-5 text-maroon-600" />
          </button>
        )}
        <div className="flex items-center gap-2 text-maroon-700 font-semibold">
          <CreditCard className="w-5 h-5" /> {t("ef.title")}
        </div>
        <button onClick={onBack} className="ml-auto text-sm text-slate-500 hover:text-maroon-600">
          {t("ef.cancel")}
        </button>
      </div>

      {/* Check if user has Russian bank info - show message if not */}
      {(() => {
        const hasRubBank = savedBankRub && savedBankRub.trim() && savedBankRub !== ",,,";
        if (!hasRubBank) {
          return (
            <div className="flex flex-col items-center gap-4 py-6">
              <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center">
                <CreditCard className="w-8 h-8 text-amber-600" />
              </div>
              <div className="text-center">
                <div className="text-lg font-semibold text-amber-700 mb-2">
                  {t("ef.rub_bank_required_title")}
                </div>
                <div className="text-sm text-slate-600 mb-4">
                  {t("ef.rub_bank_required_desc")}
                </div>
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-left">
                  <div className="text-sm text-amber-800 font-medium mb-2">{t("ef.rub_bank_instructions")}</div>
                  <ol className="text-sm text-amber-700 list-decimal list-inside space-y-1">
                    <li>{t("ef.rub_bank_step1")}</li>
                    <li>{t("ef.rub_bank_step2")}</li>
                    <li>{t("ef.rub_bank_step3")}</li>
                  </ol>
                </div>
              </div>
              <button
                onClick={onBack}
                className="mt-2 px-6 py-3 bg-maroon-600 text-white rounded-xl font-semibold hover:bg-maroon-700 transition"
              >
                {t("ef.understood")}
              </button>
            </div>
          );
        }
        return null;
      })()}

      {/* Step 0: Direction Selection - only show if user has Russian bank info */}
      {step === 0 && savedBankRub && savedBankRub.trim() && savedBankRub !== ",,," && (
        <div className="flex flex-col gap-4">
          <div className="text-center text-slate-600 mb-2">{t("ef.select_direction")}</div>
          <button
            onClick={() => handleSelectDirection("buy")}
            className="p-4 rounded-xl border-2 border-maroon-200 hover:border-maroon-500 hover:bg-maroon-50 transition flex items-center justify-between"
          >
            <div className="text-left">
              <div className="font-semibold text-maroon-700 flex items-center gap-2">
                {t("ef.get_mnt")}
              </div>
              <div className="text-sm text-slate-500">{t("ef.send_rub_get_mnt")}</div>
            </div>
            <div className="text-right">
              <div className="text-xs text-slate-400">{t("stats.rate")}</div>
              <div className="font-bold text-maroon-600">{buyRate}</div>
            </div>
          </button>
          {/* Check if user has RUB bank info - disable sell button if not */}
          {(() => {
            const hasRubBank = savedBankRub && savedBankRub.trim() && savedBankRub !== ",,,";
            return hasRubBank ? (
              <button
                onClick={() => handleSelectDirection("sell")}
                className="p-4 rounded-xl border-2 border-maroon-200 hover:border-maroon-500 hover:bg-maroon-50 transition flex items-center justify-between"
              >
                <div className="text-left">
                  <div className="font-semibold text-maroon-700 flex items-center gap-2">
                    {t("ef.get_rub")}
                  </div>
                  <div className="text-sm text-slate-500">{t("ef.send_mnt_get_rub")}</div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-slate-400">{t("stats.rate")}</div>
                  <div className="font-bold text-maroon-600">{sellRate}</div>
                </div>
              </button>
            ) : (
              <div className="p-4 rounded-xl border-2 border-slate-200 bg-slate-50 flex items-center justify-between opacity-70">
                <div className="text-left">
                  <div className="font-semibold text-slate-500 flex items-center gap-2">
                    {t("ef.get_rub")} ❌
                  </div>
                  <div className="text-sm text-red-500">
                    {t("ef.no_rub_bank")}
                  </div>
                  <div className="text-xs text-slate-400 mt-1">
                    {t("ef.no_rub_bank_desc")}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-slate-400">{t("stats.rate")}</div>
                  <div className="font-bold text-slate-400">{sellRate}</div>
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* Step 1: Promo Code */}
      {step === 1 && direction && (
        <div className="flex flex-col gap-4">
          <div className="text-sm text-slate-600 flex items-center gap-2">
            <Tag className="w-4 h-4" /> {t("ef.promo_step")}
          </div>
          
          <div className="flex items-center gap-2 p-2 bg-maroon-50 rounded-lg text-sm">
            <ArrowRightLeft className="w-4 h-4 text-maroon-600" />
            <span>{currencyFrom} → {currencyTo}</span>
            <span className="ml-auto font-semibold">{t("ef.base_rate", { rate: String(baseRate) })}</span>
          </div>

          {/* User's available promo codes */}
          {userPromoCodes.length > 0 && (
            <div className="p-3 bg-gradient-to-r from-purple-50 to-pink-50 border border-purple-200 rounded-xl">
              <div className="text-sm font-medium text-purple-700 mb-2 flex items-center gap-2">
                <Gift className="w-4 h-4" /> {t("txn.your_promos")}
              </div>
              <div className="flex flex-wrap gap-2">
                {userPromoCodes.map((promo) => (
                  <button
                    key={promo.code}
                    onClick={() => {
                      setPromoCode(promo.code);
                      setPromoError("");
                    }}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${
                      promoCode === promo.code
                        ? "bg-purple-600 text-white"
                        : "bg-white text-purple-700 border border-purple-200 hover:bg-purple-100"
                    }`}
                  >
                    {promo.code} ({promo.discount > 0 ? `+${promo.discount}` : promo.discount})
                  </button>
                ))}
              </div>
            </div>
          )}

          <input
            value={promoCode}
            onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
            className="rounded-xl border border-maroon-100 p-3 text-lg uppercase"
            placeholder={t("txn.promo_placeholder")}
          />
          
          {promoError && (
            <div className="text-red-600 text-sm">{promoError}</div>
          )}
          
          {promoValid && promoDiscount > 0 && (
            <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-xl text-green-700">
              <Gift className="w-5 h-5" />
              <span>{promoMessage || (direction === "buy" ? t("txn.promo_buy_applied", { amount: String(promoDiscount) }) : t("txn.promo_sell_applied", { amount: String(promoDiscount) }))}</span>
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={handleSkipPromo}
              className="flex-1 py-3 rounded-xl bg-slate-100 text-slate-700 font-semibold hover:bg-slate-200"
            >
              {t("txn.skip")}
            </button>
            <button
              onClick={handleValidatePromo}
              disabled={promoValidating}
              className="flex-1 py-3 rounded-xl bg-maroon-600 text-white font-semibold hover:bg-maroon-700 disabled:opacity-50"
            >
              {promoValidating ? t("txn.validating") : t("txn.activate_proceed")}
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Amount */}
      {step === 2 && direction && (
        <div className="flex flex-col gap-3">
          <div className="text-sm text-slate-600">{t("ef.amount_step")}</div>
          <div className="flex items-center gap-2 p-2 bg-maroon-50 rounded-lg text-sm">
            <ArrowRightLeft className="w-4 h-4 text-maroon-600" />
            <span>{currencyFrom} → {currencyTo}</span>
            <span className="ml-auto font-semibold">
              {t("stats.rate")}: {effectiveRate.toFixed(2)}
              {(promoDiscount > 0 || (!promoDiscount && hasVolumeDiscount)) && (
                <span className="text-green-600 ml-1">
                  ({direction === "buy" ? "+" : "-"}{(promoDiscount || (hasVolumeDiscount ? VOLUME_DISCOUNT : 0)).toFixed(1)})
                </span>
              )}
            </span>
          </div>
          
          <label className="text-xs text-slate-500">{t("ef.amount_label", { currency: currencyFrom })}</label>
          <input
            type="number"
            min={0}
            value={amount || ""}
            onChange={(e) => setAmount(Number(e.target.value || 0))}
            className="rounded-xl border border-maroon-100 p-3 text-lg"
            placeholder="0"
          />
          
          {amount > 0 && (
            <div className="text-sm text-slate-600">
              {t("ef.receive_label")} <span className="font-bold text-maroon-700">
                {convertedAmount.toLocaleString(undefined, { maximumFractionDigits: 2 })} {currencyTo}
              </span>
            </div>
          )}

          {/* Volume discount banner */}
          {hasVolumeDiscount && !promoDiscount && (
            <div className="flex items-center gap-2 p-2 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700">
              <span>🎉</span>
              <span>
                {direction === "buy" 
                  ? `100K+ ₽ — курс +${VOLUME_DISCOUNT} (${effectiveRate.toFixed(1)})`
                  : `100K+ ₽ — курс -${VOLUME_DISCOUNT} (${effectiveRate.toFixed(1)})`
                }
              </span>
            </div>
          )}
          
          {/* Minimum RUB warning for MNT->RUB direction */}
          {direction === "sell" && convertedAmount > 0 && convertedAmount < minRubAmount && (
            <div className="text-sm text-red-500 flex items-center gap-1">
              <span>⚠️</span>
              <span>MNT→RUB {t("txn.min_rub_warning", { amount: minRubAmount.toLocaleString() })}</span>
            </div>
          )}

          {/* Minimum RUB warning for RUB->MNT direction */}
          {direction === "buy" && amount > 0 && amount < minRubBuy && (
            <div className="text-sm text-red-500 flex items-center gap-1">
              <span>⚠️</span>
              <span>RUB→MNT {t("txn.min_rub_warning", { amount: minRubBuy.toLocaleString() })}</span>
            </div>
          )}
          
          <button
            className="mt-2 w-full rounded-xl bg-maroon-600 text-white py-3 font-semibold disabled:opacity-50"
            onClick={() => {
              // Generate invoice ID when moving to step 3
              if (!invoiceId) {
                setInvoiceId(generateInvoiceId());
              }
              setStep(3);
            }}
            disabled={
              amount <= 0 ||
              (direction === "sell" && convertedAmount < minRubAmount) ||
              (direction === "buy" && amount < minRubBuy)
            }
          >
            {t("txn.continue")}
          </button>
        </div>
      )}

      {/* Step 3: Select Admin Bank (where user sends money) */}
      {step === 3 && direction && (
        <div className="flex flex-col gap-3">
          <div className="text-sm text-slate-600">
            {t("ef.bank_step", { currency: currencyFrom })}
          </div>

          {/* For RUB->MNT: Show admin's RUB bank options */}
          {direction === "buy" && (
            <>
              {availableAdminBanks.length > 0 ? (
                <div className="flex flex-col gap-2">
                  <div className="text-xs text-slate-500">{t("txn.select_transfer_bank")}</div>
                  {availableAdminBanks.map((bank) => (
                    <button
                      key={bank.id}
                      onClick={() => setSelectedAdminBank(bank)}
                      className={`p-4 rounded-xl border-2 text-left transition relative overflow-hidden ${
                        selectedAdminBank?.id === bank.id
                          ? "border-maroon-500 bg-maroon-50"
                          : "border-maroon-100 hover:border-maroon-300"
                      }`}
                    >
                      {bank.logo_url && (
                        <div className="absolute inset-y-0 right-3 flex items-center pointer-events-none">
                          <img
                            src={bank.logo_url}
                            alt=""
                            className="h-10 w-10 object-contain opacity-90"
                            loading="lazy"
                          />
                        </div>
                      )}
                      <div className={`font-semibold text-maroon-700 ${bank.logo_url ? "pr-16" : ""}`}>{bank.bank_name}</div>
                      <div className="text-sm text-slate-600 font-mono">{bank.card_number || bank.account_number}</div>
                      {bank.phone && <div className="text-xs text-slate-500">{bank.phone}</div>}
                      <div className="text-xs text-slate-500">{bank.owner_name}</div>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-xl text-sm text-yellow-700">
                  {t("txn.no_active_bank")}
                </div>
              )}
            </>
          )}

          {/* For MNT->RUB: Show MNT admin bank accounts from DB */}
          {direction === "sell" && (
            <>
              {availableMntAdminBanks.length > 0 ? (
                <div className="flex flex-col gap-2">
                  <div className="text-xs text-slate-500">{t("txn.select_mnt_bank")}</div>
                  {availableMntAdminBanks.map((bank) => (
                    <button
                      key={bank.id}
                      onClick={() => setSelectedMntAdminBank(bank)}
                      className={`p-4 rounded-xl border-2 text-left transition relative overflow-hidden ${
                        selectedMntAdminBank?.id === bank.id
                          ? "border-maroon-500 bg-maroon-50"
                          : "border-maroon-100 hover:border-maroon-300"
                      }`}
                    >
                      {bank.logo_url && (
                        <div className="absolute inset-y-0 right-3 flex items-center pointer-events-none">
                          <img
                            src={bank.logo_url}
                            alt=""
                            className="h-10 w-10 object-contain opacity-90"
                            loading="lazy"
                          />
                        </div>
                      )}
                      <div className={`font-semibold text-maroon-700 ${bank.logo_url ? "pr-16" : ""}`}>{bank.bank_name}</div>
                      <div className="text-sm text-slate-600 font-mono">{bank.account_number}</div>
                      <div className="text-xs text-slate-500">{bank.owner_name}</div>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-xl text-sm text-yellow-700">
                  {t("txn.no_active_mnt_bank")}
                </div>
              )}

              {/* Show selected MNT bank details with copy buttons */}
              {selectedMntAdminBank && (
                <div className="p-4 bg-maroon-50 border border-maroon-200 rounded-xl space-y-2">
                  <div className="text-xs text-slate-500">{t("txn.transfer_info")}</div>
                  
                  <div className="flex items-center justify-between p-2 bg-white rounded-lg">
                    <div>
                      <div className="text-xs text-slate-500">{t("txn.account")}</div>
                      <div className="font-mono font-bold text-maroon-700">{selectedMntAdminBank.account_number}</div>
                    </div>
                    <button
                      onClick={() => handleCopy(selectedMntAdminBank.account_number, "mnt-account")}
                      className="p-2 bg-maroon-100 hover:bg-maroon-200 rounded-lg transition"
                    >
                      {copied === "mnt-account" ? <CheckCircle2 className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4 text-maroon-600" />}
                    </button>
                  </div>
                  
                  <div className="text-sm text-slate-600">{selectedMntAdminBank.owner_name}</div>
                  
                  {/* Invoice ID - must include in transaction message */}
                  <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                    <div className="text-xs text-amber-700 font-medium mb-1">{t("txn.invoice_warning_mnt")}</div>
                    <div className="flex items-center justify-between">
                      <div className="font-mono font-bold text-amber-800 text-lg">{invoiceId}</div>
                      <button
                        onClick={() => handleCopy(invoiceId, "invoice")}
                        className="p-2 bg-amber-100 hover:bg-amber-200 rounded-lg transition"
                      >
                        {copied === "invoice" ? <CheckCircle2 className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4 text-amber-600" />}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          {/* Selected bank details with copy buttons (for buy direction) */}
          {direction === "buy" && selectedAdminBank && (
            <div className="p-4 bg-maroon-50 border border-maroon-200 rounded-xl space-y-2">
              <div className="text-xs text-slate-500">{t("txn.transfer_info")}</div>
              
              {selectedAdminBank.card_number && (
                <div className="flex items-center justify-between p-2 bg-white rounded-lg">
                  <div>
                    <div className="text-xs text-slate-500">{t("txn.card_number")}</div>
                    <div className="font-mono font-bold text-maroon-700">{selectedAdminBank.card_number}</div>
                  </div>
                  <button
                    onClick={() => handleCopy(selectedAdminBank.card_number!, "card")}
                    className="p-2 bg-maroon-100 hover:bg-maroon-200 rounded-lg transition"
                  >
                    {copied === "card" ? <CheckCircle2 className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4 text-maroon-600" />}
                  </button>
                </div>
              )}
              
              {selectedAdminBank.phone && (
                <div className="flex items-center justify-between p-2 bg-white rounded-lg">
                  <div>
                    <div className="text-xs text-slate-500">{t("txn.phone_sbp")}</div>
                    <div className="font-mono font-bold text-maroon-700">{selectedAdminBank.phone}</div>
                  </div>
                  <button
                    onClick={() => handleCopy(selectedAdminBank.phone!, "phone")}
                    className="p-2 bg-maroon-100 hover:bg-maroon-200 rounded-lg transition"
                  >
                    {copied === "phone" ? <CheckCircle2 className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4 text-maroon-600" />}
                  </button>
                </div>
              )}
              
              <div className="text-sm text-slate-600">{selectedAdminBank.owner_name}</div>
              
              {/* Invoice ID - must include in transaction message */}
              <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                <div className="text-xs text-amber-700 font-medium mb-1">{t("txn.invoice_warning")}</div>
                <div className="flex items-center justify-between">
                  <div className="font-mono font-bold text-amber-800 text-lg">{invoiceId}</div>
                  <button
                    onClick={() => handleCopy(invoiceId, "invoice")}
                    className="p-2 bg-amber-100 hover:bg-amber-200 rounded-lg transition"
                  >
                    {copied === "invoice" ? <CheckCircle2 className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4 text-amber-600" />}
                  </button>
                </div>
              </div>
            </div>
          )}

          <button
            className="mt-2 w-full rounded-xl bg-maroon-600 text-white py-3 font-semibold disabled:opacity-50"
            onClick={() => setStep(4)}
            disabled={direction === "buy" && !selectedAdminBank}
          >
            {t("txn.continue")}
          </button>
        </div>
      )}

      {/* Step 4: Upload Receipt */}
      {step === 4 && direction && (
        <div className="flex flex-col gap-3">
          <div className="text-sm text-slate-600">{t("ef.receipt_step")}</div>
          
          {/* Summary */}
          <div className="p-3 bg-maroon-50 rounded-xl text-sm">
            <div className="flex justify-between">
              <span>{t("txn.send_amount")}</span>
              <span className="font-bold">{amount.toLocaleString()} {currencyFrom}</span>
            </div>
            <div className="flex justify-between">
              <span>{t("txn.receive_amount")}</span>
              <span className="font-bold">{convertedAmount.toLocaleString(undefined, { maximumFractionDigits: 2 })} {currencyTo}</span>
            </div>
          </div>

          {/* Uploaded receipts preview */}
          {receiptUrls.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {receiptUrls.map((url, index) => (
                <div key={index} className="relative">
                  <img src={url} alt={`Receipt ${index + 1}`} className="w-20 h-20 object-cover rounded-lg border border-maroon-200" />
                  <button
                    onClick={() => removeReceipt(index)}
                    className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 text-white rounded-full text-xs flex items-center justify-center hover:bg-red-600"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          <label className="flex flex-col items-center justify-center border-2 border-dashed border-maroon-200 rounded-xl py-8 cursor-pointer bg-white/60 hover:bg-maroon-50 transition">
            {receiptUrls.length > 0 ? (
              <div className="flex flex-col items-center gap-2 text-green-600">
                <CheckCircle2 className="w-6 h-6" />
                <span className="font-medium">{t("txn.photos_attached", { count: String(receiptUrls.length) })}</span>
                <span className="text-xs text-slate-500">{t("txn.add_more_photos")}</span>
              </div>
            ) : (
              <>
                <Upload className="w-8 h-8 text-maroon-600" />
                <span className="text-sm text-slate-500 mt-2">
                  {uploading ? t("txn.uploading") : t("txn.upload_screenshot")}
                </span>
                <span className="text-xs text-slate-400 mt-1">{t("txn.multiple_photos")}</span>
              </>
            )}
            <input
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                const files = e.target.files;
                if (files && files.length > 0) handleMultipleUpload(files);
              }}
              disabled={uploading}
            />
          </label>
          
          {error && <div className="text-red-600 text-sm">{error}</div>}
          
          <button
            className="mt-2 w-full rounded-xl bg-maroon-600 text-white py-3 font-semibold disabled:opacity-50"
            onClick={() => {
              const saved = getSavedBankForDirection(direction);
              if (saved) {
                // Show saved bank choice
                setUseSavedBank(null);
              } else {
                initEmptyBankFields(direction);
                setUseSavedBank(false);
              }
              setStep(5);
            }}
            disabled={receiptUrls.length === 0}
          >
            {t("txn.continue")}
          </button>
        </div>
      )}

      {/* Step 5: User's Receiving Bank */}
      {step === 5 && direction && (
        <div className="flex flex-col gap-3">
          <div className="text-sm text-slate-600">
            {t("ef.bank_step_receive", { currency: currencyTo })}
          </div>

          {/* Ask about saved bank if available and not yet chosen */}
          {useSavedBank === null && getSavedBankForDirection(direction) && (
            <div className="flex flex-col gap-3">
              <div className="p-4 bg-maroon-50 rounded-xl border border-maroon-200">
                <div className="text-xs text-slate-500 mb-2">{t("txn.saved_bank", { currency: currencyTo })}</div>
                <div className="text-sm font-medium text-maroon-700 whitespace-pre-wrap">
                  {getSavedBankForDirection(direction)}
                </div>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => handleUseSaved(true)}
                  className="flex-1 py-3 rounded-xl bg-green-600 text-white font-semibold hover:bg-green-700 transition flex items-center justify-center gap-2"
                >
                  <CheckCircle2 className="w-5 h-5" /> {t("txn.use_saved")}
                </button>
                <button
                  onClick={() => handleUseSaved(false)}
                  className="flex-1 py-3 rounded-xl bg-slate-100 text-slate-700 font-semibold hover:bg-slate-200 transition flex items-center justify-center gap-2"
                >
                  <Edit3 className="w-5 h-5" /> {t("txn.enter_new")}
                </button>
              </div>
            </div>
          )}

          {/* Show form if saved bank choice made or no saved bank */}
          {(useSavedBank !== null || !getSavedBankForDirection(direction)) && (
            <>
              {useSavedBank && (
                <div className="p-2 bg-green-50 border border-green-200 rounded-lg text-xs text-green-700">
                  {t("ef.saved_bank_sent")}
                </div>
              )}

              {/* RUB receiving form (MNT → RUB / sell) */}
              {direction === "sell" && (
                <>
                  <label className="text-xs text-slate-500">{t("txn.select_bank")}</label>
                  <input
                    value={rubBank}
                    onChange={(e) => setRubBank(e.target.value)}
                    className="rounded-xl border border-maroon-100 p-3"
                    placeholder="Tinkoff, Sber, Alfa..."
                  />

                  <label className="text-xs text-slate-500">{t("txn.card_number")}</label>
                  <input
                    value={rubCardNumber}
                    onChange={(e) => setRubCardNumber(formatCardNumber(e.target.value))}
                    className="rounded-xl border border-maroon-100 p-3"
                    placeholder="XXXX XXXX XXXX XXXX"
                    maxLength={19}
                  />

                  <label className="text-xs text-slate-500">{t("txn.phone_sbp")}</label>
                  <input
                    value={rubPhone}
                    onChange={(e) => setRubPhone(formatRussianPhone(e.target.value))}
                    className="rounded-xl border border-maroon-100 p-3"
                    placeholder="+7 XXX XXX XX XX"
                  />

                  <label className="text-xs text-slate-500">{t("txn.owner_name")}</label>
                  <input
                    value={rubOwnerName}
                    onChange={(e) => setRubOwnerName(e.target.value)}
                    className="rounded-xl border border-maroon-100 p-3"
                    placeholder={t("ef.placeholder_rub_owner")}
                  />
                </>
              )}

              {/* MNT receiving form (RUB → MNT / buy) */}
              {direction === "buy" && (
                <>
                  <label className="text-xs text-slate-500">{t("txn.select_bank")}</label>
                  <input
                    value={mntBank}
                    onChange={(e) => setMntBank(e.target.value)}
                    className="rounded-xl border border-maroon-100 p-3"
                    placeholder={t("ef.placeholder_mnt_bank")}
                  />

                  <label className="text-xs text-slate-500">{t("txn.account")}</label>
                  <input
                    value={mntIban}
                    onChange={(e) => setMntIban(formatIBAN(e.target.value))}
                    className="rounded-xl border border-maroon-100 p-3"
                    placeholder="MN XX XXXX XX XXXXXXXXXX"
                  />

                  <label className="text-xs text-slate-500">{t("txn.owner_name")}</label>
                  <input
                    value={mntOwnerName}
                    onChange={(e) => setMntOwnerName(e.target.value)}
                    className="rounded-xl border border-maroon-100 p-3"
                    placeholder={t("ef.placeholder_mnt_owner")}
                  />
                </>
              )}

              <button
                className="mt-2 w-full rounded-xl bg-green-600 text-white py-3 font-semibold disabled:opacity-50"
                onClick={() => handleSubmit()}
                disabled={!isBankValid() || loading}
              >
                {loading ? t("txn.submitting") : t("txn.submit_exchange")}
              </button>
              
              {error && <div className="text-red-600 text-sm">{error}</div>}
            </>
          )}
        </div>
      )}

      {/* Step 6: Success */}
      {step === 6 && (
        <div className="flex flex-col items-center gap-4 py-6">
          <CheckCircle2 className="w-16 h-16 text-green-500" />
          <div className="text-xl font-bold text-maroon-700">{t("txn.success_title")}</div>
          <div className="text-sm text-slate-600 text-center">
            Invoice: <span className="font-mono font-bold">{successInvoice}</span>
          </div>
          <div className="text-sm text-slate-500 text-center">
            {t("txn.success_desc")}
          </div>
          <button
            onClick={onBack}
            className="mt-4 px-6 py-2 bg-maroon-100 text-maroon-700 rounded-xl font-semibold hover:bg-maroon-200 transition"
          >
            {t("txn.back_home")}
          </button>
        </div>
      )}
    </div>
  );
}
