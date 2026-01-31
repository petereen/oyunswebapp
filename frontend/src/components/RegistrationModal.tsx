import { useState } from "react";
import {
  User,
  CreditCard,
  Building,
  CheckCircle2,
  Loader2,
  FileText,
  AlertCircle,
  Upload,
  X,
  ExternalLink,
  Mail,
} from "lucide-react";
import { submitRegistration, RegistrationInput, requestPresign } from "../api";

// Bank name options
const RUB_BANKS = ["Сбербанк", "Т-Банк", "Альфа-Банк", "ВТБ", "Райффайзен банк", "Газпромбанк", "ПСБ", "Россельхозбанк", "Бусад"];
const MNT_BANKS = ["Хаан банк", "Голомт банк", "М банк", "Хас банк", "Худалдаа хөгжлийн банк", "Ариг банк", "Богд банк", "Төрийн банк", "Капитрон банк", "Бусад"];

const TERMS_URL = "https://oyunsfinance.com/oyuns-aio-telegram-bot-%d1%85%d1%8d%d1%80%d1%8d%d0%b3%d0%bb%d1%8d%d0%b3%d1%87%d0%b8%d0%b9%d0%bd-%d0%b3%d1%8d%d1%80%d1%8d%d1%8d/";

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
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  // Personal info
  const [lastName, setLastName] = useState("");
  const [firstName, setFirstName] = useState("");
  const [email, setEmail] = useState("");

  // Terms agreement
  const [agreedTerms, setAgreedTerms] = useState(false);

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
      setError("Паспорт зураг оруулахад алдаа гарлаа");
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
    // Personal info required (including email)
    if (!lastName.trim() || !firstName.trim() || !email.trim()) return false;
    
    // Terms agreement required
    if (!agreedTerms) return false;

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
      if (!agreedTerms) {
        setError("Хэрэглэгчийн гэрээг зөвшөөрнө үү");
      } else {
        setError("Бүх талбарыг бөглөнө үү");
      }
      return;
    }

    try {
      setLoading(true);
      setError("");

      const payload: RegistrationInput = {
        last_name: lastName.trim(),
        first_name: firstName.trim(),
        email: email.trim() || undefined,
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
      setError("Бүртгэл илгээхэд алдаа гарлаа. Дахин оролдоно уу.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[100] p-4 overflow-auto">
      <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl my-4">
        {/* Header */}
        <div className="bg-gradient-to-r from-ocean-600 to-ocean-500 p-5 text-white rounded-t-2xl">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center">
                <FileText className="w-6 h-6" />
              </div>
              <div>
                <h2 className="text-xl font-bold">OYUNS FINANCE ХЭРЭГЛЭГЧИЙН БҮРТГЭЛ</h2>
                <p className="text-sm text-white/80">Та манай үйлчилгээг ашиглахын өмнө бүртгүүлнэ үү</p>
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
          {/* Personal Info Section */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-ocean-700 font-semibold">
              <User className="w-4 h-4" />
              <span>Хувийн мэдээлэл</span>
            </div>

            <div>
              <label className="text-xs text-slate-500">Овог <span className="text-red-500">*</span></label>
              <input
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className="w-full rounded-lg border border-ocean-200 p-2.5 text-sm"
                placeholder="Овог"
              />
            </div>

            <div>
              <label className="text-xs text-slate-500">Нэр <span className="text-red-500">*</span></label>
              <input
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className="w-full rounded-lg border border-ocean-200 p-2.5 text-sm"
                placeholder="Нэр"
              />
            </div>

            <div>
              <label className="text-xs text-slate-500 flex items-center gap-1">
                <Mail className="w-3 h-3" /> Имэйл хаяг <span className="text-red-500">*</span>
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border border-ocean-200 p-2.5 text-sm"
                placeholder="example@email.com"
                required
              />
            </div>
          </div>

          {/* RUB Bank Section - Optional */}
          <div className="space-y-3 pt-3 border-t border-slate-100">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-ocean-700 font-semibold">
                <CreditCard className="w-4 h-4" />
                <span>Орос дахь банкны мэдээлэл (RUB)</span>
              </div>
            </div>

            {/* Checkbox to enable RUB bank */}
            <label className="flex items-center gap-3 cursor-pointer p-2 rounded-lg bg-slate-50 hover:bg-slate-100 transition">
              <input
                type="checkbox"
                checked={hasRubBank}
                onChange={(e) => setHasRubBank(e.target.checked)}
                className="w-5 h-5 rounded border-slate-300 text-ocean-600 focus:ring-ocean-500"
              />
              <span className="text-sm text-slate-600">
                Оросын банкны данс байгаа
              </span>
            </label>

            {hasRubBank && (
              <div className="space-y-3 pl-2 border-l-2 border-ocean-200">
                <div>
                  <label className="text-xs text-slate-500">Банкны нэр <span className="text-red-500">*</span></label>
                  <select
                    value={rubBankName}
                    onChange={(e) => setRubBankName(e.target.value)}
                    className="w-full rounded-lg border border-ocean-200 p-2.5 text-sm bg-white"
                  >
                    <option value="">Банк сонгоно уу</option>
                    {RUB_BANKS.map((bank) => (
                      <option key={bank} value={bank}>{bank}</option>
                    ))}
                  </select>
                  {rubBankName === "Бусад" && (
                    <input
                      type="text"
                      value={rubBankNameOther}
                      onChange={(e) => setRubBankNameOther(e.target.value)}
                      className="w-full rounded-lg border border-ocean-200 p-2.5 text-sm mt-2"
                      placeholder="Банкны нэрийг оруулна уу"
                    />
                  )}
                </div>

                <div>
                  <label className="text-xs text-slate-500">СБП холбосон орос утасны дугаар <span className="text-red-500">*</span></label>
                  <input
                    type="tel"
                    value={rubPhoneSbp}
                    onChange={(e) => setRubPhoneSbp(formatRussianPhone(e.target.value))}
                    className="w-full rounded-lg border border-ocean-200 p-2.5 text-sm"
                    placeholder="+7 XXX XXX XX XX"
                  />
                </div>

                <div>
                  <label className="text-xs text-slate-500">Картын дугаар <span className="text-red-500">*</span></label>
                  <input
                    type="text"
                    value={rubCardNumber}
                    onChange={(e) => setRubCardNumber(formatCardNumber(e.target.value))}
                    className="w-full rounded-lg border border-ocean-200 p-2.5 text-sm"
                    placeholder="XXXX XXXX XXXX XXXX"
                    maxLength={19}
                  />
                </div>

                <div>
                  <label className="text-xs text-slate-500">Данс эзэмшигчийн нэр <span className="text-red-500">*</span></label>
                  <input
                    type="text"
                    value={rubOwnerName}
                    onChange={(e) => setRubOwnerName(e.target.value)}
                    className="w-full rounded-lg border border-ocean-200 p-2.5 text-sm"
                    placeholder="IVAN IVANOV"
                  />
                </div>
              </div>
            )}
          </div>

          {/* MNT Bank Section */}
          <div className="space-y-3 pt-3 border-t border-slate-100">
            <div className="flex items-center gap-2 text-ocean-700 font-semibold">
              <Building className="w-4 h-4" />
              <span>Монгол дахь банкны мэдээлэл (MNT)</span>
            </div>

            <div>
              <label className="text-xs text-slate-500">Банкны нэр <span className="text-red-500">*</span></label>
              <select
                value={mntBankName}
                onChange={(e) => setMntBankName(e.target.value)}
                className="w-full rounded-lg border border-ocean-200 p-2.5 text-sm bg-white"
              >
                <option value="">Банк сонгоно уу</option>
                {MNT_BANKS.map((bank) => (
                  <option key={bank} value={bank}>{bank}</option>
                ))}
              </select>
              {mntBankName === "Бусад" && (
                <input
                  type="text"
                  value={mntBankNameOther}
                  onChange={(e) => setMntBankNameOther(e.target.value)}
                  className="w-full rounded-lg border border-ocean-200 p-2.5 text-sm mt-2"
                  placeholder="Банкны нэрийг оруулна уу"
                />
              )}
            </div>

            <div>
              <label className="text-xs text-slate-500">IBAN дансны дугаар <span className="text-red-500">*</span></label>
              <input
                type="text"
                value={mntAccountNumber}
                onChange={(e) => setMntAccountNumber(formatIBAN(e.target.value))}
                className="w-full rounded-lg border border-ocean-200 p-2.5 text-sm"
                placeholder="MN XX XXXX XX XXXXXXXXXX"
              />
            </div>

            <div>
              <label className="text-xs text-slate-500">Данс эзэмшигчийн нэр <span className="text-red-500">*</span></label>
              <input
                type="text"
                value={mntOwnerName}
                onChange={(e) => setMntOwnerName(e.target.value)}
                className="w-full rounded-lg border border-ocean-200 p-2.5 text-sm"
                placeholder="БАТ-ЭРДЭНЭ"
              />
            </div>

            <div>
              <label className="text-xs text-slate-500">Монгол утасны дугаар <span className="text-red-500">*</span></label>
              <input
                type="tel"
                value={mntPhone}
                onChange={(e) => setMntPhone(formatMongolianPhone(e.target.value))}
                className="w-full rounded-lg border border-ocean-200 p-2.5 text-sm"
                placeholder="+976 XXXX XXXX"
              />
            </div>
          </div>

          {/* Passport Upload Section */}
          <div className="space-y-3 pt-3 border-t border-slate-100">
            <div className="flex items-center gap-2 text-ocean-700 font-semibold">
              <FileText className="w-4 h-4" />
              <span>Паспортын зураг</span>
            </div>

            <div>
              <label className="text-xs text-slate-500">Паспортын зураг оруулах <span className="text-red-500">*</span></label>
              <div className="mt-1">
                {passportUrl ? (
                  <div className="flex items-center gap-2 p-2 bg-green-50 border border-green-200 rounded-lg">
                    <CheckCircle2 className="w-5 h-5 text-green-600" />
                    <span className="text-sm text-green-700">Паспорт амжилттай оруулсан</span>
                    <button
                      type="button"
                      onClick={() => setPassportUrl("")}
                      className="ml-auto text-xs text-ocean-600 hover:underline"
                    >
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
                        <span className="text-sm text-ocean-600">Паспортын зургаа оруулна уу</span>
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

          {/* Terms Agreement Checkbox */}
          <div className="pt-3 border-t border-slate-100">
            <label className="flex items-start gap-3 cursor-pointer p-3 rounded-xl bg-slate-50 hover:bg-slate-100 transition">
              <input
                type="checkbox"
                checked={agreedTerms}
                onChange={(e) => setAgreedTerms(e.target.checked)}
                className="mt-0.5 w-5 h-5 rounded border-slate-300 text-ocean-600 focus:ring-ocean-500"
              />
              <span className="text-sm text-slate-600">
                Би{" "}
                <a
                  href={TERMS_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-ocean-600 hover:underline font-medium inline-flex items-center gap-1"
                  onClick={(e) => e.stopPropagation()}
                >
                  хэрэглэгчийн гэрээ
                  <ExternalLink className="w-3 h-3" />
                </a>
                {" "}болон үйлчилгээний нөхцөлтэй танилцаж, зөвшөөрч байна <span className="text-red-500">*</span>
              </span>
            </label>
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
            className="w-full flex items-center justify-center gap-2 py-4 rounded-xl bg-ocean-600 text-white font-bold text-lg hover:bg-ocean-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Илгээж байна...
              </>
            ) : (
              <>
                <CheckCircle2 className="w-5 h-5" />
                Бүртгүүлэх
              </>
            )}
          </button>

          <p className="text-xs text-center text-slate-400">
            Таны мэдээлэл админаар шалгагдсаны дараа үйлчилгээг ашиглах боломжтой болно.
          </p>
        </div>
      </div>
    </div>
  );
}
