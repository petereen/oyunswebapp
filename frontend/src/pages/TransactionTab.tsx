import { useState, useMemo, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, Copy, Upload, Edit3, Tag, Gift, ArrowRightLeft, CreditCard, UserPlus } from "lucide-react";
import { ExchangeCard } from "../components/ExchangeCard";
import {
  fetchRates, fetchMe, createExchange, ExchangeCreateInput, requestPresign,
  fetchAdminBankAccounts, validatePromoCode, AdminBankAccount, fetchUserPromoCodes,
  UserPromoCode,
} from "../api";
import { formatRussianPhone, formatCardNumber, formatIBAN, RegistrationModal } from "../components/RegistrationModal";
import { TelegramUser } from "../hooks/useTelegramAuth";

interface Props {
  initData: string;
  user: TelegramUser | null;
  initialDirection?: "buy" | "sell" | null;
  onResetDirection: () => void;
}

const RUB_BANKS = ["Сбербанк", "Т-Банк", "Альфа-Банк", "ВТБ", "Райффайзен банк", "Газпромбанк", "ПСБ", "Россельхозбанк", "Бусад"];
const MNT_BANKS = ["Хаан банк", "Голомт банк", "М банк", "Хас банк", "Худалдаа хөгжлийн банк", "Ариг банк", "Богд банк", "Төрийн банк", "Капитрон банк", "Бусад"];

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

export function TransactionTab({ initData, user, initialDirection, onResetDirection }: Props) {
  const { data: rate } = useQuery({ queryKey: ["rates"], queryFn: fetchRates, retry: 2 });
  const { data: profile } = useQuery({
    queryKey: ["me", user?.id],
    queryFn: fetchMe,
    enabled: Boolean(user?.id),
    staleTime: 0,
  });

  const userProfile = profile?.user;
  const isVerified = userProfile?.verified === true;
  const savedBankRub = userProfile?.bank_rub;
  const savedBankMnt = userProfile?.bank_mnt;
  const hasRubBank = savedBankRub && savedBankRub.trim() && savedBankRub !== ",,,";

  // Flow states: "card" | "promo" | "adminBank" | "receipt" | "receivingBank" | "success"
  const [flowStep, setFlowStep] = useState<string>("card");
  const [direction, setDirection] = useState<"buy" | "sell" | null>(null);
  const [amount, setAmount] = useState(0);
  const [baseRate, setBaseRate] = useState(0);

  // Promo
  const [promoCode, setPromoCode] = useState("");
  const [promoDiscount, setPromoDiscount] = useState(0);
  const [promoValidating, setPromoValidating] = useState(false);
  const [promoError, setPromoError] = useState("");
  const [promoValid, setPromoValid] = useState(false);
  const [promoMessage, setPromoMessage] = useState("");
  const [userPromoCodes, setUserPromoCodes] = useState<UserPromoCode[]>([]);

  // Admin banks
  const [adminBanks, setAdminBanks] = useState<AdminBankAccount[]>([]);
  const [selectedAdminBank, setSelectedAdminBank] = useState<AdminBankAccount | null>(null);
  const [selectedMntAdminBank, setSelectedMntAdminBank] = useState<AdminBankAccount | null>(null);

  // Receipt
  const [receiptUrls, setReceiptUrls] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);

  // Receiving bank
  const [rubBank, setRubBank] = useState("");
  const [rubCardNumber, setRubCardNumber] = useState("");
  const [rubPhone, setRubPhone] = useState("");
  const [rubOwnerName, setRubOwnerName] = useState("");
  const [mntBank, setMntBank] = useState("");
  const [mntIban, setMntIban] = useState("");
  const [mntOwnerName, setMntOwnerName] = useState("");
  const [useSavedBank, setUseSavedBank] = useState<boolean | null>(null);

  // Misc
  const [invoiceId, setInvoiceId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");
  const [successInvoice, setSuccessInvoice] = useState("");

  useEffect(() => {
    fetchAdminBankAccounts()
      .then((res) => setAdminBanks(res.accounts || []))
      .catch(() => {});
    fetchUserPromoCodes()
      .then((res) => {
        const codes = (res.promo_codes || []).filter((p) => p.active && p.source !== "default");
        setUserPromoCodes(codes);
      })
      .catch(() => {});
  }, []);

  const effectiveRate = useMemo(() => {
    const base = baseRate || 0;
    if (!base) return 0;
    const discount = promoDiscount || 0;
    if (discount > 0) {
      const result = direction === "buy" ? base + discount : base - discount;
      return Math.round(result * 10) / 10;
    }
    return base;
  }, [baseRate, promoDiscount, direction]);

  const currencyFrom = direction === "buy" ? "RUB" : "MNT";
  const currencyTo = direction === "buy" ? "MNT" : "RUB";
  const convertedAmount = useMemo(() => {
    if (!effectiveRate || !amount) return 0;
    return direction === "buy" ? amount * effectiveRate : amount / effectiveRate;
  }, [amount, effectiveRate, direction]);

  const availableAdminBanks = useMemo(() => {
    if (direction === "buy") return adminBanks.filter((b) => b.currency === "RUB" && b.is_active);
    return [];
  }, [adminBanks, direction]);

  const availableMntAdminBanks = useMemo(() => {
    if (direction === "sell") return adminBanks.filter((b) => b.currency === "MNT" && b.is_active);
    return [];
  }, [adminBanks, direction]);

  useEffect(() => {
    if (direction === "sell" && availableMntAdminBanks.length > 0 && !selectedMntAdminBank) {
      setSelectedMntAdminBank(availableMntAdminBanks[0]);
    }
  }, [direction, availableMntAdminBanks, selectedMntAdminBank]);

  const generateInvoiceId = () => {
    const now = new Date();
    const moscowOffset = 3 * 60;
    const localOffset = now.getTimezoneOffset();
    const moscowTime = new Date(now.getTime() + (moscowOffset + localOffset) * 60 * 1000);
    const y = moscowTime.getFullYear();
    const mo = String(moscowTime.getMonth() + 1).padStart(2, "0");
    const d = String(moscowTime.getDate()).padStart(2, "0");
    const h = String(moscowTime.getHours()).padStart(2, "0");
    const mi = String(moscowTime.getMinutes()).padStart(2, "0");
    const s = String(moscowTime.getSeconds()).padStart(2, "0");
    const r = String(Math.floor(Math.random() * 100)).padStart(2, "0");
    return `${y}${mo}${d}-${h}${mi}${s}-${r}`;
  };

  const handleProceed = (dir: "buy" | "sell", amt: number, rt: number) => {
    setDirection(dir);
    setAmount(amt);
    setBaseRate(rt);
    if (!invoiceId) setInvoiceId(generateInvoiceId());
    setFlowStep("promo");
    onResetDirection();
  };

  const handleValidatePromo = async () => {
    if (!promoCode.trim() || !direction) {
      setFlowStep("adminBank");
      return;
    }
    setPromoValidating(true);
    setPromoError("");
    try {
      const res = await validatePromoCode(promoCode.trim(), direction);
      if (res.valid) {
        setPromoDiscount(Number(res.discount_amount) || 0);
        setPromoValid(true);
        setPromoMessage(res.message || "");
        setFlowStep("adminBank");
      } else {
        setPromoError(res.message || "Промо код олдсонгүй");
      }
    } catch {
      setPromoError("Промо код шалгахад алдаа гарлаа");
    } finally {
      setPromoValidating(false);
    }
  };

  const handleCopy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text.replace(/\s/g, ""));
      setCopied(label);
      setTimeout(() => setCopied(""), 2000);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text.replace(/\s/g, "");
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); setCopied(label); setTimeout(() => setCopied(""), 2000); } catch {}
      document.body.removeChild(ta);
    }
  };

  const handleUpload = async (file: File) => {
    try {
      setError("");
      setUploading(true);
      const path = `${direction}/${Date.now()}-${file.name}`;
      const presigned = await requestPresign({ bucket: "bills", path });
      await fetch(presigned.upload_url, { method: "PUT", body: file, headers: { "Content-Type": file.type } });
      setReceiptUrls((prev) => [...prev, presigned.public_url]);
    } catch {
      setError("Файл байршуулахад алдаа. Дахин оролдоно уу.");
    } finally {
      setUploading(false);
    }
  };

  const handleMultipleUpload = async (files: FileList) => {
    for (const file of Array.from(files)) await handleUpload(file);
  };

  const removeReceipt = (index: number) => setReceiptUrls((prev) => prev.filter((_, i) => i !== index));

  const getSavedBankForDirection = (dir: "buy" | "sell") => {
    const saved = dir === "buy" ? savedBankMnt : savedBankRub;
    if (!saved || !saved.trim()) return undefined;
    return saved;
  };

  const buildBankDetails = () => {
    if (direction === "buy") return `${mntBank},${mntIban},${mntOwnerName}`;
    return `${rubBank},${rubPhone},${rubCardNumber},${rubOwnerName}`;
  };

  const isBankValid = () => {
    if (direction === "buy") return !!(mntBank && mntIban && mntOwnerName);
    return !!(rubBank && rubCardNumber && rubPhone && rubOwnerName);
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
        receipt_path: receiptUrls[0],
        receipt_paths: receiptUrls,
        promo_code: promoValid ? promoCode : undefined,
        admin_bank_id: selectedAdminBank?.id,
        invoice: invoiceId,
      };
      const res = await createExchange(payload);
      setSuccessInvoice(res.invoice);
      setFlowStep("success");
    } catch {
      setError("Арилжаа үүсгэхэд алдаа гарлаа. Дахин оролдоно уу.");
    } finally {
      setLoading(false);
    }
  };

  const handleUseSaved = (use: boolean) => {
    setUseSavedBank(use);
    if (use && direction) {
      handleSubmit(getSavedBankForDirection(direction));
    }
  };

  const resetFlow = () => {
    setFlowStep("card");
    setDirection(null);
    setAmount(0);
    setBaseRate(0);
    setPromoCode("");
    setPromoDiscount(0);
    setPromoValid(false);
    setPromoMessage("");
    setPromoError("");
    setSelectedAdminBank(null);
    setSelectedMntAdminBank(null);
    setReceiptUrls([]);
    setInvoiceId("");
    setError("");
    setSuccessInvoice("");
    setUseSavedBank(null);
    setRubBank("");
    setRubCardNumber("");
    setRubPhone("");
    setRubOwnerName("");
    setMntBank("");
    setMntIban("");
    setMntOwnerName("");
  };

  // Registration modal state
  const [showRegistration, setShowRegistration] = useState(false);
  const queryClient = useQueryClient();

  const handleRegistered = () => {
    queryClient.invalidateQueries({ queryKey: ["me", user?.id] });
    setShowRegistration(false);
  };

  // Not verified: show message + register button
  if (!isVerified) {
    return (
      <>
        <div className="flex flex-col items-center justify-center py-16 gap-5 animate-fadeIn">
          <div className="w-20 h-20 bg-maroon-50 dark:bg-maroon-900/30 rounded-full flex items-center justify-center">
            <CreditCard className="w-10 h-10 text-maroon-400" />
          </div>
          <div className="text-center space-y-2">
            <div className="text-lg font-semibold text-dark-800 dark:text-ivory-200">Бүртгүүлэх шаардлагатай</div>
            <div className="text-sm text-dark-600 dark:text-ivory-300">Валют солихын тулд эхлээд бүртгүүлнэ үү.</div>
          </div>
          <button
            onClick={() => setShowRegistration(true)}
            className="flex items-center gap-2 px-6 py-3 rounded-2xl bg-maroon-600 hover:bg-maroon-700 text-white font-semibold shadow-card transition-all"
          >
            <UserPlus className="w-5 h-5" />
            Бүртгүүлэх
          </button>
        </div>
        {showRegistration && (
          <RegistrationModal
            onClose={() => setShowRegistration(false)}
            onRegistered={handleRegistered}
          />
        )}
      </>
    );
  }

  // No RUB bank
  if (!hasRubBank && flowStep === "card") {
    return (
      <div className="flex flex-col items-center gap-4 py-8 animate-fadeIn">
        <div className="w-16 h-16 bg-gold-100 dark:bg-gold-900/30 rounded-full flex items-center justify-center">
          <CreditCard className="w-8 h-8 text-gold-600" />
        </div>
        <div className="text-center">
          <div className="text-lg font-semibold text-gold-700 dark:text-gold-400 mb-2">Орос банкны мэдээлэл шаардлагатай</div>
          <div className="text-sm text-dark-600 dark:text-ivory-300 mb-4">Валют солихын тулд та орос банкны мэдээллээ бүртгүүлэх шаардлагатай.</div>
          <div className="bg-gold-50 dark:bg-gold-900/20 border border-gold-200 dark:border-gold-800 rounded-xl p-4 text-left">
            <div className="text-sm text-gold-800 dark:text-gold-300 font-medium mb-2">📋 Бүртгүүлэх заавар:</div>
            <ol className="text-sm text-gold-700 dark:text-gold-400 list-decimal list-inside space-y-1">
              <li>Нүүр хуудас дээрхи Профайл товчийг дарна</li>
              <li>Орос банкны дансны мэдээллээ оруулна</li>
              <li>Үүний дараа админы баталгаажуулалт хүлээгээрэй</li>
            </ol>
          </div>
        </div>
      </div>
    );
  }

  // Exchange Card view
  if (flowStep === "card") {
    return (
      <div className="animate-fadeIn">
        <ExchangeCard rate={rate} initialDirection={initialDirection} onProceed={handleProceed} />
      </div>
    );
  }

  // Step progress mapping
  const stepOrder = ["promo", "adminBank", "receipt", "receivingBank", "success"];
  const currentStepIndex = stepOrder.indexOf(flowStep);

  // Flow header with back button and progress
  const FlowHeader = ({ title, onBack }: { title: string; onBack: () => void }) => (
    <div className="space-y-3 mb-5">
      <div className="flex items-center gap-2">
        <button onClick={onBack} className="p-1.5 hover:bg-surface-100 dark:hover:bg-dark-700 rounded-xl transition">
          <ArrowLeft className="w-5 h-5 text-dark-600 dark:text-ivory-300" />
        </button>
        <div className="text-sm font-bold text-dark-800 dark:text-ivory-200">{title}</div>
        <button onClick={resetFlow} className="ml-auto text-xs text-dark-600 dark:text-ivory-400 hover:text-maroon-600 dark:hover:text-gold-400 font-medium">Цуцлах</button>
      </div>
      {/* Step progress dots */}
      <div className="flex items-center gap-1.5 px-1">
        {stepOrder.slice(0, -1).map((_, i) => (
          <div key={i} className={`h-1 flex-1 rounded-full transition-all duration-300 ${i <= currentStepIndex ? "bg-maroon-600 dark:bg-gold-400" : "bg-silver dark:bg-dark-600"}`} />
        ))}
      </div>
    </div>
  );

  // Rate info strip
  const RateInfo = () => (
    <div className="flex items-center gap-2 p-2.5 bg-surface-50 dark:bg-dark-700 rounded-xl text-sm mb-4 border border-silver/60 dark:border-dark-600">
      <ArrowRightLeft className="w-4 h-4 text-maroon-600 dark:text-gold-400" />
      <span className="text-dark-600 dark:text-ivory-300 font-medium">{currencyFrom} → {currencyTo}</span>
      <span className="ml-auto font-bold text-dark-800 dark:text-ivory-200">
        {effectiveRate.toFixed(2)}
        {promoDiscount > 0 && (
          <span className="text-green-600 ml-1 font-semibold">({direction === "buy" ? "+" : "-"}{promoDiscount})</span>
        )}
      </span>
    </div>
  );

  // Promo step
  if (flowStep === "promo") {
    return (
      <div className="bg-white dark:bg-dark-800 p-5 rounded-3xl shadow-card border border-silver/60 dark:border-dark-600 animate-slideUp">
        <FlowHeader title="Промо код" onBack={() => setFlowStep("card")} />
        <RateInfo />

        {userPromoCodes.length > 0 && (
          <div className="p-3 bg-gradient-to-r from-purple-50 to-pink-50 dark:from-purple-900/20 dark:to-pink-900/20 border border-purple-200 dark:border-purple-800 rounded-xl mb-3">
            <div className="text-sm font-medium text-purple-700 dark:text-purple-400 mb-2 flex items-center gap-2">
              <Gift className="w-4 h-4" /> Таны промо кодууд:
            </div>
            <div className="flex flex-wrap gap-2">
              {userPromoCodes.map((promo) => (
                <button
                  key={promo.code}
                  onClick={() => { setPromoCode(promo.code); setPromoError(""); }}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${
                    promoCode === promo.code ? "bg-purple-600 text-white" : "bg-white dark:bg-dark-700 text-purple-700 dark:text-purple-400 border border-purple-200 dark:border-purple-700 hover:bg-purple-100 dark:hover:bg-purple-900/30"
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
          className="w-full rounded-xl border border-silver dark:border-dark-600 bg-white dark:bg-dark-700 text-dark-800 dark:text-ivory-200 p-3 text-lg uppercase mb-3"
          placeholder="Промо код оруулна уу"
        />

        {promoError && <div className="text-red-600 dark:text-red-400 text-sm mb-3">{promoError}</div>}
        {promoValid && promoDiscount > 0 && (
          <div className="flex items-center gap-2 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl text-green-700 dark:text-green-400 mb-3">
            <Gift className="w-5 h-5" />
            <span>{promoMessage || (direction === "buy" ? `+${promoDiscount} ₮ ханшинд нэмэгдлээ!` : `-${promoDiscount} ₮ ханшнаас хасагдлаа!`)}</span>
          </div>
        )}

        <div className="flex gap-2">
          <button onClick={() => { setPromoCode(""); setPromoDiscount(0); setPromoValid(false); setFlowStep("adminBank"); }}
            className="flex-1 py-3 rounded-xl bg-surface-100 dark:bg-dark-700 text-dark-800 dark:text-ivory-200 font-semibold hover:bg-surface-200 dark:hover:bg-dark-600 transition">
            Алгасах
          </button>
          <button onClick={handleValidatePromo} disabled={promoValidating}
            className="flex-1 py-3 rounded-xl bg-maroon-600 text-white font-semibold hover:bg-maroon-500 disabled:opacity-50 transition">
            {promoValidating ? "Шалгаж байна..." : "Идэвхжүүлээд үргэлжлэх"}
          </button>
        </div>
      </div>
    );
  }

  // Admin bank selection step
  if (flowStep === "adminBank") {
    return (
      <div className="bg-white dark:bg-dark-800 p-5 rounded-3xl shadow-card border border-silver/60 dark:border-dark-600 animate-slideUp">
        <FlowHeader title="Банк сонгох" onBack={() => setFlowStep("promo")} />
        <RateInfo />

        <div className="text-sm text-dark-600 dark:text-ivory-300 mb-3">
          Та {amount.toLocaleString()} {currencyFrom}-г манай данс руу илгээнэ үү
        </div>

        {direction === "buy" && (
          <>
            {availableAdminBanks.length > 0 ? (
              <div className="flex flex-col gap-2 mb-3">
                <div className="text-xs text-dark-600 dark:text-ivory-300">Шилжүүлэх банк сонгоно уу:</div>
                {availableAdminBanks.map((bank) => (
                  <button key={bank.id} onClick={() => setSelectedAdminBank(bank)}
                    className={`p-4 rounded-xl border-2 text-left transition ${
                      selectedAdminBank?.id === bank.id ? "border-maroon-600 bg-maroon-50 dark:bg-maroon-900/20 dark:border-maroon-500" : "border-silver dark:border-dark-600 hover:border-maroon-300 dark:hover:border-maroon-700"
                    }`}>
                    <div className="font-semibold text-maroon-700 dark:text-maroon-400">{bank.bank_name}</div>
                    <div className="text-sm text-dark-600 dark:text-ivory-300 font-mono">{bank.card_number || bank.account_number}</div>
                    {bank.phone && <div className="text-xs text-dark-600 dark:text-ivory-400">{bank.phone}</div>}
                    <div className="text-xs text-dark-600 dark:text-ivory-400">{bank.owner_name}</div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="p-4 bg-gold-50 dark:bg-gold-900/20 border border-gold-200 dark:border-gold-800 rounded-xl text-sm text-gold-700 dark:text-gold-400 mb-3">
                Идэвхтэй банкны данс байхгүй байна.
              </div>
            )}

            {selectedAdminBank && (
              <div className="p-4 bg-maroon-50 dark:bg-maroon-900/20 border border-maroon-200 dark:border-maroon-800 rounded-xl space-y-2 mb-3">
                <div className="text-xs text-dark-600 dark:text-ivory-300">Шилжүүлгийн мэдээлэл:</div>
                {selectedAdminBank.card_number && (
                  <div className="flex items-center justify-between p-2 bg-white dark:bg-dark-700 rounded-lg">
                    <div>
                      <div className="text-xs text-dark-600 dark:text-ivory-400">Картын дугаар</div>
                      <div className="font-mono font-bold text-maroon-700 dark:text-maroon-400">{selectedAdminBank.card_number}</div>
                    </div>
                    <button onClick={() => handleCopy(selectedAdminBank.card_number!, "card")} className="p-2 bg-maroon-100 dark:bg-maroon-900/30 hover:bg-maroon-200 dark:hover:bg-maroon-800/30 rounded-lg transition">
                      {copied === "card" ? <CheckCircle2 className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4 text-maroon-600 dark:text-maroon-400" />}
                    </button>
                  </div>
                )}
                {selectedAdminBank.phone && (
                  <div className="flex items-center justify-between p-2 bg-white dark:bg-dark-700 rounded-lg">
                    <div>
                      <div className="text-xs text-dark-600 dark:text-ivory-400">Утас (СБП)</div>
                      <div className="font-mono font-bold text-maroon-700 dark:text-maroon-400">{selectedAdminBank.phone}</div>
                    </div>
                    <button onClick={() => handleCopy(selectedAdminBank.phone!, "phone")} className="p-2 bg-maroon-100 dark:bg-maroon-900/30 hover:bg-maroon-200 dark:hover:bg-maroon-800/30 rounded-lg transition">
                      {copied === "phone" ? <CheckCircle2 className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4 text-maroon-600 dark:text-maroon-400" />}
                    </button>
                  </div>
                )}
                <div className="text-sm text-dark-600 dark:text-ivory-300">{selectedAdminBank.owner_name}</div>
                <div className="mt-3 p-3 bg-gold-50 dark:bg-gold-900/20 border border-gold-200 dark:border-gold-800 rounded-lg">
                  <div className="text-xs text-gold-700 dark:text-gold-400 font-medium mb-1">⚠️ Гүйлгээний утга хэсэгт заавал бичнэ үү:</div>
                  <div className="flex items-center justify-between">
                    <div className="font-mono font-bold text-gold-800 dark:text-gold-300 text-lg">{invoiceId}</div>
                    <button onClick={() => handleCopy(invoiceId, "invoice")} className="p-2 bg-gold-100 dark:bg-gold-900/30 hover:bg-gold-200 dark:hover:bg-gold-800/30 rounded-lg transition">
                      {copied === "invoice" ? <CheckCircle2 className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4 text-gold-600 dark:text-gold-400" />}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {direction === "sell" && (
          <>
            {availableMntAdminBanks.length > 0 ? (
              <div className="flex flex-col gap-2 mb-3">
                <div className="text-xs text-dark-600 dark:text-ivory-300">MNT шилжүүлэх банк сонгоно уу:</div>
                {availableMntAdminBanks.map((bank) => (
                  <button key={bank.id} onClick={() => setSelectedMntAdminBank(bank)}
                    className={`p-4 rounded-xl border-2 text-left transition ${
                      selectedMntAdminBank?.id === bank.id ? "border-maroon-600 bg-maroon-50 dark:bg-maroon-900/20 dark:border-maroon-500" : "border-silver dark:border-dark-600 hover:border-maroon-300 dark:hover:border-maroon-700"
                    }`}>
                    <div className="font-semibold text-maroon-700 dark:text-maroon-400">{bank.bank_name}</div>
                    <div className="text-sm text-dark-600 dark:text-ivory-300 font-mono">{bank.account_number}</div>
                    <div className="text-xs text-dark-600 dark:text-ivory-400">{bank.owner_name}</div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="p-4 bg-gold-50 dark:bg-gold-900/20 border border-gold-200 dark:border-gold-800 rounded-xl text-sm text-gold-700 dark:text-gold-400 mb-3">
                Идэвхтэй MNT банкны данс байхгүй байна.
              </div>
            )}
            {selectedMntAdminBank && (
              <div className="p-4 bg-maroon-50 dark:bg-maroon-900/20 border border-maroon-200 dark:border-maroon-800 rounded-xl space-y-2 mb-3">
                <div className="text-xs text-dark-600 dark:text-ivory-300">Шилжүүлгийн мэдээлэл:</div>
                <div className="flex items-center justify-between p-2 bg-white dark:bg-dark-700 rounded-lg">
                  <div>
                    <div className="text-xs text-dark-600 dark:text-ivory-400">Данс</div>
                    <div className="font-mono font-bold text-maroon-700 dark:text-maroon-400">{selectedMntAdminBank.account_number}</div>
                  </div>
                  <button onClick={() => handleCopy(selectedMntAdminBank.account_number, "mnt-acc")} className="p-2 bg-maroon-100 dark:bg-maroon-900/30 hover:bg-maroon-200 dark:hover:bg-maroon-800/30 rounded-lg transition">
                    {copied === "mnt-acc" ? <CheckCircle2 className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4 text-maroon-600 dark:text-maroon-400" />}
                  </button>
                </div>
                <div className="text-sm text-dark-600 dark:text-ivory-300">{selectedMntAdminBank.owner_name}</div>
                <div className="mt-3 p-3 bg-gold-50 dark:bg-gold-900/20 border border-gold-200 dark:border-gold-800 rounded-lg">
                  <div className="text-xs text-gold-700 dark:text-gold-400 font-medium mb-1">⚠️ Гүйлгээний утга хэсэгт Invoice ID-г заавал бичнэ үү:</div>
                  <div className="flex items-center justify-between">
                    <div className="font-mono font-bold text-gold-800 dark:text-gold-300 text-lg">{invoiceId}</div>
                    <button onClick={() => handleCopy(invoiceId, "invoice")} className="p-2 bg-gold-100 dark:bg-gold-900/30 hover:bg-gold-200 dark:hover:bg-gold-800/30 rounded-lg transition">
                      {copied === "invoice" ? <CheckCircle2 className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4 text-gold-600 dark:text-gold-400" />}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        <button
          className="w-full rounded-2xl bg-maroon-600 text-white py-4 font-bold text-lg shadow-btn hover:bg-maroon-500 active:scale-[0.98] transition-all disabled:bg-silver disabled:text-dark-600 disabled:shadow-none"
          onClick={() => setFlowStep("receipt")}
          disabled={direction === "buy" ? !selectedAdminBank : !selectedMntAdminBank}
        >
          Үргэлжлүүлэх
        </button>
      </div>
    );
  }

  // Receipt upload step
  if (flowStep === "receipt") {
    return (
      <div className="bg-white dark:bg-dark-800 p-5 rounded-3xl shadow-card border border-silver/60 dark:border-dark-600 animate-slideUp">
        <FlowHeader title="Баримт оруулах" onBack={() => setFlowStep("adminBank")} />

        <div className="p-3 bg-maroon-50 dark:bg-maroon-900/20 rounded-xl text-sm mb-3">
          <div className="flex justify-between text-dark-800 dark:text-ivory-200">
            <span>Илгээх дүн:</span>
            <span className="font-bold">{amount.toLocaleString()} {currencyFrom}</span>
          </div>
          <div className="flex justify-between text-dark-800 dark:text-ivory-200">
            <span>Хүлээн авах дүн:</span>
            <span className="font-bold">{convertedAmount.toLocaleString(undefined, { maximumFractionDigits: 2 })} {currencyTo}</span>
          </div>
        </div>

        {receiptUrls.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-3">
            {receiptUrls.map((url, index) => (
              <div key={index} className="relative">
                <img src={url} alt={`Receipt ${index + 1}`} className="w-20 h-20 object-cover rounded-lg border border-maroon-200 dark:border-maroon-800" />
                <button onClick={() => removeReceipt(index)} className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 text-white rounded-full text-xs flex items-center justify-center hover:bg-red-600">×</button>
              </div>
            ))}
          </div>
        )}

        <label className="flex flex-col items-center justify-center border-2 border-dashed border-maroon-200 dark:border-maroon-700 rounded-xl py-8 cursor-pointer bg-white/60 dark:bg-dark-700/60 hover:bg-maroon-50 dark:hover:bg-maroon-900/20 transition mb-3">
          {receiptUrls.length > 0 ? (
            <div className="flex flex-col items-center gap-2 text-green-600 dark:text-green-400">
              <CheckCircle2 className="w-6 h-6" />
              <span className="font-medium">{receiptUrls.length} зураг хавсаргасан</span>
              <span className="text-xs text-dark-600 dark:text-ivory-400">Нэмж зураг хавсаргахын тулд энд дарна уу</span>
            </div>
          ) : (
            <>
              <Upload className="w-8 h-8 text-maroon-600 dark:text-maroon-400" />
              <span className="text-sm text-dark-600 dark:text-ivory-300 mt-2">{uploading ? "Хавсаргаж байна..." : "Төлбөрийн баримтын скриншот зураг оруулах"}</span>
              <span className="text-xs text-dark-600 dark:text-ivory-400 mt-1">Олон зураг сонгож болно</span>
            </>
          )}
          <input type="file" accept="image/*" multiple className="hidden"
            onChange={(e) => { const files = e.target.files; if (files && files.length > 0) handleMultipleUpload(files); }}
            disabled={uploading}
          />
        </label>

        {error && <div className="text-red-600 dark:text-red-400 text-sm mb-3">{error}</div>}

        <button
          className="w-full rounded-2xl bg-maroon-600 text-white py-4 font-bold text-lg shadow-btn hover:bg-maroon-500 active:scale-[0.98] transition-all disabled:bg-silver disabled:text-dark-600 disabled:shadow-none"
          onClick={() => {
            const saved = getSavedBankForDirection(direction!);
            if (saved) { setUseSavedBank(null); } else { setUseSavedBank(false); }
            setFlowStep("receivingBank");
          }}
          disabled={receiptUrls.length === 0}
        >
          Үргэлжлүүлэх
        </button>
      </div>
    );
  }

  // Receiving bank step
  if (flowStep === "receivingBank") {
    return (
      <div className="bg-white dark:bg-dark-800 p-5 rounded-3xl shadow-card border border-silver/60 dark:border-dark-600 animate-slideUp">
        <FlowHeader title={`${currencyTo} данс`} onBack={() => { setUseSavedBank(null); setFlowStep("receipt"); }} />

        {useSavedBank === null && getSavedBankForDirection(direction!) && (
          <div className="flex flex-col gap-3 mb-3">
            <div className="p-4 bg-maroon-50 dark:bg-maroon-900/20 rounded-xl border border-maroon-200 dark:border-maroon-800">
              <div className="text-xs text-dark-600 dark:text-ivory-400 mb-2">Хадгалсан {currencyTo} банкны мэдээлэл:</div>
              <div className="text-sm font-medium text-maroon-700 dark:text-maroon-300 whitespace-pre-wrap">{getSavedBankForDirection(direction!)}</div>
            </div>
            <div className="flex gap-3">
              <button onClick={() => handleUseSaved(true)}
                className="flex-1 py-3 rounded-xl bg-green-600 text-white font-semibold hover:bg-green-700 transition flex items-center justify-center gap-2">
                <CheckCircle2 className="w-5 h-5" /> Ашиглах
              </button>
              <button onClick={() => handleUseSaved(false)}
                className="flex-1 py-3 rounded-xl bg-surface-100 dark:bg-dark-700 text-dark-600 dark:text-ivory-300 font-semibold hover:bg-surface-200 dark:hover:bg-dark-600 transition flex items-center justify-center gap-2">
                <Edit3 className="w-5 h-5" /> Шинээр оруулах
              </button>
            </div>
          </div>
        )}

        {(useSavedBank !== null || !getSavedBankForDirection(direction!)) && (
          <div className="flex flex-col gap-3">
            {direction === "sell" && (
              <>
                <label className="text-xs text-dark-600 dark:text-ivory-400">Банк</label>
                <input value={rubBank} onChange={(e) => setRubBank(e.target.value)} className="rounded-xl border border-silver dark:border-dark-600 bg-white dark:bg-dark-700 text-dark-800 dark:text-ivory-200 p-3" placeholder="Tinkoff, Sber..." />
                <label className="text-xs text-dark-600 dark:text-ivory-400">Картын дугаар</label>
                <input value={rubCardNumber} onChange={(e) => setRubCardNumber(formatCardNumber(e.target.value))} className="rounded-xl border border-silver dark:border-dark-600 bg-white dark:bg-dark-700 text-dark-800 dark:text-ivory-200 p-3" placeholder="XXXX XXXX XXXX XXXX" maxLength={19} />
                <label className="text-xs text-dark-600 dark:text-ivory-400">Утас (СБП)</label>
                <input value={rubPhone} onChange={(e) => setRubPhone(formatRussianPhone(e.target.value))} className="rounded-xl border border-silver dark:border-dark-600 bg-white dark:bg-dark-700 text-dark-800 dark:text-ivory-200 p-3" placeholder="+7 XXX XXX XX XX" />
                <label className="text-xs text-dark-600 dark:text-ivory-400">Эзэмшигчийн нэр</label>
                <input value={rubOwnerName} onChange={(e) => setRubOwnerName(e.target.value)} className="rounded-xl border border-silver dark:border-dark-600 bg-white dark:bg-dark-700 text-dark-800 dark:text-ivory-200 p-3" placeholder="Иван Иванов" />
              </>
            )}
            {direction === "buy" && (
              <>
                <label className="text-xs text-dark-600 dark:text-ivory-400">Банк</label>
                <input value={mntBank} onChange={(e) => setMntBank(e.target.value)} className="rounded-xl border border-silver dark:border-dark-600 bg-white dark:bg-dark-700 text-dark-800 dark:text-ivory-200 p-3" placeholder="Хаан банк, Голомт банк..." />
                <label className="text-xs text-dark-600 dark:text-ivory-400">Дансны дугаар (IBAN)</label>
                <input value={mntIban} onChange={(e) => setMntIban(formatIBAN(e.target.value))} className="rounded-xl border border-silver dark:border-dark-600 bg-white dark:bg-dark-700 text-dark-800 dark:text-ivory-200 p-3" placeholder="MN XX XXXX XX XXXXXXXXXX" />
                <label className="text-xs text-dark-600 dark:text-ivory-400">Эзэмшигчийн нэр</label>
                <input value={mntOwnerName} onChange={(e) => setMntOwnerName(e.target.value)} className="rounded-xl border border-silver dark:border-dark-600 bg-white dark:bg-dark-700 text-dark-800 dark:text-ivory-200 p-3" placeholder="Бат-Эрдэнэ" />
              </>
            )}

            <button
              className="w-full rounded-2xl bg-green-600 text-white py-4 font-bold text-lg shadow-lg hover:bg-green-700 active:scale-[0.98] transition-all disabled:opacity-50"
              onClick={() => handleSubmit()}
              disabled={!isBankValid() || loading}
            >
              {loading ? "Боловсруулж байна..." : "Баталгаажуулах"}
            </button>

            {error && <div className="text-red-600 dark:text-red-400 text-sm">{error}</div>}
          </div>
        )}
      </div>
    );
  }

  // Success step
  if (flowStep === "success") {
    return (
      <div className="bg-white dark:bg-dark-800 p-6 rounded-3xl shadow-card border border-silver/60 dark:border-dark-600 animate-scaleIn">
        <div className="flex flex-col items-center gap-4 py-6">
          <div className="w-16 h-16 bg-green-50 dark:bg-green-900/20 rounded-full flex items-center justify-center">
            <CheckCircle2 className="w-9 h-9 text-green-500" />
          </div>
          <div className="text-xl font-bold text-dark-800 dark:text-ivory-200">Хүсэлт илгээгдлээ!</div>
          <div className="text-sm text-dark-600 dark:text-ivory-400 text-center">
            Invoice: <span className="font-mono font-bold text-dark-800 dark:text-ivory-200">{successInvoice}</span>
          </div>
          <div className="text-sm text-dark-600 dark:text-ivory-400 text-center">
            Админ таны төлбөрийг шалгаж дууссаны дараа танд Telegram чатаар мэдэгдэл ирэх болно.
          </div>
          <button onClick={resetFlow}
            className="mt-4 px-6 py-3 bg-maroon-600 text-white rounded-2xl font-semibold shadow-btn hover:bg-maroon-500 active:scale-[0.98] transition-all">
            Нүүр хуудас руу буцах
          </button>
        </div>
      </div>
    );
  }

  return null;
}
