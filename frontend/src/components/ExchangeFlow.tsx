import { useState, useMemo, useEffect } from "react";
import { ArrowLeft, ArrowRightLeft, CheckCircle2, Copy, CreditCard, Upload, Edit3, Tag, Gift } from "lucide-react";
import { createExchange, ExchangeCreateInput, requestPresign, fetchAdminBankAccounts, validatePromoCode, AdminBankAccount, fetchUserPromoCodes, UserPromoCode } from "../api";

interface Props {
  initData: string;
  buyRate: number;
  sellRate: number;
  savedBankRub?: string;
  savedBankMnt?: string;
  onBack: () => void;
}

const RUB_BANKS = ["Tinkoff", "Sber", "Alfa", "VTB", "Raiffeisen", "Другой"];
const MNT_BANKS = ["Хаан банк", "Голомт банк", "Хас банк", "Төрийн банк", "Худалдаа хөгжлийн банк", "Бусад"];

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

  const effectiveRate = useMemo((): number => {
    const base = Number(baseRate) || 0;
    if (!base) return 0;
    const discount = Number(promoDiscount) || 0;
    console.log("effectiveRate calc - base:", base, "discount:", discount, "direction:", direction);
    if (discount > 0) {
      // Adjust rate by discount amount:
      // BUY (RUB→MNT): add to rate (user gets more MNT per RUB)
      // SELL (MNT→RUB): subtract from rate (user pays less MNT per RUB)
      const result = direction === "buy" 
        ? base + discount 
        : base - discount;
      // Round to 1 decimal place to avoid floating point precision issues (e.g., 46.199999999996 -> 46.2)
      const roundedResult = Math.round(result * 10) / 10;
      console.log("effectiveRate result:", roundedResult);
      return roundedResult;
    }
    return base;
  }, [baseRate, promoDiscount, direction]);

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
        setPromoError(res.message || "Промо код олдсонгүй");
        setPromoDiscount(0);
        setPromoValid(false);
        // Stay on current step - don't proceed
      }
    } catch (err) {
      console.error("Promo validation error:", err);
      setPromoError("Промо код шалгахад алдаа гарлаа");
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
        setError("Хуулж чадсангүй");
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
      setError("Файл байршуулахад алдаа. Дахин оролдоно уу.");
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
        admin_bank_id: selectedAdminBank?.id,
        invoice: invoiceId, // Pass the pre-generated invoice ID
      };
      console.log("Creating exchange with payload:", payload);
      const res = await createExchange(payload);
      console.log("Exchange created:", res);
      setSuccessInvoice(res.invoice);
      setStep(6);
    } catch (err) {
      console.error("Exchange creation error:", err);
      setError("Арилжаа үүсгэхэд алдаа гарлаа. Дахин оролдоно уу.");
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
          <button onClick={handleBack} className="p-2 hover:bg-ocean-100 rounded-full">
            <ArrowLeft className="w-5 h-5 text-ocean-600" />
          </button>
        )}
        <div className="flex items-center gap-2 text-ocean-700 font-semibold">
          <CreditCard className="w-5 h-5" /> ВАЛЮТ СОЛИХ
        </div>
        <button onClick={onBack} className="ml-auto text-sm text-slate-500 hover:text-ocean-600">
          Цуцлах
        </button>
      </div>

      {/* Step 0: Direction Selection */}
      {step === 0 && (
        <div className="flex flex-col gap-4">
          <div className="text-center text-slate-600 mb-2">Валют солих чиглэлээ сонгоно уу</div>
          <button
            onClick={() => handleSelectDirection("buy")}
            className="p-4 rounded-xl border-2 border-ocean-200 hover:border-ocean-500 hover:bg-ocean-50 transition flex items-center justify-between"
          >
            <div className="text-left">
              <div className="font-semibold text-ocean-700 flex items-center gap-2">
                Төгрөг авах (RUB → MNT)
              </div>
              <div className="text-sm text-slate-500">RUB илгээж, MNT авна</div>
            </div>
            <div className="text-right">
              <div className="text-xs text-slate-400">Ханш</div>
              <div className="font-bold text-ocean-600">{buyRate}</div>
            </div>
          </button>
          <button
            onClick={() => handleSelectDirection("sell")}
            className="p-4 rounded-xl border-2 border-ocean-200 hover:border-ocean-500 hover:bg-ocean-50 transition flex items-center justify-between"
          >
            <div className="text-left">
              <div className="font-semibold text-ocean-700 flex items-center gap-2">
                Рубль авах (MNT → RUB)
              </div>
              <div className="text-sm text-slate-500">MNT илгээж, RUB авна</div>
            </div>
            <div className="text-right">
              <div className="text-xs text-slate-400">Ханш</div>
              <div className="font-bold text-ocean-600">{sellRate}</div>
            </div>
          </button>
        </div>
      )}

      {/* Step 1: Promo Code */}
      {step === 1 && direction && (
        <div className="flex flex-col gap-4">
          <div className="text-sm text-slate-600 flex items-center gap-2">
            <Tag className="w-4 h-4" /> 1-р алхам — Промо код (заавал биш)
          </div>
          
          <div className="flex items-center gap-2 p-2 bg-ocean-50 rounded-lg text-sm">
            <ArrowRightLeft className="w-4 h-4 text-ocean-600" />
            <span>{currencyFrom} → {currencyTo}</span>
            <span className="ml-auto font-semibold">Суурь ханш: {baseRate}</span>
          </div>

          {/* User's available promo codes */}
          {userPromoCodes.length > 0 && (
            <div className="p-3 bg-gradient-to-r from-purple-50 to-pink-50 border border-purple-200 rounded-xl">
              <div className="text-sm font-medium text-purple-700 mb-2 flex items-center gap-2">
                <Gift className="w-4 h-4" /> Таны промо кодууд:
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
            className="rounded-xl border border-ocean-100 p-3 text-lg uppercase"
            placeholder="Промо код оруулна уу"
          />
          
          {promoError && (
            <div className="text-red-600 text-sm">{promoError}</div>
          )}
          
          {promoValid && promoDiscount > 0 && (
            <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-xl text-green-700">
              <Gift className="w-5 h-5" />
              <span>{promoMessage || (direction === "buy" ? `+${promoDiscount} ₮ таны худалдан авах ханшинд нэмэгдлээ!` : `-${promoDiscount} ₮ ханшнаас хасагдлаа!`)}</span>
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={handleSkipPromo}
              className="flex-1 py-3 rounded-xl bg-slate-100 text-slate-700 font-semibold hover:bg-slate-200"
            >
              Алгасах
            </button>
            <button
              onClick={handleValidatePromo}
              disabled={promoValidating}
              className="flex-1 py-3 rounded-xl bg-ocean-600 text-white font-semibold hover:bg-ocean-700 disabled:opacity-50"
            >
              {promoValidating ? "Шалгаж байна..." : "Идэвхжүүлээд үргэлжлэх"}
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Amount */}
      {step === 2 && direction && (
        <div className="flex flex-col gap-3">
          <div className="text-sm text-slate-600">2-р алхам — Солих мөнгөн дүн оруулах</div>
          <div className="flex items-center gap-2 p-2 bg-ocean-50 rounded-lg text-sm">
            <ArrowRightLeft className="w-4 h-4 text-ocean-600" />
            <span>{currencyFrom} → {currencyTo}</span>
            <span className="ml-auto font-semibold">
              Ханш: {effectiveRate.toFixed(2)}
              {promoDiscount > 0 && (
                <span className="text-green-600 ml-1">
                  ({direction === "buy" ? "+" : "-"}{promoDiscount})
                </span>
              )}
            </span>
          </div>
          
          <label className="text-xs text-slate-500">Таны илгээх мөнгөн дүн ({currencyFrom})</label>
          <input
            type="number"
            min={0}
            value={amount || ""}
            onChange={(e) => setAmount(Number(e.target.value || 0))}
            className="rounded-xl border border-ocean-100 p-3 text-lg"
            placeholder="0"
          />
          
          {amount > 0 && (
            <div className="text-sm text-slate-600">
              Таны хүлээн авах мөнгөн дүн: <span className="font-bold text-ocean-700">
                {convertedAmount.toLocaleString(undefined, { maximumFractionDigits: 2 })} {currencyTo}
              </span>
            </div>
          )}
          
          <button
            className="mt-2 w-full rounded-xl bg-ocean-600 text-white py-3 font-semibold disabled:opacity-50"
            onClick={() => {
              // Generate invoice ID when moving to step 3
              if (!invoiceId) {
                setInvoiceId(generateInvoiceId());
              }
              setStep(3);
            }}
            disabled={amount <= 0}
          >
            Үргэлжлүүлэх
          </button>
        </div>
      )}

      {/* Step 3: Select Admin Bank (where user sends money) */}
      {step === 3 && direction && (
        <div className="flex flex-col gap-3">
          <div className="text-sm text-slate-600">
            3-р алхам — та {currencyFrom}-г манай данс руу илгээнэ үү
          </div>

          {/* For RUB->MNT: Show admin's RUB bank options */}
          {direction === "buy" && (
            <>
              {availableAdminBanks.length > 0 ? (
                <div className="flex flex-col gap-2">
                  <div className="text-xs text-slate-500">Шилжүүлэх банк сонгоно уу:</div>
                  {availableAdminBanks.map((bank) => (
                    <button
                      key={bank.id}
                      onClick={() => setSelectedAdminBank(bank)}
                      className={`p-4 rounded-xl border-2 text-left transition ${
                        selectedAdminBank?.id === bank.id
                          ? "border-ocean-500 bg-ocean-50"
                          : "border-ocean-100 hover:border-ocean-300"
                      }`}
                    >
                      <div className="font-semibold text-ocean-700">{bank.bank_name}</div>
                      <div className="text-sm text-slate-600 font-mono">{bank.card_number || bank.account_number}</div>
                      {bank.phone && <div className="text-xs text-slate-500">{bank.phone}</div>}
                      <div className="text-xs text-slate-500">{bank.owner_name}</div>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-xl text-sm text-yellow-700">
                  Идэвхтэй банкны данс байхгүй байна. Support хаягтай холбогдоно уу.
                </div>
              )}
            </>
          )}

          {/* For MNT->RUB: Show MNT admin bank accounts from DB */}
          {direction === "sell" && (
            <>
              {availableMntAdminBanks.length > 0 ? (
                <div className="flex flex-col gap-2">
                  <div className="text-xs text-slate-500">MNT шилжүүлэх банк сонгоно уу:</div>
                  {availableMntAdminBanks.map((bank) => (
                    <button
                      key={bank.id}
                      onClick={() => setSelectedMntAdminBank(bank)}
                      className={`p-4 rounded-xl border-2 text-left transition ${
                        selectedMntAdminBank?.id === bank.id
                          ? "border-ocean-500 bg-ocean-50"
                          : "border-ocean-100 hover:border-ocean-300"
                      }`}
                    >
                      <div className="font-semibold text-ocean-700">{bank.bank_name}</div>
                      <div className="text-sm text-slate-600 font-mono">{bank.account_number}</div>
                      <div className="text-xs text-slate-500">{bank.owner_name}</div>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-xl text-sm text-yellow-700">
                  Идэвхтэй MNT банкны данс байхгүй байна. Support хаягтай холбогдоно уу.
                </div>
              )}

              {/* Show selected MNT bank details with copy buttons */}
              {selectedMntAdminBank && (
                <div className="p-4 bg-ocean-50 border border-ocean-200 rounded-xl space-y-2">
                  <div className="text-xs text-slate-500">Шилжүүлгийн мэдээлэл:</div>
                  
                  <div className="flex items-center justify-between p-2 bg-white rounded-lg">
                    <div>
                      <div className="text-xs text-slate-500">Данс</div>
                      <div className="font-mono font-bold text-ocean-700">{selectedMntAdminBank.account_number}</div>
                    </div>
                    <button
                      onClick={() => handleCopy(selectedMntAdminBank.account_number, "mnt-account")}
                      className="p-2 bg-ocean-100 hover:bg-ocean-200 rounded-lg transition"
                    >
                      {copied === "mnt-account" ? <CheckCircle2 className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4 text-ocean-600" />}
                    </button>
                  </div>
                  
                  <div className="text-sm text-slate-600">{selectedMntAdminBank.owner_name}</div>
                  
                  {/* Invoice ID - must include in transaction message */}
                  <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                    <div className="text-xs text-amber-700 font-medium mb-1">⚠️ Гүйлгээний утга хэсэгт Invoice ID-г заавал бичнэ үү:</div>
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
            <div className="p-4 bg-ocean-50 border border-ocean-200 rounded-xl space-y-2">
              <div className="text-xs text-slate-500">Шилжүүлгийн мэдээлэл:</div>
              
              {selectedAdminBank.card_number && (
                <div className="flex items-center justify-between p-2 bg-white rounded-lg">
                  <div>
                    <div className="text-xs text-slate-500">Картын дугаар</div>
                    <div className="font-mono font-bold text-ocean-700">{selectedAdminBank.card_number}</div>
                  </div>
                  <button
                    onClick={() => handleCopy(selectedAdminBank.card_number!, "card")}
                    className="p-2 bg-ocean-100 hover:bg-ocean-200 rounded-lg transition"
                  >
                    {copied === "card" ? <CheckCircle2 className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4 text-ocean-600" />}
                  </button>
                </div>
              )}
              
              {selectedAdminBank.phone && (
                <div className="flex items-center justify-between p-2 bg-white rounded-lg">
                  <div>
                    <div className="text-xs text-slate-500">Утасны дугаар (СБП)</div>
                    <div className="font-mono font-bold text-ocean-700">{selectedAdminBank.phone}</div>
                  </div>
                  <button
                    onClick={() => handleCopy(selectedAdminBank.phone!, "phone")}
                    className="p-2 bg-ocean-100 hover:bg-ocean-200 rounded-lg transition"
                  >
                    {copied === "phone" ? <CheckCircle2 className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4 text-ocean-600" />}
                  </button>
                </div>
              )}
              
              <div className="text-sm text-slate-600">{selectedAdminBank.owner_name}</div>
              
              {/* Invoice ID - must include in transaction message */}
              <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                <div className="text-xs text-amber-700 font-medium mb-1">⚠️ Гүйлгээний утга хэсэгт заавал бичнэ үү:</div>
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
            className="mt-2 w-full rounded-xl bg-ocean-600 text-white py-3 font-semibold disabled:opacity-50"
            onClick={() => setStep(4)}
            disabled={direction === "buy" && !selectedAdminBank}
          >
            Үргэлжлүүлэх
          </button>
        </div>
      )}

      {/* Step 4: Upload Receipt */}
      {step === 4 && direction && (
        <div className="flex flex-col gap-3">
          <div className="text-sm text-slate-600">4-р алхам — Төлбөрийн баримт оруулах (олон зураг хавсаргах боломжтой)</div>
          
          {/* Summary */}
          <div className="p-3 bg-ocean-50 rounded-xl text-sm">
            <div className="flex justify-between">
              <span>Таны илгээх мөнгөн дүн:</span>
              <span className="font-bold">{amount.toLocaleString()} {currencyFrom}</span>
            </div>
            <div className="flex justify-between">
              <span>Таны хүлээн авах мөнгөн дүн:</span>
              <span className="font-bold">{convertedAmount.toLocaleString(undefined, { maximumFractionDigits: 2 })} {currencyTo}</span>
            </div>
          </div>

          {/* Uploaded receipts preview */}
          {receiptUrls.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {receiptUrls.map((url, index) => (
                <div key={index} className="relative">
                  <img src={url} alt={`Receipt ${index + 1}`} className="w-20 h-20 object-cover rounded-lg border border-ocean-200" />
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

          <label className="flex flex-col items-center justify-center border-2 border-dashed border-ocean-200 rounded-xl py-8 cursor-pointer bg-white/60 hover:bg-ocean-50 transition">
            {receiptUrls.length > 0 ? (
              <div className="flex flex-col items-center gap-2 text-green-600">
                <CheckCircle2 className="w-6 h-6" />
                <span className="font-medium">{receiptUrls.length} зураг хавсаргасан</span>
                <span className="text-xs text-slate-500">Нэмж зураг хавсаргахын тулд энд дарна уу</span>
              </div>
            ) : (
              <>
                <Upload className="w-8 h-8 text-ocean-600" />
                <span className="text-sm text-slate-500 mt-2">
                  {uploading ? "Хавсаргаж байна..." : "Төлбөрийн баримтын скриншот зураг оруулах"}
                </span>
                <span className="text-xs text-slate-400 mt-1">Олон зураг сонгож болно</span>
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
            className="mt-2 w-full rounded-xl bg-ocean-600 text-white py-3 font-semibold disabled:opacity-50"
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
            Үргэлжлүүлэх
          </button>
        </div>
      )}

      {/* Step 5: User's Receiving Bank */}
      {step === 5 && direction && (
        <div className="flex flex-col gap-3">
          <div className="text-sm text-slate-600">
            5-р алхам — Таны {currencyTo} хүлээн авах данс
          </div>

          {/* Ask about saved bank if available and not yet chosen */}
          {useSavedBank === null && getSavedBankForDirection(direction) && (
            <div className="flex flex-col gap-3">
              <div className="p-4 bg-ocean-50 rounded-xl border border-ocean-200">
                <div className="text-xs text-slate-500 mb-2">Хадгалсан {currencyTo} банкны мэдээлэл:</div>
                <div className="text-sm font-medium text-ocean-700 whitespace-pre-wrap">
                  {getSavedBankForDirection(direction)}
                </div>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => handleUseSaved(true)}
                  className="flex-1 py-3 rounded-xl bg-green-600 text-white font-semibold hover:bg-green-700 transition flex items-center justify-center gap-2"
                >
                  <CheckCircle2 className="w-5 h-5" /> Хадгалсан дансны мэдээллээ ашиглах
                </button>
                <button
                  onClick={() => handleUseSaved(false)}
                  className="flex-1 py-3 rounded-xl bg-slate-100 text-slate-700 font-semibold hover:bg-slate-200 transition flex items-center justify-center gap-2"
                >
                  <Edit3 className="w-5 h-5" /> Шинээр оруулах
                </button>
              </div>
            </div>
          )}

          {/* Show form if saved bank choice made or no saved bank */}
          {(useSavedBank !== null || !getSavedBankForDirection(direction)) && (
            <>
              {useSavedBank && (
                <div className="p-2 bg-green-50 border border-green-200 rounded-lg text-xs text-green-700">
                  ✓ Хадгалсан мэдээллийг явууллаа
                </div>
              )}

              {/* RUB receiving form (MNT → RUB / sell) */}
              {direction === "sell" && (
                <>
                  <label className="text-xs text-slate-500">Банк</label>
                  <input
                    value={rubBank}
                    onChange={(e) => setRubBank(e.target.value)}
                    className="rounded-xl border border-ocean-100 p-3"
                    placeholder="Tinkoff, Sber, Alfa..."
                  />

                  <label className="text-xs text-slate-500">Картын дугаар</label>
                  <input
                    value={rubCardNumber}
                    onChange={(e) => setRubCardNumber(e.target.value)}
                    className="rounded-xl border border-ocean-100 p-3"
                    placeholder="2200 1234 5678 9012"
                  />

                  <label className="text-xs text-slate-500">Утасны дугаар (СБП)</label>
                  <input
                    value={rubPhone}
                    onChange={(e) => setRubPhone(e.target.value)}
                    className="rounded-xl border border-ocean-100 p-3"
                    placeholder="+7 900 123 4567"
                  />

                  <label className="text-xs text-slate-500">Данс эзэмшигчийн нэр</label>
                  <input
                    value={rubOwnerName}
                    onChange={(e) => setRubOwnerName(e.target.value)}
                    className="rounded-xl border border-ocean-100 p-3"
                    placeholder="Иван Иванов"
                  />
                </>
              )}

              {/* MNT receiving form (RUB → MNT / buy) */}
              {direction === "buy" && (
                <>
                  <label className="text-xs text-slate-500">Банк</label>
                  <input
                    value={mntBank}
                    onChange={(e) => setMntBank(e.target.value)}
                    className="rounded-xl border border-ocean-100 p-3"
                    placeholder="Хаан банк, Голомт банк..."
                  />

                  <label className="text-xs text-slate-500">Дансны дугаар(IBAN)</label>
                  <input
                    value={mntIban}
                    onChange={(e) => setMntIban(e.target.value)}
                    className="rounded-xl border border-ocean-100 p-3"
                    placeholder="MN 00000 000 5001234567"
                  />

                  <label className="text-xs text-slate-500">Данс эзэмшигчийн нэр</label>
                  <input
                    value={mntOwnerName}
                    onChange={(e) => setMntOwnerName(e.target.value)}
                    className="rounded-xl border border-ocean-100 p-3"
                    placeholder="Бат-Эрдэнэ"
                  />
                </>
              )}

              <button
                className="mt-2 w-full rounded-xl bg-green-600 text-white py-3 font-semibold disabled:opacity-50"
                onClick={() => handleSubmit()}
                disabled={!isBankValid() || loading}
              >
                {loading ? "Боловсруулж байна..." : "Баталгаажуулах"}
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
          <div className="text-xl font-bold text-ocean-700">Хүсэлт илгээгдлээ!</div>
          <div className="text-sm text-slate-600 text-center">
            Invoice: <span className="font-mono font-bold">{successInvoice}</span>
          </div>
          <div className="text-sm text-slate-500 text-center">
            Админ таны төлбөрийг шалгаж дууссаны дараа танд Telegram чатаар мэдэгдэл ирэх болно.
          </div>
          <button
            onClick={onBack}
            className="mt-4 px-6 py-2 bg-ocean-100 text-ocean-700 rounded-xl font-semibold hover:bg-ocean-200 transition"
          >
            Дуусгах
          </button>
        </div>
      )}
    </div>
  );
}
