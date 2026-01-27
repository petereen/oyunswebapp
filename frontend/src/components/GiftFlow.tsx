import { useState, useEffect, useMemo } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Gift,
  User,
  Phone,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Upload,
  Copy,
  MessageSquare,
  CreditCard,
  Building,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import {
  fetchGiftCards,
  searchUserByPhone,
  createGift,
  fetchAdminBankAccounts,
  requestPresign,
  AdminBankAccount,
  GiftCard,
  GiftCreateInput,
} from "../api";

interface Props {
  buyRate: number;
  sellRate: number;
  onBack: () => void;
  onSuccess: () => void;
}

// Bank name options
const RUB_BANKS = ["Tinkoff", "Sber", "Alfa", "VTB", "Raiffeisen", "Газпромбанк", "Открытие", "Россельхозбанк", "Другой"];
const MNT_BANKS = ["Хаан банк", "Голомт банк", "Хас банк", "Төрийн банк", "Худалдаа хөгжлийн банк", "Ариг банк", "Капитрон банк", "М банк", "Бусад"];

export function GiftFlow({ buyRate, sellRate, onBack, onSuccess }: Props) {
  // Steps:
  // 0: Select gift card
  // 1: Enter recipient phone & verify
  // 2: Choose direction & amount & message
  // 3: Show admin bank & upload receipt
  // 4: Confirmation & submit

  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Gift cards
  const [giftCards, setGiftCards] = useState<GiftCard[]>([]);
  const [selectedCardIndex, setSelectedCardIndex] = useState(0);
  const [cardsLoading, setCardsLoading] = useState(true);

  // Recipient
  const [recipientPhone, setRecipientPhone] = useState("");
  const [recipientSearching, setRecipientSearching] = useState(false);
  const [recipientFound, setRecipientFound] = useState<{ id: number; first_name: string; last_name: string } | null>(null);
  const [recipientError, setRecipientError] = useState("");

  // Transaction details
  const [direction, setDirection] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState<string>("");
  const [message, setMessage] = useState("");

  // Admin bank accounts
  const [adminBanks, setAdminBanks] = useState<AdminBankAccount[]>([]);
  const [selectedAdminBank, setSelectedAdminBank] = useState<AdminBankAccount | null>(null);

  // Receipt
  const [receiptUrl, setReceiptUrl] = useState("");
  const [uploading, setUploading] = useState(false);

  // Invoice
  const [invoiceId, setInvoiceId] = useState("");

  // Copied state
  const [copied, setCopied] = useState("");

  // Success state
  const [successInvoice, setSuccessInvoice] = useState("");

  // From who field (sender's display name on the gift)
  const [fromName, setFromName] = useState("");

  // Load gift cards
  useEffect(() => {
    setCardsLoading(true);
    fetchGiftCards()
      .then((res) => {
        setGiftCards(res.cards || []);
      })
      .catch((err) => {
        console.error("Error loading gift cards:", err);
        setError("Бэлгийн карт ачаалахад алдаа гарлаа");
      })
      .finally(() => setCardsLoading(false));
  }, []);

  // Load admin bank accounts
  useEffect(() => {
    fetchAdminBankAccounts()
      .then((res) => setAdminBanks(res.accounts || []))
      .catch(() => setAdminBanks([]));
  }, []);

  // Generate invoice ID
  const generateInvoiceId = () => {
    const now = new Date();
    const moscowOffset = 3 * 60;
    const localOffset = now.getTimezoneOffset();
    const moscowTime = new Date(now.getTime() + (moscowOffset + localOffset) * 60 * 1000);

    const year = moscowTime.getFullYear();
    const month = String(moscowTime.getMonth() + 1).padStart(2, "0");
    const day = String(moscowTime.getDate()).padStart(2, "0");
    const hours = String(moscowTime.getHours()).padStart(2, "0");
    const minutes = String(moscowTime.getMinutes()).padStart(2, "0");
    const seconds = String(moscowTime.getSeconds()).padStart(2, "0");
    const random = String(Math.floor(Math.random() * 100)).padStart(2, "0");

    return `GIFT-${year}${month}${day}-${hours}${minutes}${seconds}-${random}`;
  };

  // Calculate converted amount
  const effectiveRate = direction === "buy" ? buyRate : sellRate;
  const convertedAmount = useMemo(() => {
    const amt = parseFloat(amount) || 0;
    if (!effectiveRate || !amt) return 0;
    return direction === "buy" ? amt * effectiveRate : amt / effectiveRate;
  }, [amount, effectiveRate, direction]);

  const currencyFrom = direction === "buy" ? "RUB" : "MNT";
  const currencyTo = direction === "buy" ? "MNT" : "RUB";

  // Available admin banks based on direction
  const availableAdminBanks = useMemo(() => {
    if (direction === "buy") {
      return adminBanks.filter((b) => b.currency === "RUB" && b.is_active);
    } else {
      return adminBanks.filter((b) => b.currency === "MNT" && b.is_active);
    }
  }, [adminBanks, direction]);

  // Auto-select first admin bank
  useEffect(() => {
    if (availableAdminBanks.length > 0 && !selectedAdminBank) {
      setSelectedAdminBank(availableAdminBanks[0]);
    }
  }, [availableAdminBanks, selectedAdminBank]);

  // Handle recipient phone search
  const handleSearchRecipient = async () => {
    if (!recipientPhone.trim()) {
      setRecipientError("Утасны дугаар оруулна уу");
      return;
    }

    try {
      setRecipientSearching(true);
      setRecipientError("");
      setRecipientFound(null);

      const result = await searchUserByPhone(recipientPhone.trim());

      if (result.found && result.user) {
        setRecipientFound(result.user);
      } else {
        setRecipientError("Энэ утасны дугаартай хэрэглэгч олдсонгүй. Дахин оролдоно уу.");
      }
    } catch (err) {
      console.error("Search error:", err);
      setRecipientError("Хайлт хийхэд алдаа гарлаа");
    } finally {
      setRecipientSearching(false);
    }
  };

  // Handle receipt upload
  const handleReceiptUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setUploading(true);
      setError("");
      const ext = file.name.split(".").pop() || "jpg";
      const safeFilename = `gift_receipt_${Date.now()}.${ext}`;
      const path = `gift_receipts/${safeFilename}`;
      const presigned = await requestPresign({ bucket: "bills", path });
      await fetch(presigned.upload_url, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type },
      });
      setReceiptUrl(presigned.public_url);
    } catch (err) {
      console.error("Receipt upload error:", err);
      setError("Баримт оруулахад алдаа гарлаа");
    } finally {
      setUploading(false);
    }
  };

  // Handle copy
  const handleCopy = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopied(field);
    setTimeout(() => setCopied(""), 2000);
  };

  // Navigate gift cards
  const nextCard = () => {
    setSelectedCardIndex((prev) => (prev + 1) % giftCards.length);
  };

  const prevCard = () => {
    setSelectedCardIndex((prev) => (prev - 1 + giftCards.length) % giftCards.length);
  };

  // Handle final submission
  const handleSubmit = async () => {
    if (!giftCards[selectedCardIndex] || !recipientFound || !amount || !receiptUrl || !selectedAdminBank) {
      setError("Бүх талбарыг бөглөнө үү");
      return;
    }

    // Ensure invoice ID exists
    const finalInvoiceId = invoiceId || generateInvoiceId();
    if (!invoiceId) {
      setInvoiceId(finalInvoiceId);
    }

    try {
      setLoading(true);
      setError("");

      const payload: GiftCreateInput = {
        invoice: finalInvoiceId,
        recipient_phone: recipientPhone.trim(),
        recipient_user_id: recipientFound.id,
        gift_card_url: giftCards[selectedCardIndex].image_url,
        message: message.trim(),
        direction,
        amount: parseFloat(amount),
        currency_from: currencyFrom,
        currency_to: currencyTo,
        rate: effectiveRate,
        admin_bank_id: selectedAdminBank.id,
        sender_receipt_url: receiptUrl,
        from_name: fromName.trim() || undefined,
      };

      console.log("Creating gift with payload:", payload);
      await createGift(payload);
      setSuccessInvoice(finalInvoiceId);
    } catch (err: any) {
      console.error("Gift creation error:", err);
      const errorDetail = err?.response?.data?.detail || err?.response?.data?.body || "";
      console.error("Error details:", errorDetail);
      setError(`Бэлэг илгээхэд алдаа гарлаа: ${typeof errorDetail === 'string' ? errorDetail.slice(0, 100) : JSON.stringify(errorDetail).slice(0, 100)}`);
    } finally {
      setLoading(false);
    }
  };

  // Success screen
  if (successInvoice) {
    return (
      <div className="glass-card p-6 rounded-2xl border border-white/60">
        <div className="text-center py-8">
          <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Gift className="w-10 h-10 text-green-600" />
          </div>
          <h2 className="text-2xl font-bold text-green-700 mb-2">Бэлэг амжилттай илгээгдлээ!</h2>
          <p className="text-slate-600 mb-4">
            Таны бэлэг хүлээн авагч руу илгээгдлээ. Тэд банкны мэдээллээ баталгаажуулсны дараа мөнгө шилжүүлэгдэнэ.
          </p>
          <div className="bg-slate-100 rounded-lg p-3 mb-6">
            <div className="text-xs text-slate-500">Invoice ID</div>
            <div className="font-mono font-bold text-ocean-700">{successInvoice}</div>
          </div>
          <button
            onClick={onSuccess}
            className="w-full py-4 rounded-xl bg-ocean-600 text-white font-bold hover:bg-ocean-700 transition"
          >
            Дуусгах
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="glass-card p-6 rounded-2xl border border-white/60">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button onClick={onBack} className="p-2 rounded-full hover:bg-ocean-100 transition">
          <ArrowLeft className="w-5 h-5 text-ocean-600" />
        </button>
        <div className="flex items-center gap-2">
          <Gift className="w-6 h-6 text-pink-500" />
          <h2 className="text-xl font-bold text-ocean-700">Бэлэг илгээх</h2>
        </div>
      </div>

      {/* Step indicator */}
      <div className="flex items-center justify-center gap-2 mb-6">
        {[0, 1, 2, 3, 4].map((s) => (
          <div
            key={s}
            className={`w-3 h-3 rounded-full transition ${s === step ? "bg-pink-500 scale-125" : s < step ? "bg-pink-300" : "bg-slate-200"}`}
          />
        ))}
      </div>

      {/* Step 0: Select Gift Card */}
      {step === 0 && (
        <div className="space-y-4">
          <div className="text-center mb-4">
            <h3 className="text-lg font-semibold text-ocean-700">Бэлгийн карт сонгох</h3>
            <p className="text-sm text-slate-500">Хүлээн авагчид илгээх картаа сонгоно уу</p>
          </div>

          {cardsLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 text-pink-500 animate-spin" />
            </div>
          ) : giftCards.length === 0 ? (
            <div className="text-center py-12 text-slate-500">
              Бэлгийн карт олдсонгүй
            </div>
          ) : (
            <div className="relative">
              {/* Card carousel */}
              <div className="flex items-center justify-center gap-4">
                <button
                  onClick={prevCard}
                  className="p-2 rounded-full bg-white shadow-lg hover:bg-slate-50 transition"
                >
                  <ChevronLeft className="w-6 h-6 text-ocean-600" />
                </button>

                <div className="w-64 h-40 relative overflow-hidden rounded-xl shadow-lg">
                  <img
                    src={giftCards[selectedCardIndex]?.image_url}
                    alt={giftCards[selectedCardIndex]?.name || "Gift card"}
                    className="w-full h-full object-cover"
                  />
                </div>

                <button
                  onClick={nextCard}
                  className="p-2 rounded-full bg-white shadow-lg hover:bg-slate-50 transition"
                >
                  <ChevronRight className="w-6 h-6 text-ocean-600" />
                </button>
              </div>

              {/* Card name */}
              <div className="text-center mt-3">
                <span className="text-sm font-medium text-slate-600">
                  {giftCards[selectedCardIndex]?.name}
                </span>
                <span className="text-xs text-slate-400 ml-2">
                  ({selectedCardIndex + 1}/{giftCards.length})
                </span>
              </div>
            </div>
          )}

          {/* From who field */}
          <div className="mt-4">
            <label className="text-xs text-slate-500 flex items-center gap-1">
              <User className="w-3 h-3" /> Хэнээс? (Бэлэг хүлээн авч буй хүнд харагдах нэр)
            </label>
            <input
              type="text"
              value={fromName}
              onChange={(e) => setFromName(e.target.value)}
              className="w-full rounded-lg border border-ocean-200 p-3 text-sm mt-1"
              placeholder="Жишээ нь: Найзаас нь"
            />
          </div>

          <button
            onClick={() => setStep(1)}
            disabled={giftCards.length === 0}
            className="w-full py-4 rounded-xl bg-pink-500 text-white font-bold hover:bg-pink-600 transition disabled:opacity-50"
          >
            Үргэлжлүүлэх
          </button>
        </div>
      )}

      {/* Step 1: Enter recipient phone */}
      {step === 1 && (
        <div className="space-y-4">
          <div className="text-center mb-4">
            <h3 className="text-lg font-semibold text-ocean-700">Хүлээн авагчийн мэдээлэл</h3>
            <p className="text-sm text-slate-500">Бэлэг хүлээн авах хүний бүртгэлтэй утасны дугаарыг оруулна уу</p>
          </div>

          <div>
            <label className="text-xs text-slate-500 flex items-center gap-1">
              <Phone className="w-3 h-3" /> Утасны дугаар
            </label>
            <div className="flex gap-2">
              <input
                type="tel"
                value={recipientPhone}
                onChange={(e) => {
                  setRecipientPhone(e.target.value);
                  setRecipientFound(null);
                  setRecipientError("");
                }}
                className="flex-1 rounded-lg border border-ocean-200 p-3 text-sm"
                placeholder="+976 9911 2233"
              />
              <button
                onClick={handleSearchRecipient}
                disabled={recipientSearching}
                className="px-4 py-2 rounded-lg bg-ocean-600 text-white font-medium hover:bg-ocean-700 transition disabled:opacity-50"
              >
                {recipientSearching ? <Loader2 className="w-5 h-5 animate-spin" /> : "Хайх"}
              </button>
            </div>
          </div>

          {recipientError && (
            <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              <AlertCircle className="w-4 h-4" />
              {recipientError}
            </div>
          )}

          {recipientFound && (
            <div className="p-4 bg-green-50 border border-green-200 rounded-xl">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center">
                  <User className="w-6 h-6 text-green-600" />
                </div>
                <div>
                  <div className="text-sm text-slate-500">Хүлээн авагч:</div>
                  <div className="text-lg">
                    {recipientFound.last_name} <span className="font-bold">{recipientFound.first_name}</span>
                  </div>
                </div>
                <CheckCircle2 className="w-6 h-6 text-green-500 ml-auto" />
              </div>
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={() => setStep(0)}
              className="flex-1 py-3 rounded-xl border border-ocean-200 text-ocean-700 font-medium hover:bg-ocean-50 transition"
            >
              Буцах
            </button>
            <button
              onClick={() => setStep(2)}
              disabled={!recipientFound}
              className="flex-1 py-3 rounded-xl bg-pink-500 text-white font-bold hover:bg-pink-600 transition disabled:opacity-50"
            >
              Үргэлжлүүлэх
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Direction, amount, message */}
      {step === 2 && (
        <div className="space-y-4">
          <div className="text-center mb-4">
            <h3 className="text-lg font-semibold text-ocean-700">Бэлгийн мэдээлэл</h3>
            <p className="text-sm text-slate-500">Илгээх валют, дүн болон мессежээ оруулна уу</p>
          </div>

          {/* Direction selection */}
          <div>
            <label className="text-xs text-slate-500">Чиглэл сонгох</label>
            <div className="grid grid-cols-2 gap-2 mt-1">
              <button
                onClick={() => setDirection("buy")}
                className={`p-4 rounded-xl border-2 transition ${
                  direction === "buy"
                    ? "border-pink-500 bg-pink-50"
                    : "border-slate-200 hover:border-slate-300"
                }`}
              >
                <div className="text-lg font-bold">🇷🇺 → 🇲🇳</div>
                <div className="text-sm text-slate-600">RUB → MNT</div>
              </button>
              <button
                onClick={() => setDirection("sell")}
                className={`p-4 rounded-xl border-2 transition ${
                  direction === "sell"
                    ? "border-pink-500 bg-pink-50"
                    : "border-slate-200 hover:border-slate-300"
                }`}
              >
                <div className="text-lg font-bold">🇲🇳 → 🇷🇺</div>
                <div className="text-sm text-slate-600">MNT → RUB</div>
              </button>
            </div>
          </div>

          {/* Amount */}
          <div>
            <label className="text-xs text-slate-500">Илгээх дүн ({currencyFrom})</label>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full rounded-lg border border-ocean-200 p-3 text-lg"
              placeholder="0"
            />
            {amount && parseFloat(amount) > 0 && (
              <div className="mt-2 p-3 bg-slate-50 rounded-lg">
                <div className="text-sm text-slate-500">Хүлээн авах дүн:</div>
                <div className="text-xl font-bold text-ocean-700">
                  {convertedAmount.toLocaleString("en-US", { maximumFractionDigits: 2 })} {currencyTo}
                </div>
                <div className="text-xs text-slate-400">Ханш: {effectiveRate}</div>
              </div>
            )}
          </div>

          {/* Message */}
          <div>
            <label className="text-xs text-slate-500 flex items-center gap-1">
              <MessageSquare className="w-3 h-3" /> Мессеж (заавал биш)
            </label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value.slice(0, 1000))}
              className="w-full rounded-lg border border-ocean-200 p-3 text-sm resize-none"
              rows={3}
              placeholder="Хүлээн авагчид илгээх мессеж..."
            />
            <div className="text-xs text-slate-400 text-right">{message.length}/1000</div>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => setStep(1)}
              className="flex-1 py-3 rounded-xl border border-ocean-200 text-ocean-700 font-medium hover:bg-ocean-50 transition"
            >
              Буцах
            </button>
            <button
              onClick={() => {
                if (!invoiceId) setInvoiceId(generateInvoiceId());
                setStep(3);
              }}
              disabled={!amount || parseFloat(amount) <= 0}
              className="flex-1 py-3 rounded-xl bg-pink-500 text-white font-bold hover:bg-pink-600 transition disabled:opacity-50"
            >
              Үргэлжлүүлэх
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Admin bank & upload receipt */}
      {step === 3 && (
        <div className="space-y-4">
          <div className="text-center mb-4">
            <h3 className="text-lg font-semibold text-ocean-700">Төлбөр шилжүүлэх</h3>
            <p className="text-sm text-slate-500">
              Доорх дансруу {amount} {currencyFrom} шилжүүлээд баримтаа оруулна уу
            </p>
          </div>

          {/* Invoice ID */}
          <div className="p-3 bg-pink-50 rounded-lg border border-pink-200">
            <div className="text-xs text-pink-600">Invoice ID (гүйлгээний утга)</div>
            <div className="flex items-center justify-between">
              <span className="font-mono font-bold text-pink-700">{invoiceId}</span>
              <button
                onClick={() => handleCopy(invoiceId, "invoice")}
                className="p-1 hover:bg-pink-100 rounded"
              >
                {copied === "invoice" ? (
                  <CheckCircle2 className="w-4 h-4 text-green-500" />
                ) : (
                  <Copy className="w-4 h-4 text-pink-600" />
                )}
              </button>
            </div>
          </div>

          {/* Admin bank selection */}
          {availableAdminBanks.length > 0 ? (
            <div className="space-y-2">
              {availableAdminBanks.map((bank) => (
                <div
                  key={bank.id}
                  onClick={() => setSelectedAdminBank(bank)}
                  className={`p-4 rounded-xl border-2 cursor-pointer transition ${
                    selectedAdminBank?.id === bank.id
                      ? "border-pink-500 bg-pink-50"
                      : "border-slate-200 hover:border-slate-300"
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-semibold text-ocean-700">{bank.bank_name}</span>
                    <span className={`text-xs px-2 py-0.5 rounded ${direction === "buy" ? "bg-blue-100 text-blue-700" : "bg-green-100 text-green-700"}`}>
                      {bank.currency}
                    </span>
                  </div>
                  <div className="space-y-1 text-sm">
                    {bank.card_number && (
                      <div className="flex items-center justify-between">
                        <span className="text-slate-500">Карт:</span>
                        <div className="flex items-center gap-1">
                          <span className="font-mono">{bank.card_number}</span>
                          <button onClick={(e) => { e.stopPropagation(); handleCopy(bank.card_number!, "card"); }} className="p-1">
                            {copied === "card" ? <CheckCircle2 className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3 text-slate-400" />}
                          </button>
                        </div>
                      </div>
                    )}
                    {bank.phone && (
                      <div className="flex items-center justify-between">
                        <span className="text-slate-500">Утас:</span>
                        <div className="flex items-center gap-1">
                          <span className="font-mono">{bank.phone}</span>
                          <button onClick={(e) => { e.stopPropagation(); handleCopy(bank.phone!, "phone"); }} className="p-1">
                            {copied === "phone" ? <CheckCircle2 className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3 text-slate-400" />}
                          </button>
                        </div>
                      </div>
                    )}
                    {bank.account_number && (
                      <div className="flex items-center justify-between">
                        <span className="text-slate-500">Данс:</span>
                        <div className="flex items-center gap-1">
                          <span className="font-mono">{bank.account_number}</span>
                          <button onClick={(e) => { e.stopPropagation(); handleCopy(bank.account_number!, "account"); }} className="p-1">
                            {copied === "account" ? <CheckCircle2 className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3 text-slate-400" />}
                          </button>
                        </div>
                      </div>
                    )}
                    <div className="text-slate-600">Эзэмшигч: {bank.owner_name}</div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-slate-500">
              Админ банкны данс олдсонгүй
            </div>
          )}

          {/* Receipt upload */}
          <div>
            <label className="text-xs text-slate-500">Гүйлгээний баримт</label>
            <div className="mt-1">
              {receiptUrl ? (
                <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg">
                  <CheckCircle2 className="w-5 h-5 text-green-600" />
                  <span className="text-sm text-green-700">Баримт амжилттай оруулсан</span>
                  <button onClick={() => setReceiptUrl("")} className="ml-auto text-xs text-ocean-600 hover:underline">
                    Өөрчлөх
                  </button>
                </div>
              ) : (
                <label className="flex items-center justify-center gap-2 p-4 border-2 border-dashed border-ocean-300 rounded-lg cursor-pointer hover:bg-ocean-50 transition">
                  {uploading ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin text-ocean-600" />
                      <span className="text-sm text-ocean-600">Оруулж байна...</span>
                    </>
                  ) : (
                    <>
                      <Upload className="w-5 h-5 text-ocean-600" />
                      <span className="text-sm text-ocean-600">Баримтын зургаа оруулна уу</span>
                    </>
                  )}
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleReceiptUpload}
                    className="hidden"
                    disabled={uploading}
                  />
                </label>
              )}
            </div>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => setStep(2)}
              className="flex-1 py-3 rounded-xl border border-ocean-200 text-ocean-700 font-medium hover:bg-ocean-50 transition"
            >
              Буцах
            </button>
            <button
              onClick={() => setStep(4)}
              disabled={!receiptUrl || !selectedAdminBank}
              className="flex-1 py-3 rounded-xl bg-pink-500 text-white font-bold hover:bg-pink-600 transition disabled:opacity-50"
            >
              Үргэлжлүүлэх
            </button>
          </div>
        </div>
      )}

      {/* Step 4: Confirmation */}
      {step === 4 && (
        <div className="space-y-4">
          <div className="text-center mb-4">
            <h3 className="text-lg font-semibold text-ocean-700">Баталгаажуулалт</h3>
            <p className="text-sm text-slate-500">Мэдээллээ шалгаад баталгаажуулна уу</p>
          </div>

          {/* Gift card preview */}
          <div className="text-center">
            <img
              src={giftCards[selectedCardIndex]?.image_url}
              alt="Gift card"
              className="w-48 h-28 object-cover rounded-xl mx-auto shadow-lg"
            />
          </div>

          {/* Recipient info */}
          <div className="p-4 bg-slate-50 rounded-xl space-y-2">
            {fromName && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-500">Хэнээс:</span>
                <span className="font-medium text-pink-600">{fromName}</span>
              </div>
            )}
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-500">Хүлээн авагч:</span>
              <span className="font-medium">
                {recipientFound?.last_name} <span className="font-bold">{recipientFound?.first_name}</span>
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-500">Утас:</span>
              <span className="font-mono">{recipientPhone}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-500">Дүн:</span>
              <span className="font-bold text-ocean-700">
                {parseFloat(amount).toLocaleString()} {currencyFrom} → {convertedAmount.toLocaleString("en-US", { maximumFractionDigits: 2 })} {currencyTo}
              </span>
            </div>
            {message && (
              <div className="pt-2 border-t border-slate-200">
                <div className="text-xs text-slate-500">Мессеж:</div>
                <div className="text-sm text-slate-700 italic">"{message}"</div>
              </div>
            )}
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              <AlertCircle className="w-4 h-4" />
              {error}
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={() => setStep(3)}
              className="flex-1 py-3 rounded-xl border border-ocean-200 text-ocean-700 font-medium hover:bg-ocean-50 transition"
            >
              Буцах
            </button>
            <button
              onClick={handleSubmit}
              disabled={loading}
              className="flex-1 py-4 rounded-xl bg-pink-500 text-white font-bold hover:bg-pink-600 transition disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Илгээж байна...
                </>
              ) : (
                <>
                  <Gift className="w-5 h-5" />
                  Бэлэг илгээх
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
