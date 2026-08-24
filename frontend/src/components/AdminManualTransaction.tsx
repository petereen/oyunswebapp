import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  FileImage,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  Upload,
  UserRound,
} from "lucide-react";
import {
  AdminBankAccountFull,
  ManualTransactionUser,
  createManualTransaction,
  fetchAllAdminBankAccounts,
  fetchRates,
  lookupManualTransactionUser,
  requestPresign,
  ManualTransactionCreateInput,
} from "../api";
import { prepareImageForUpload } from "../utils/imageUpload";

type Direction = "buy" | "sell";

type ReceiverFields = {
  bankName: string;
  accountNumber: string;
  phone: string;
  cardNumber: string;
  ownerName: string;
};

const EMPTY_RECEIVER: ReceiverFields = {
  bankName: "",
  accountNumber: "",
  phone: "",
  cardNumber: "",
  ownerName: "",
};

function parseSavedBank(value: string | undefined, direction: Direction): ReceiverFields {
  const parts = (value || "").split(",").map((part) => part.trim());
  if (parts.filter(Boolean).length === 0) return { ...EMPTY_RECEIVER };
  if (direction === "sell" && parts.length >= 4) {
    return {
      bankName: parts[0] || "",
      phone: parts[1] || "",
      cardNumber: parts[2] || "",
      ownerName: parts[3] || "",
      accountNumber: "",
    };
  }
  return {
    ...EMPTY_RECEIVER,
    bankName: parts[0] || "",
    accountNumber: parts[1] || "",
    ownerName: parts[2] || "",
  };
}

function safePathPart(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "");
}

interface Props {
  onOpenInbox: () => void;
}

export function AdminManualTransaction({ onOpenInbox }: Props) {
  const [telegramId, setTelegramId] = useState("");
  const [user, setUser] = useState<ManualTransactionUser | null>(null);
  const [userFound, setUserFound] = useState<boolean | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [direction, setDirection] = useState<Direction>("buy");
  const [liveRates, setLiveRates] = useState({ buy_rate: 0, sell_rate: 0 });
  const [exchangeRate, setExchangeRate] = useState("");
  const [amount, setAmount] = useState("");
  const [rateTouched, setRateTouched] = useState(false);
  const [accounts, setAccounts] = useState<AdminBankAccountFull[]>([]);
  const [adminBankId, setAdminBankId] = useState("");
  const [receiver, setReceiver] = useState<ReceiverFields>({ ...EMPTY_RECEIVER });
  const [transactionAt, setTransactionAt] = useState("");
  const [receiptUrls, setReceiptUrls] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState<{ invoice: string; amount: number; currency: string } | null>(null);

  useEffect(() => {
    Promise.all([fetchRates(), fetchAllAdminBankAccounts()])
      .then(([rates, bankResponse]) => {
        setLiveRates({ buy_rate: rates.buy_rate, sell_rate: rates.sell_rate });
        setExchangeRate(String(rates.buy_rate || ""));
        setAccounts(bankResponse.accounts || []);
      })
      .catch(() => setError("Live rate эсвэл OYUNS дансны мэдээлэл ачаалж чадсангүй."));
  }, []);

  useEffect(() => {
    if (!rateTouched) {
      const nextRate = direction === "buy" ? liveRates.buy_rate : liveRates.sell_rate;
      setExchangeRate(nextRate ? String(nextRate) : "");
    }
    if (user) {
      const saved = direction === "buy" ? user.bank_mnt : user.bank_rub;
      setReceiver(parseSavedBank(saved, direction));
    }
  }, [direction, liveRates, rateTouched, user]);

  const sourceCurrency = direction === "buy" ? "RUB" : "MNT";
  const destinationCurrency = direction === "buy" ? "MNT" : "RUB";
  const availableAccounts = useMemo(
    () => accounts.filter((account) => account.currency === sourceCurrency),
    [accounts, sourceCurrency],
  );
  const numericAmount = Number(amount);
  const numericRate = Number(exchangeRate);
  const convertedAmount = numericAmount > 0 && numericRate > 0
    ? direction === "buy" ? numericAmount * numericRate : numericAmount / numericRate
    : 0;

  const updateReceiver = (field: keyof ReceiverFields, value: string) => {
    setReceiver((current) => ({ ...current, [field]: value }));
  };

  const lookupUser = async () => {
    const parsedId = Number(telegramId);
    if (!Number.isInteger(parsedId) || parsedId <= 0) {
      setError("Зөв Telegram ID оруулна уу.");
      return;
    }
    setLookupLoading(true);
    setError("");
    setUser(null);
    try {
      const result = await lookupManualTransactionUser(parsedId);
      setUserFound(result.found);
      setUser(result.user);
      if (result.user) {
        const saved = direction === "buy" ? result.user.bank_mnt : result.user.bank_rub;
        setReceiver(parseSavedBank(saved, direction));
      } else {
        setReceiver({ ...EMPTY_RECEIVER });
      }
    } catch (lookupError: any) {
      setUserFound(null);
      setError(lookupError?.response?.data?.detail || "Хэрэглэгч хайхад алдаа гарлаа.");
    } finally {
      setLookupLoading(false);
    }
  };

  const uploadReceipt = async (file: File) => {
    if (!Number.isInteger(Number(telegramId)) || Number(telegramId) <= 0) {
      setError("Баримт upload хийхээс өмнө Telegram ID хайна уу.");
      return;
    }
    setUploading(true);
    setError("");
    try {
      const prepared = await prepareImageForUpload(file);
      const path = `manual/${safePathPart(telegramId)}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${(prepared.file.name.split(".").pop() || "jpg").replace(/[^a-z0-9]/gi, "")}`;
      const presigned = await requestPresign({ bucket: "bills", path });
      const uploadResponse = await fetch(presigned.upload_url, {
        method: "PUT",
        body: prepared.file,
        headers: prepared.mimeType ? { "Content-Type": prepared.mimeType } : undefined,
      });
      if (!uploadResponse.ok || !presigned.public_url) throw new Error("Receipt upload failed");
      setReceiptUrls((current) => [...current, presigned.public_url as string]);
    } catch {
      setError("Баримтын зураг upload хийж чадсангүй.");
    } finally {
      setUploading(false);
    }
  };

  const uploadReceipts = async (files: File[]) => {
    for (const file of files) await uploadReceipt(file);
  };

  const validateForm = () => {
    if (!userFound && userFound !== false) return "Эхлээд Telegram ID хайна уу.";
    if (!Number.isInteger(Number(telegramId)) || Number(telegramId) <= 0) return "Зөв Telegram ID оруулна уу.";
    if (!adminBankId) return "OYUNS хүлээн авах дансаа сонгоно уу.";
    if (!numericAmount || numericAmount <= 0) return "Дүн 0-ээс их байх ёстой.";
    if (!numericRate || numericRate <= 0) return "Ханш 0-ээс их байх ёстой.";
    if (!receiver.bankName.trim() || !receiver.ownerName.trim()) return "Хүлээн авагчийн банк, нэрийг бөглөнө үү.";
    if (direction === "buy" && !receiver.accountNumber.trim()) return "MNT дансны дугаарыг бөглөнө үү.";
    if (direction === "sell" && (!receiver.phone.trim() || !receiver.cardNumber.trim())) return "RUB утас болон картын дугаарыг бөглөнө үү.";
    if (receiptUrls.length === 0) return "Дор хаяж нэг төлбөрийн баримт upload хийнэ үү.";
    return "";
  };

  const submit = async () => {
    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      return;
    }
    setSubmitting(true);
    setError("");
    const payload: ManualTransactionCreateInput = {
      telegram_id: Number(telegramId),
      direction,
      amount: numericAmount,
      exchange_rate: numericRate,
      admin_bank_id: adminBankId,
      receiver_bank_name: receiver.bankName.trim(),
      receiver_account_number: direction === "buy" ? receiver.accountNumber.trim() : undefined,
      receiver_phone: direction === "sell" ? receiver.phone.trim() : undefined,
      receiver_card_number: direction === "sell" ? receiver.cardNumber.trim() : undefined,
      receiver_owner_name: receiver.ownerName.trim(),
      receipt_paths: receiptUrls,
      transaction_at: transactionAt ? new Date(`${transactionAt}:00+03:00`).toISOString() : undefined,
    };
    try {
      const result = await createManualTransaction(payload);
      setSuccess({ invoice: result.invoice, amount: result.converted_amount, currency: result.currency_to });
    } catch (submitError: any) {
      setError(submitError?.response?.data?.detail || "Гүйлгээ үүсгэхэд алдаа гарлаа.");
    } finally {
      setSubmitting(false);
    }
  };

  const reset = () => {
    setTelegramId("");
    setUser(null);
    setUserFound(null);
    setAmount("");
    setReceiptUrls([]);
    setReceiver({ ...EMPTY_RECEIVER });
    setTransactionAt("");
    setSuccess(null);
    setError("");
    setRateTouched(false);
  };

  if (success) {
    return (
      <div className="rounded-2xl border border-[#00C885]/30 bg-white p-6 text-center shadow-card font-['Montserrat']">
        <CheckCircle2 className="mx-auto mb-3 h-14 w-14 text-[#00C885]" />
        <h2 className="text-xl font-bold text-[#231F20]">Гүйлгээ амжилттай үүслээ</h2>
        <p className="mt-2 text-sm text-slate-600">Invoice: <span className="font-mono font-semibold">{success.invoice}</span></p>
        <p className="mt-1 text-sm text-slate-600">Шилжүүлэх дүн: {success.amount.toLocaleString()} {success.currency}</p>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <button onClick={onOpenInbox} className="rounded-xl bg-[#2D62EC] px-4 py-3 font-semibold text-white">Inbox харах</button>
          <button onClick={reset} className="rounded-xl border border-[#2D62EC] px-4 py-3 font-semibold text-[#2D62EC]">Дахин үүсгэх</button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 font-['Montserrat'] text-[#231F20]">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-card">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-[#2D62EC]" />
          <div>
            <h2 className="font-bold">Гараар гүйлгээ үүсгэх</h2>
            <p className="text-xs text-slate-500">Client-side алдаатай хүсэлтийг pending inbox-д сэргээнэ.</p>
          </div>
        </div>
      </div>

      {error && <div className="flex items-start gap-2 rounded-xl border border-[#FF3B57]/30 bg-[#FF3B57]/5 p-3 text-sm text-[#FF3B57]"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{error}</div>}

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-card">
        <label className="mb-2 block text-sm font-semibold">1. Telegram ID</label>
        <div className="flex gap-2">
          <input value={telegramId} onChange={(event) => setTelegramId(event.target.value.replace(/\D/g, ""))} onKeyDown={(event) => event.key === "Enter" && lookupUser()} placeholder="Жишээ: 1932946217" className="input-modern" inputMode="numeric" />
          <button onClick={lookupUser} disabled={lookupLoading} className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-[#2D62EC] px-4 py-3 font-semibold text-white disabled:opacity-50">
            {lookupLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Хайх
          </button>
        </div>
        {userFound === false && <p className="mt-3 rounded-lg bg-[#FF833B]/10 p-3 text-sm text-[#9A4B1F]">Хэрэглэгч олдсонгүй. Submit хийхэд зөвхөн Telegram ID-тай stub profile үүснэ.</p>}
        {user && <div className="mt-3 rounded-xl bg-[#2D62EC]/5 p-3 text-sm"><div className="flex items-center gap-2 font-semibold"><UserRound className="h-4 w-4 text-[#2D62EC]" />{user.last_name || ""} {user.first_name || "Нэргүй"}</div><div className="mt-2 grid gap-1 text-slate-600 sm:grid-cols-2"><span>ID: {user.id}</span><span>Утас: {user.phone || user.phone_intl || "—"}</span><span>Email: {user.email || "—"}</span><span>Төлөв: {user.verified ? "Баталгаажсан" : "Баталгаажаагүй"}</span></div></div>}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-card">
        <label className="mb-2 block text-sm font-semibold">2. Чиглэл ба ханш</label>
        <div className="grid gap-2 sm:grid-cols-2">
          {(["buy", "sell"] as Direction[]).map((value) => (
            <button key={value} onClick={() => { setDirection(value); setRateTouched(false); }} className={`rounded-xl border-2 p-3 text-left ${direction === value ? "border-[#2D62EC] bg-[#2D62EC]/5" : "border-slate-200"}`}>
              <div className="font-semibold">{value === "buy" ? "RUB → MNT" : "MNT → RUB"}</div>
              <div className="text-xs text-slate-500">{value === "buy" ? "Төгрөг авах" : "Рубль авах"}</div>
            </button>
          ))}
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-sm">Дүн ({sourceCurrency})<input value={amount} onChange={(event) => setAmount(event.target.value)} type="number" min="0" step="0.01" className="input-modern mt-1" /></label>
          <label className="text-sm">Гараар тохируулах ханш<input value={exchangeRate} onChange={(event) => { setExchangeRate(event.target.value); setRateTouched(true); }} type="number" min="0" step="0.0001" className="input-modern mt-1" /></label>
        </div>
        <div className="mt-3 rounded-xl bg-[#00C885]/10 p-3 text-sm">Тооцоолол: <strong>{convertedAmount > 0 ? convertedAmount.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "—"} {destinationCurrency}</strong></div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-card">
        <label className="mb-2 block text-sm font-semibold">3. Дансны мэдээлэл</label>
        <label className="text-sm">OYUNS хүлээн авах данс<select value={adminBankId} onChange={(event) => setAdminBankId(event.target.value)} className="input-modern mt-1"><option value="">Данс сонгох</option>{availableAccounts.map((account) => <option key={account.id} value={account.id}>{account.bank_name} · {account.account_number || account.card_number || "—"}{account.is_active ? "" : " (идэвхгүй)"}</option>)}</select></label>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-sm">Хүлээн авагч банк<input value={receiver.bankName} onChange={(event) => updateReceiver("bankName", event.target.value)} className="input-modern mt-1" /></label>
          <label className="text-sm">Эзэмшигчийн нэр<input value={receiver.ownerName} onChange={(event) => updateReceiver("ownerName", event.target.value)} className="input-modern mt-1" /></label>
          {direction === "buy" ? <label className="text-sm sm:col-span-2">MNT дансны дугаар<input value={receiver.accountNumber} onChange={(event) => updateReceiver("accountNumber", event.target.value)} className="input-modern mt-1" /></label> : <><label className="text-sm">RUB утас / SBP<input value={receiver.phone} onChange={(event) => updateReceiver("phone", event.target.value)} className="input-modern mt-1" /></label><label className="text-sm">Картын дугаар<input value={receiver.cardNumber} onChange={(event) => updateReceiver("cardNumber", event.target.value)} className="input-modern mt-1" /></label></>}
        </div>
        <label className="mt-3 block text-sm">Анхны хүсэлтийн цаг (Moscow, optional)<span className="mt-1 flex items-center gap-2"><Clock3 className="h-4 w-4 text-slate-400" /><input value={transactionAt} onChange={(event) => setTransactionAt(event.target.value)} type="datetime-local" className="input-modern" /></span></label>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-card">
        <label className="mb-2 block text-sm font-semibold">4. Төлбөрийн баримт</label>
        <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-[#2D62EC]/40 p-5 text-sm font-semibold text-[#2D62EC] hover:bg-[#2D62EC]/5"><Upload className="h-5 w-5" />{uploading ? "Upload хийж байна…" : "Зураг сонгох"}<input type="file" accept="image/*" multiple className="hidden" disabled={uploading} onChange={(event) => { void uploadReceipts(Array.from(event.target.files || [])); event.currentTarget.value = ""; }} /></label>
        {receiptUrls.length > 0 && <div className="mt-3 grid gap-2 sm:grid-cols-2">{receiptUrls.map((url, index) => <div key={url} className="flex items-center gap-2 rounded-lg bg-slate-50 p-2 text-xs"><FileImage className="h-4 w-4 text-[#2D62EC]" /><a href={url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-[#2D62EC]">Баримт {index + 1}</a><button onClick={() => setReceiptUrls((current) => current.filter((_, itemIndex) => itemIndex !== index))} className="text-[#FF3B57]" aria-label="Remove receipt"><Trash2 className="h-4 w-4" /></button></div>)}</div>}
      </section>

      <section className="rounded-2xl border border-[#2D62EC]/20 bg-[#2D62EC]/5 p-5">
        <div className="mb-3 text-sm font-semibold">Шалгах мэдээлэл</div>
        <div className="grid gap-2 text-sm sm:grid-cols-2"><span>Хэрэглэгч: {telegramId || "—"}</span><span>Чиглэл: {sourceCurrency} → {destinationCurrency}</span><span>Дүн: {amount || "—"} {sourceCurrency}</span><span>Ханш: {exchangeRate || "—"}</span><span>Очих дүн: {convertedAmount ? `${convertedAmount.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${destinationCurrency}` : "—"}</span><span>Баримт: {receiptUrls.length} файл</span></div>
      </section>

      <button onClick={submit} disabled={submitting || uploading} className="w-full rounded-xl bg-[#2D62EC] py-3 font-semibold text-white shadow-btn disabled:cursor-not-allowed disabled:opacity-50">{submitting ? <span className="inline-flex items-center gap-2"><RefreshCw className="h-4 w-4 animate-spin" /> Үүсгэж байна…</span> : "Pending хүсэлт үүсгэх"}</button>
    </div>
  );
}
