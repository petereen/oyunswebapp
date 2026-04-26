import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  Copy,
  Loader2,
  Smartphone,
  Upload,
  X,
} from "lucide-react";
import {
  AdminBankAccount,
  createPhoneTopup,
  fetchAdminBankAccounts,
  requestPresign,
} from "../api";
import { useLang } from "../i18n/useLang";

interface Props {
  sellRate: number;
  onBack: () => void;
  onSuccess: () => void;
}

const TELECOM_COMPANIES = ["МТС", "Билайн", "Мегафон", "Теле2", "Yota"];

function sanitizePhone(phone: string) {
  const cleaned = phone.replace(/[^\d+]/g, "");
  if (cleaned.startsWith("+")) {
    return `+${cleaned.slice(1).replace(/\+/g, "")}`;
  }
  return cleaned.replace(/\+/g, "");
}

function isValidPhone(phone: string) {
  const normalized = sanitizePhone(phone);
  const digitsOnly = normalized.startsWith("+") ? normalized.slice(1) : normalized;
  return digitsOnly.length >= 10 && /^\d+$/.test(digitsOnly);
}

function formatDisplayAmount(amount: number) {
  return amount.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export function TopupFlow({ sellRate, onBack, onSuccess }: Props) {
  const { t } = useLang();

  const [step, setStep] = useState(0);
  const [amountRub, setAmountRub] = useState("");
  const [phone, setPhone] = useState("");
  const [selectedTelecom, setSelectedTelecom] = useState("");
  const [customTelecom, setCustomTelecom] = useState("");
  const [adminBanks, setAdminBanks] = useState<AdminBankAccount[]>([]);
  const [selectedBankId, setSelectedBankId] = useState<string>("");
  const [invoiceId, setInvoiceId] = useState("");
  const [receiptUrls, setReceiptUrls] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [successInvoice, setSuccessInvoice] = useState("");
  const [copied, setCopied] = useState("");

  useEffect(() => {
    fetchAdminBankAccounts()
      .then((res) => setAdminBanks(res.accounts || []))
      .catch(() => setAdminBanks([]));
  }, []);

  const availableBanks = useMemo(
    () => adminBanks.filter((bank) => bank.currency === "MNT" && bank.is_active),
    [adminBanks],
  );

  useEffect(() => {
    if (!selectedBankId && availableBanks.length > 0) {
      setSelectedBankId(String(availableBanks[0].id));
    }
  }, [availableBanks, selectedBankId]);

  useEffect(() => {
    if (step === 3 && !invoiceId) {
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
      setInvoiceId(`${year}${month}${day}-${hours}${minutes}${seconds}-${random}`);
    }
  }, [step, invoiceId]);

  const parsedAmountRub = useMemo(() => {
    const digits = amountRub.replace(/\D/g, "");
    return digits ? Number.parseInt(digits, 10) : 0;
  }, [amountRub]);

  const normalizedPhone = useMemo(() => sanitizePhone(phone), [phone]);
  const telecom = selectedTelecom === "custom" ? customTelecom.trim() : selectedTelecom;
  const payableMnt = useMemo(() => Number((parsedAmountRub * sellRate).toFixed(2)), [parsedAmountRub, sellRate]);
  const selectedBank = useMemo(
    () => availableBanks.find((bank) => String(bank.id) === selectedBankId) || null,
    [availableBanks, selectedBankId],
  );

  const handleCopy = async (value: string, key: string) => {
    try {
      await navigator.clipboard.writeText(value.replace(/\s/g, ""));
      setCopied(key);
      setTimeout(() => setCopied(""), 2000);
    } catch {
      setError(t("topup.copy_failed"));
    }
  };

  const handleUpload = async (files: FileList) => {
    if (!files.length) return;
    setUploading(true);
    setError("");
    try {
      for (const file of Array.from(files)) {
        const path = `phone-topup/${invoiceId || Date.now()}-${file.name}`;
        const presigned = await requestPresign({ bucket: "bills", path });
        await fetch(presigned.upload_url, {
          method: "PUT",
          body: file,
          headers: { "Content-Type": file.type },
        });
        setReceiptUrls((prev) => [...prev, presigned.public_url]);
      }
    } catch {
      setError(t("topup.upload_error"));
    } finally {
      setUploading(false);
    }
  };

  const removeReceipt = (index: number) => {
    setReceiptUrls((prev) => prev.filter((_, currentIndex) => currentIndex !== index));
  };

  const handleSubmit = async () => {
    if (!parsedAmountRub || !isValidPhone(normalizedPhone) || !telecom || !selectedBank || receiptUrls.length === 0) {
      setError(t("topup.fill_all"));
      return;
    }

    try {
      setLoading(true);
      setError("");
      const response = await createPhoneTopup({
        rub_amount: parsedAmountRub,
        sell_rate: sellRate,
        phone: normalizedPhone,
        telecom,
        receipt_path: receiptUrls[0],
        receipt_paths: receiptUrls,
        invoice: invoiceId,
        admin_bank_id: Number(selectedBank.id),
      });
      setSuccessInvoice(response.invoice);
      setStep(4);
    } catch {
      setError(t("topup.submit_error"));
    } finally {
      setLoading(false);
    }
  };

  const handleBack = () => {
    if (step === 0) {
      onBack();
      return;
    }
    setError("");
    setStep((currentStep) => Math.max(0, currentStep - 1));
  };

  return (
    <div className="glass-card p-5 rounded-2xl border border-white/60 flex flex-col gap-4">
      <div className="flex items-center gap-2">
        {step < 4 && (
          <button onClick={handleBack} className="p-2 hover:bg-sky-100 rounded-full">
            <ArrowLeft className="w-5 h-5 text-sky-700" />
          </button>
        )}
        <div className="flex items-center gap-2 text-sky-700 font-semibold">
          <Smartphone className="w-5 h-5" /> {t("topup.title")}
        </div>
        {step < 4 && (
          <button onClick={onBack} className="ml-auto text-sm text-slate-500 hover:text-sky-700">
            {t("topup.cancel")}
          </button>
        )}
      </div>

      {error && <div className="text-sm text-red-600">{error}</div>}

      {step === 0 && (
        <div className="flex flex-col gap-4 animate-fadeIn">
          <div>
            <div className="text-lg font-semibold text-dark-800 dark:text-ivory-200">{t("topup.amount_title")}</div>
            <div className="text-sm text-dark-600 dark:text-ivory-300 mt-1">{t("topup.amount_desc")}</div>
          </div>

          <label className="flex flex-col gap-2">
            <span className="text-sm font-medium text-dark-700 dark:text-ivory-200">{t("topup.amount_label")}</span>
            <input
              inputMode="numeric"
              value={amountRub}
              onChange={(event) => {
                setAmountRub(event.target.value.replace(/\D/g, ""));
                setError("");
              }}
              placeholder={t("topup.amount_placeholder")}
              className="rounded-2xl border border-sky-200 bg-white/80 px-4 py-3 text-lg font-semibold text-dark-800 outline-none focus:border-sky-400"
            />
          </label>

          <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900">
            <div>{t("topup.amount_hint", { rate: sellRate.toFixed(2) })}</div>
            <div className="mt-1 font-semibold">
              {t("topup.payable_preview", { amount: formatDisplayAmount(payableMnt) })}
            </div>
          </div>

          <button
            onClick={() => {
              if (!parsedAmountRub) {
                setError(t("topup.invalid_amount"));
                return;
              }
              setStep(1);
            }}
            className="rounded-2xl bg-sky-600 px-4 py-3 font-semibold text-white hover:bg-sky-700"
          >
            {t("topup.continue")}
          </button>
        </div>
      )}

      {step === 1 && (
        <div className="flex flex-col gap-4 animate-fadeIn">
          <div>
            <div className="text-lg font-semibold text-dark-800 dark:text-ivory-200">{t("topup.phone_title")}</div>
            <div className="text-sm text-dark-600 dark:text-ivory-300 mt-1">{t("topup.phone_desc")}</div>
          </div>

          <label className="flex flex-col gap-2">
            <span className="text-sm font-medium text-dark-700 dark:text-ivory-200">{t("topup.phone_label")}</span>
            <input
              inputMode="tel"
              value={phone}
              onChange={(event) => {
                setPhone(event.target.value);
                setError("");
              }}
              placeholder={t("topup.phone_placeholder")}
              className="rounded-2xl border border-sky-200 bg-white/80 px-4 py-3 text-lg text-dark-800 outline-none focus:border-sky-400"
            />
          </label>

          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
            {t("topup.phone_hint")}
          </div>

          <button
            onClick={() => {
              if (!isValidPhone(normalizedPhone)) {
                setError(t("topup.invalid_phone"));
                return;
              }
              setStep(2);
            }}
            className="rounded-2xl bg-sky-600 px-4 py-3 font-semibold text-white hover:bg-sky-700"
          >
            {t("topup.continue")}
          </button>
        </div>
      )}

      {step === 2 && (
        <div className="flex flex-col gap-4 animate-fadeIn">
          <div>
            <div className="text-lg font-semibold text-dark-800 dark:text-ivory-200">{t("topup.operator_title")}</div>
            <div className="text-sm text-dark-600 dark:text-ivory-300 mt-1">{t("topup.operator_desc")}</div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {TELECOM_COMPANIES.map((company) => {
              const isActive = selectedTelecom === company;
              return (
                <button
                  key={company}
                  onClick={() => {
                    setSelectedTelecom(company);
                    setError("");
                  }}
                  className={`rounded-2xl border px-4 py-3 text-sm font-semibold transition ${isActive ? "border-sky-500 bg-sky-50 text-sky-700" : "border-slate-200 bg-white text-slate-700 hover:border-sky-300 hover:text-sky-700"}`}
                >
                  {company}
                </button>
              );
            })}
            <button
              onClick={() => {
                setSelectedTelecom("custom");
                setError("");
              }}
              className={`col-span-2 rounded-2xl border px-4 py-3 text-sm font-semibold transition ${selectedTelecom === "custom" ? "border-sky-500 bg-sky-50 text-sky-700" : "border-slate-200 bg-white text-slate-700 hover:border-sky-300 hover:text-sky-700"}`}
            >
              {t("topup.custom_operator")}
            </button>
          </div>

          {selectedTelecom === "custom" && (
            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium text-dark-700 dark:text-ivory-200">{t("topup.custom_operator")}</span>
              <input
                value={customTelecom}
                onChange={(event) => {
                  setCustomTelecom(event.target.value);
                  setError("");
                }}
                placeholder={t("topup.custom_operator_placeholder")}
                className="rounded-2xl border border-sky-200 bg-white/80 px-4 py-3 text-dark-800 outline-none focus:border-sky-400"
              />
            </label>
          )}

          <button
            onClick={() => {
              if (!telecom) {
                setError(t("topup.operator_required"));
                return;
              }
              setStep(3);
            }}
            className="rounded-2xl bg-sky-600 px-4 py-3 font-semibold text-white hover:bg-sky-700"
          >
            {t("topup.continue")}
          </button>
        </div>
      )}

      {step === 3 && (
        <div className="flex flex-col gap-4 animate-fadeIn">
          <div>
            <div className="text-lg font-semibold text-dark-800 dark:text-ivory-200">{t("topup.payment_title")}</div>
            <div className="text-sm text-dark-600 dark:text-ivory-300 mt-1">{t("topup.payment_desc")}</div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4">
              <div className="text-xs uppercase tracking-wide text-sky-700">{t("topup.topup_amount")}</div>
              <div className="mt-1 text-xl font-bold text-sky-900">{formatDisplayAmount(parsedAmountRub)} RUB</div>
            </div>
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
              <div className="text-xs uppercase tracking-wide text-emerald-700">{t("topup.payable_amount")}</div>
              <div className="mt-1 text-xl font-bold text-emerald-900">{formatDisplayAmount(payableMnt)} MNT</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="text-xs uppercase tracking-wide text-slate-500">{t("topup.phone_value")}</div>
              <div className="mt-1 text-base font-semibold text-dark-800">{normalizedPhone}</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="text-xs uppercase tracking-wide text-slate-500">{t("topup.operator_value")}</div>
              <div className="mt-1 text-base font-semibold text-dark-800">{telecom}</div>
            </div>
          </div>

          <div className="rounded-2xl border border-maroon-200 bg-white p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs text-slate-500">{t("topup.payment_account")}</div>
                <div className="text-sm text-slate-600 mt-1">{t("topup.invoice_note")}</div>
              </div>
              <button
                onClick={() => handleCopy(invoiceId, "invoice")}
                className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
              >
                {copied === "invoice" ? <CheckCircle2 className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
                {invoiceId}
              </button>
            </div>

            {availableBanks.length > 1 && (
              <select
                value={selectedBankId}
                onChange={(event) => setSelectedBankId(event.target.value)}
                className="mt-4 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-dark-800 outline-none focus:border-sky-400"
              >
                {availableBanks.map((bank) => (
                  <option key={bank.id} value={String(bank.id)}>
                    {bank.bank_name} - {bank.owner_name}
                  </option>
                ))}
              </select>
            )}

            {!selectedBank && (
              <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700">
                {t("topup.no_active_bank")}
              </div>
            )}

            {selectedBank && (
              <div className="mt-4 space-y-3">
                <div className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
                  <div>
                    <div className="text-xs text-slate-500">{t("topup.bank_name")}</div>
                    <div className="font-semibold text-dark-800">{selectedBank.bank_name}</div>
                  </div>
                  <button onClick={() => handleCopy(selectedBank.bank_name, "bank")} className="p-2 rounded-lg hover:bg-white">
                    {copied === "bank" ? <CheckCircle2 className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4 text-slate-500" />}
                  </button>
                </div>
                <div className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
                  <div>
                    <div className="text-xs text-slate-500">{t("topup.owner_name")}</div>
                    <div className="font-semibold text-dark-800">{selectedBank.owner_name}</div>
                  </div>
                  <button onClick={() => handleCopy(selectedBank.owner_name, "owner")} className="p-2 rounded-lg hover:bg-white">
                    {copied === "owner" ? <CheckCircle2 className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4 text-slate-500" />}
                  </button>
                </div>
                {selectedBank.account_number && (
                  <div className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
                    <div>
                      <div className="text-xs text-slate-500">{t("topup.account_number")}</div>
                      <div className="font-semibold text-dark-800">{selectedBank.account_number}</div>
                    </div>
                    <button onClick={() => handleCopy(selectedBank.account_number, "account")} className="p-2 rounded-lg hover:bg-white">
                      {copied === "account" ? <CheckCircle2 className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4 text-slate-500" />}
                    </button>
                  </div>
                )}
                {selectedBank.phone && (
                  <div className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
                    <div>
                      <div className="text-xs text-slate-500">{t("topup.bank_phone")}</div>
                      <div className="font-semibold text-dark-800">{selectedBank.phone}</div>
                    </div>
                    <button onClick={() => handleCopy(selectedBank.phone || "", "bank-phone")} className="p-2 rounded-lg hover:bg-white">
                      {copied === "bank-phone" ? <CheckCircle2 className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4 text-slate-500" />}
                    </button>
                  </div>
                )}
                {selectedBank.card_number && (
                  <div className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
                    <div>
                      <div className="text-xs text-slate-500">{t("topup.card_number")}</div>
                      <div className="font-semibold text-dark-800">{selectedBank.card_number}</div>
                    </div>
                    <button onClick={() => handleCopy(selectedBank.card_number || "", "card")} className="p-2 rounded-lg hover:bg-white">
                      {copied === "card" ? <CheckCircle2 className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4 text-slate-500" />}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4">
            <div className="text-sm font-semibold text-sky-900">{t("topup.receipt_label")}</div>
            {receiptUrls.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {receiptUrls.map((url, index) => (
                  <div key={url} className="relative">
                    <img src={url} alt={`Receipt ${index + 1}`} className="h-20 w-20 rounded-xl border border-sky-200 object-cover bg-white" />
                    <button
                      onClick={() => removeReceipt(index)}
                      className="absolute -right-2 -top-2 rounded-full bg-red-500 p-1 text-white hover:bg-red-600"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <label className="mt-3 flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-sky-300 bg-white/80 px-4 py-5 text-center hover:bg-white">
              {uploading ? <Loader2 className="w-5 h-5 animate-spin text-sky-600" /> : <Upload className="w-5 h-5 text-sky-600" />}
              <span className="mt-2 text-sm font-medium text-sky-900">
                {uploading
                  ? t("topup.uploading")
                  : receiptUrls.length > 0
                    ? t("topup.add_more_receipts")
                    : t("topup.upload_receipt")}
              </span>
              <span className="mt-1 text-xs text-sky-700">{t("topup.receipts_attached", { count: receiptUrls.length })}</span>
              <input
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(event) => {
                  if (event.target.files) {
                    void handleUpload(event.target.files);
                  }
                }}
                disabled={uploading}
              />
            </label>
          </div>

          <button
            onClick={handleSubmit}
            disabled={loading || uploading || !selectedBank || receiptUrls.length === 0}
            className="rounded-2xl bg-sky-600 px-4 py-3 font-semibold text-white hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? t("topup.submitting") : t("topup.submit")}
          </button>
        </div>
      )}

      {step === 4 && (
        <div className="flex flex-col items-center gap-4 py-8 text-center animate-fadeIn">
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-emerald-100">
            <CheckCircle2 className="w-10 h-10 text-emerald-600" />
          </div>
          <div>
            <div className="text-xl font-semibold text-dark-800 dark:text-ivory-200">{t("topup.success_title")}</div>
            <div className="mt-2 text-sm text-dark-600 dark:text-ivory-300">{t("topup.success_desc")}</div>
          </div>
          <div className="w-full rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-left">
            <div className="text-xs uppercase tracking-wide text-emerald-700">{t("topup.success_invoice")}</div>
            <div className="mt-1 font-mono text-lg font-semibold text-emerald-900">{successInvoice}</div>
            <div className="mt-3 text-sm text-emerald-800">{formatDisplayAmount(parsedAmountRub)} RUB • {formatDisplayAmount(payableMnt)} MNT</div>
            <div className="mt-1 text-sm text-emerald-800">{normalizedPhone} • {telecom}</div>
          </div>
          <button
            onClick={onSuccess}
            className="rounded-2xl bg-sky-600 px-5 py-3 font-semibold text-white hover:bg-sky-700"
          >
            {t("topup.finish")}
          </button>
        </div>
      )}
    </div>
  );
}