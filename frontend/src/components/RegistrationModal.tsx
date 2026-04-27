import { useState } from "react";
import {
  CreditCard,
  Building,
  CheckCircle2,
  Loader2,
  FileText,
  AlertCircle,
  Upload,
  X,
} from "lucide-react";
import { submitRegistration, RegistrationInput, requestPresign } from "../api";
import { useLang } from "../i18n/useLang";

// Bank name options
const RUB_BANKS = ["Сбербанк", "Т-Банк", "Альфа-Банк", "ВТБ", "Райффайзен банк", "Газпромбанк", "ПСБ", "Россельхозбанк", "Бусад"];
const MNT_BANKS = ["Хаан банк", "Голомт банк", "М банк", "Хас банк", "Худалдаа хөгжлийн банк", "Ариг банк", "Богд банк", "Төрийн банк", "Капитрон банк", "Бусад"];

// Format utility functions
// Russian phone: +7 XXX XXX XX XX (10 digits after +7)
export const formatRussianPhone = (value: string): string => {
  // Extract only digits
  const digits = value.replace(/\D/g, '');
  // Remove leading 7 or 8 if present (we'll add +7 prefix)
  const cleanDigits = digits.startsWith('7') ? digits.slice(1) : digits.startsWith('8') ? digits.slice(1) : digits;
  // Limit to 10 digits
  const limitedDigits = cleanDigits.slice(0, 10);
  
  if (limitedDigits.length === 0) return '+7 ';
  
  let formatted = '+7 ';
  if (limitedDigits.length > 0) formatted += limitedDigits.slice(0, 3);
  if (limitedDigits.length > 3) formatted += ' ' + limitedDigits.slice(3, 6);
  if (limitedDigits.length > 6) formatted += ' ' + limitedDigits.slice(6, 8);
  if (limitedDigits.length > 8) formatted += ' ' + limitedDigits.slice(8, 10);
  
  return formatted;
};

// Card number: 16 digits only, formatted as XXXX XXXX XXXX XXXX
export const formatCardNumber = (value: string): string => {
  const digits = value.replace(/\D/g, '').slice(0, 16);
  const parts = digits.match(/.{1,4}/g) || [];
  return parts.join(' ');
};

// IBAN: MN XX XXXX XX XXXXXXXXXX (MN + 18 digits)
export const formatIBAN = (value: string): string => {
  // Remove all non-alphanumeric
  const clean = value.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  
  // If starts with MN, extract digits after MN
  let digits: string;
  if (clean.startsWith('MN')) {
    digits = clean.slice(2).replace(/\D/g, '');
  } else {
    digits = clean.replace(/\D/g, '');
  }
  
  // Limit to 18 digits
  const limitedDigits = digits.slice(0, 18);
  
  if (limitedDigits.length === 0) return 'MN ';
  
  let formatted = 'MN ';
  if (limitedDigits.length > 0) formatted += limitedDigits.slice(0, 2);
  if (limitedDigits.length > 2) formatted += ' ' + limitedDigits.slice(2, 6);
  if (limitedDigits.length > 6) formatted += ' ' + limitedDigits.slice(6, 8);
  if (limitedDigits.length > 8) formatted += ' ' + limitedDigits.slice(8, 18);
  
  return formatted;
};

// Mongolian phone: +976 XXXX XXXX (8 digits after +976)
export const formatMongolianPhone = (value: string): string => {
  // Extract only digits
  const digits = value.replace(/\D/g, '');
  // Remove leading 976 if present
  const cleanDigits = digits.startsWith('976') ? digits.slice(3) : digits;
  // Limit to 8 digits
  const limitedDigits = cleanDigits.slice(0, 8);
  
  if (limitedDigits.length === 0) return '+976 ';
  
  let formatted = '+976 ';
  if (limitedDigits.length > 0) formatted += limitedDigits.slice(0, 4);
  if (limitedDigits.length > 4) formatted += ' ' + limitedDigits.slice(4, 8);
  
  return formatted;
};

// Get raw value for submission (remove formatting)
export const getRawRussianPhone = (formatted: string): string => {
  const digits = formatted.replace(/\D/g, '');
  return digits.startsWith('7') ? '+' + digits : '+7' + digits;
};

export const getRawCardNumber = (formatted: string): string => {
  return formatted.replace(/\s/g, '');
};

export const getRawIBAN = (formatted: string): string => {
  return formatted.replace(/\s/g, '');
};

export const getRawMongolianPhone = (formatted: string): string => {
  const digits = formatted.replace(/\D/g, '');
  return digits.startsWith('976') ? '+' + digits : '+976' + digits;
};

interface Props {
  onRegistered: () => void;
  onClose?: () => void;
}

export function RegistrationModal({ onRegistered, onClose }: Props) {
  const { t } = useLang();
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  // RUB bank info - optional
  const [hasRubBank, setHasRubBank] = useState(false);
  const [rubBankName, setRubBankName] = useState("");
  const [rubBankNameOther, setRubBankNameOther] = useState("");
  const [rubPhoneSbp, setRubPhoneSbp] = useState("");
  const [rubCardNumber, setRubCardNumber] = useState("");
  const [rubOwnerName, setRubOwnerName] = useState("");

  // MNT bank info
  const [mntBankName, setMntBankName] = useState("");
  const [mntBankNameOther, setMntBankNameOther] = useState("");
  const [mntAccountNumber, setMntAccountNumber] = useState("");
  const [mntOwnerName, setMntOwnerName] = useState("");
  const [mntPhone, setMntPhone] = useState(""); // Mongolian phone number

  // Passport
  const [passportUrl, setPassportUrl] = useState("");

  const handlePassportUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setUploading(true);
      setError("");
      // Get file extension and generate a safe filename (avoid Cyrillic and special characters)
      const ext = file.name.split('.').pop() || 'jpg';
      const safeFilename = `passport_${Date.now()}.${ext}`;
      const path = `passport/${safeFilename}`;
      const presigned = await requestPresign({ bucket: "bills", path });
      await fetch(presigned.upload_url, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type },
      });
      setPassportUrl(presigned.public_url);
    } catch (err) {
      console.error("Passport upload error:", err);
      setError(t("reg.passport_error"));
    } finally {
      setUploading(false);
    }
  };

  // Get actual bank names (handle "Other" option)
  const getActualRubBankName = () => {
    if (rubBankName === "Бусад") return rubBankNameOther.trim();
    return rubBankName;
  };

  const getActualMntBankName = () => {
    if (mntBankName === "Бусад") return mntBankNameOther.trim();
    return mntBankName;
  };

  const isFormValid = () => {
    // MNT bank info required
    const actualMntBankName = getActualMntBankName();
    if (!actualMntBankName || !mntAccountNumber.trim() || !mntOwnerName.trim() || !mntPhone.trim()) return false;

    // Passport required
    if (!passportUrl) return false;

    // If RUB bank is enabled, all RUB fields are required
    if (hasRubBank) {
      const actualRubBankName = getActualRubBankName();
      if (!actualRubBankName || !rubPhoneSbp.trim() || !rubCardNumber.trim() || !rubOwnerName.trim()) return false;
    }

    return true;
  };

  const handleSubmit = async () => {
    if (!isFormValid()) {
      setError(t("reg.fill_all"));
      return;
    }

    try {
      setLoading(true);
      setError("");

      const payload: RegistrationInput = {
        // RUB bank info - empty if not enabled
        rub_bank_name: hasRubBank ? getActualRubBankName() : "",
        rub_phone_sbp: hasRubBank ? rubPhoneSbp.trim() : "",
        rub_card_number: hasRubBank ? rubCardNumber.trim() : "",
        rub_owner_name: hasRubBank ? rubOwnerName.trim() : "",
        // MNT bank info
        mnt_bank_name: getActualMntBankName(),
        mnt_account_number: mntAccountNumber.trim(),
        mnt_owner_name: mntOwnerName.trim(),
        // Store just the 8 digits of Mongolian phone (remove +976 and formatting)
        mnt_phone: mntPhone.replace(/\D/g, '').replace(/^976/, '').slice(0, 8),
        passport_storage_url: passportUrl,
      };

      await submitRegistration(payload);
      onRegistered();
    } catch (err) {
      console.error("Registration error:", err);
      setError(t("reg.submit_error"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[100] p-4 overflow-auto">
      <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl my-4">
        {/* Header */}
        <div className="bg-gradient-to-r from-maroon-600 to-maroon-500 p-5 text-white rounded-t-2xl">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center">
                <FileText className="w-6 h-6" />
              </div>
              <div>
                <h2 className="text-xl font-bold">{t("reg.kyc_title")}</h2>
                <p className="text-sm text-white/80">{t("reg.kyc_subtitle")}</p>
              </div>
            </div>
            {onClose && (
              <button
                onClick={onClose}
                className="p-2 rounded-full hover:bg-white/20 transition"
              >
                <X className="w-5 h-5" />
              </button>
            )}
          </div>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4 max-h-[70vh] overflow-auto">
          {/* RUB Bank Section - Optional */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-maroon-700 font-semibold">
                <CreditCard className="w-4 h-4" />
                <span>{t("reg.rub_bank_section")}</span>
              </div>
            </div>

            {/* Checkbox to enable RUB bank */}
            <label className="flex items-center gap-3 cursor-pointer p-2 rounded-lg bg-slate-50 hover:bg-slate-100 transition">
              <input
                type="checkbox"
                checked={hasRubBank}
                onChange={(e) => setHasRubBank(e.target.checked)}
                className="w-5 h-5 rounded border-slate-300 text-maroon-600 focus:ring-maroon-500"
              />
              <span className="text-sm text-slate-600">
                {t("reg.has_rub_bank")}
              </span>
            </label>

            {hasRubBank && (
              <div className="space-y-3 pl-2 border-l-2 border-maroon-200">
                <div>
                  <label className="text-xs text-slate-500">{t("reg.bank_name")} <span className="text-red-500">*</span></label>
                  <select
                    value={rubBankName}
                    onChange={(e) => setRubBankName(e.target.value)}
                    className="w-full rounded-lg border border-maroon-200 p-2.5 text-sm bg-white"
                  >
                    <option value="">{t("reg.select_bank")}</option>
                    {RUB_BANKS.map((bank) => (
                      <option key={bank} value={bank}>{bank === "Бусад" ? t("txn.bank_other") : bank}</option>
                    ))}
                  </select>
                  {rubBankName === "Бусад" && (
                    <input
                      type="text"
                      value={rubBankNameOther}
                      onChange={(e) => setRubBankNameOther(e.target.value)}
                      className="w-full rounded-lg border border-maroon-200 p-2.5 text-sm mt-2"
                      placeholder={t("reg.bank_name_placeholder")}
                    />
                  )}
                </div>

                <div>
                  <label className="text-xs text-slate-500">{t("reg.sbp_phone")} <span className="text-red-500">*</span></label>
                  <input
                    type="tel"
                    value={rubPhoneSbp}
                    onChange={(e) => setRubPhoneSbp(formatRussianPhone(e.target.value))}
                    className="w-full rounded-lg border border-maroon-200 p-2.5 text-sm"
                    placeholder="+7 XXX XXX XX XX"
                  />
                </div>

                <div>
                  <label className="text-xs text-slate-500">{t("reg.card_number")} <span className="text-red-500">*</span></label>
                  <input
                    type="text"
                    value={rubCardNumber}
                    onChange={(e) => setRubCardNumber(formatCardNumber(e.target.value))}
                    className="w-full rounded-lg border border-maroon-200 p-2.5 text-sm"
                    placeholder="XXXX XXXX XXXX XXXX"
                    maxLength={19}
                  />
                </div>

                <div>
                  <label className="text-xs text-slate-500">{t("reg.owner_name")} <span className="text-red-500">*</span></label>
                  <input
                    type="text"
                    value={rubOwnerName}
                    onChange={(e) => setRubOwnerName(e.target.value)}
                    className="w-full rounded-lg border border-maroon-200 p-2.5 text-sm"
                    placeholder="IVAN IVANOV"
                  />
                </div>
              </div>
            )}
          </div>

          {/* MNT Bank Section */}
          <div className="space-y-3 pt-3 border-t border-slate-100">
            <div className="flex items-center gap-2 text-maroon-700 font-semibold">
              <Building className="w-4 h-4" />
              <span>{t("reg.mnt_bank_section")}</span>
            </div>

            <div>
              <label className="text-xs text-slate-500">{t("reg.bank_name")} <span className="text-red-500">*</span></label>
              <select
                value={mntBankName}
                onChange={(e) => setMntBankName(e.target.value)}
                className="w-full rounded-lg border border-maroon-200 p-2.5 text-sm bg-white"
              >
                <option value="">{t("reg.select_bank")}</option>
                {MNT_BANKS.map((bank) => (
                  <option key={bank} value={bank}>{bank === "Бусад" ? t("txn.bank_other") : bank}</option>
                ))}
              </select>
              {mntBankName === "Бусад" && (
                <input
                  type="text"
                  value={mntBankNameOther}
                  onChange={(e) => setMntBankNameOther(e.target.value)}
                  className="w-full rounded-lg border border-maroon-200 p-2.5 text-sm mt-2"
                  placeholder={t("reg.bank_name_placeholder")}
                />
              )}
            </div>

            <div>
              <label className="text-xs text-slate-500">{t("reg.iban")} <span className="text-red-500">*</span></label>
              <input
                type="text"
                value={mntAccountNumber}
                onChange={(e) => setMntAccountNumber(formatIBAN(e.target.value))}
                className="w-full rounded-lg border border-maroon-200 p-2.5 text-sm"
                placeholder="MN XX XXXX XX XXXXXXXXXX"
              />
            </div>

            <div>
              <label className="text-xs text-slate-500">{t("reg.owner_name")} <span className="text-red-500">*</span></label>
              <input
                type="text"
                value={mntOwnerName}
                onChange={(e) => setMntOwnerName(e.target.value)}
                className="w-full rounded-lg border border-maroon-200 p-2.5 text-sm"
                placeholder={t("ef.placeholder_mnt_owner").toUpperCase()}
              />
            </div>

            <div>
              <label className="text-xs text-slate-500">{t("reg.mn_phone")} <span className="text-red-500">*</span></label>
              <input
                type="tel"
                value={mntPhone}
                onChange={(e) => setMntPhone(formatMongolianPhone(e.target.value))}
                className="w-full rounded-lg border border-maroon-200 p-2.5 text-sm"
                placeholder="+976 XXXX XXXX"
              />
            </div>
          </div>

          {/* Passport Upload Section */}
          <div className="space-y-3 pt-3 border-t border-slate-100">
            <div className="flex items-center gap-2 text-maroon-700 font-semibold">
              <FileText className="w-4 h-4" />
              <span>{t("reg.passport_section")}</span>
            </div>

            <div>
              <label className="text-xs text-slate-500">{t("reg.passport_upload")} <span className="text-red-500">*</span></label>
              <div className="mt-1">
                {passportUrl ? (
                  <div className="flex items-center gap-2 p-2 bg-green-50 border border-green-200 rounded-lg">
                    <CheckCircle2 className="w-5 h-5 text-green-600" />
                    <span className="text-sm text-green-700">{t("reg.passport_success")}</span>
                    <button
                      type="button"
                      onClick={() => setPassportUrl("")}
                      className="ml-auto text-xs text-maroon-600 hover:underline"
                    >
                      {t("reg.passport_change")}
                    </button>
                  </div>
                ) : (
                  <label className="flex items-center justify-center gap-2 p-4 border-2 border-dashed border-maroon-300 rounded-lg cursor-pointer hover:bg-maroon-50 transition">
                    {uploading ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin text-maroon-600" />
                        <span className="text-sm text-maroon-600">{t("reg.passport_uploading")}</span>
                      </>
                    ) : (
                      <>
                        <Upload className="w-5 h-5 text-maroon-600" />
                        <span className="text-sm text-maroon-600">{t("reg.passport_upload_prompt")}</span>
                      </>
                    )}
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handlePassportUpload}
                      className="hidden"
                      disabled={uploading}
                    />
                  </label>
                )}
              </div>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}

          {/* Submit Button */}
          <button
            onClick={handleSubmit}
            disabled={loading || !isFormValid()}
            className="w-full flex items-center justify-center gap-2 py-4 rounded-xl bg-maroon-600 text-white font-bold text-lg hover:bg-maroon-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                {t("reg.submitting")}
              </>
            ) : (
              <>
                <CheckCircle2 className="w-5 h-5" />
                {t("reg.kyc_submit")}
              </>
            )}
          </button>

          <p className="text-xs text-center text-slate-400">
            {t("reg.kyc_footer_note")}
          </p>
        </div>
      </div>
    </div>
  );
}
