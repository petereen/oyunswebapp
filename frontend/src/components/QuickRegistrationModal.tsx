import { useState } from "react";
import {
  User,
  CheckCircle2,
  Loader2,
  AlertCircle,
  X,
  ExternalLink,
  Mail,
  Phone,
} from "lucide-react";
import { submitBasicRegistration, BasicRegistrationInput } from "../api";
import { useLang } from "../i18n/useLang";

const TERMS_URL = "https://oyuns.mn/user-agreement";

const COUNTRY_CODES = [
  { code: "+976", flag: "🇲🇳", name: "Монгол" },
  { code: "+7", flag: "🇷🇺", name: "Россия / Казахстан" },
  { code: "+86", flag: "🇨🇳", name: "China" },
  { code: "+1", flag: "🇺🇸", name: "USA / Canada" },
  { code: "+44", flag: "🇬🇧", name: "UK" },
  { code: "+81", flag: "🇯🇵", name: "Japan" },
  { code: "+82", flag: "🇰🇷", name: "South Korea" },
  { code: "+49", flag: "🇩🇪", name: "Germany" },
  { code: "+33", flag: "🇫🇷", name: "France" },
  { code: "+61", flag: "🇦🇺", name: "Australia" },
  { code: "+91", flag: "🇮🇳", name: "India" },
  { code: "+971", flag: "🇦🇪", name: "UAE" },
  { code: "+65", flag: "🇸🇬", name: "Singapore" },
  { code: "+90", flag: "🇹🇷", name: "Turkey" },
  { code: "+852", flag: "🇭🇰", name: "Hong Kong" },
  { code: "+886", flag: "🇹🇼", name: "Taiwan" },
  { code: "+966", flag: "🇸🇦", name: "Saudi Arabia" },
  { code: "+380", flag: "🇺🇦", name: "Ukraine" },
  { code: "+375", flag: "🇧🇾", name: "Belarus" },
  { code: "+48", flag: "🇵🇱", name: "Poland" },
  { code: "+374", flag: "🇦🇲", name: "Armenia" },
  { code: "+994", flag: "🇦🇿", name: "Azerbaijan" },
  { code: "+995", flag: "🇬🇪", name: "Georgia" },
  { code: "+996", flag: "🇰🇬", name: "Kyrgyzstan" },
  { code: "+992", flag: "🇹🇯", name: "Tajikistan" },
  { code: "+998", flag: "🇺🇿", name: "Uzbekistan" },
  { code: "+993", flag: "🇹🇲", name: "Turkmenistan" },
  { code: "+373", flag: "🇲🇩", name: "Moldova" },
  { code: "+39", flag: "🇮🇹", name: "Italy" },
  { code: "+34", flag: "🇪🇸", name: "Spain" },
  { code: "+31", flag: "🇳🇱", name: "Netherlands" },
  { code: "+41", flag: "🇨🇭", name: "Switzerland" },
  { code: "+46", flag: "🇸🇪", name: "Sweden" },
];

interface Props {
  onRegistered: () => void;
  onClose?: () => void;
}

export function QuickRegistrationModal({ onRegistered, onClose }: Props) {
  const { t } = useLang();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [lastName, setLastName] = useState("");
  const [firstName, setFirstName] = useState("");
  const [countryCode, setCountryCode] = useState("+976");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [email, setEmail] = useState("");
  const [agreedTerms, setAgreedTerms] = useState(false);

  const phoneDigits = phoneNumber.replace(/\D/g, "");
  const phoneValid =
    countryCode === "+976"
      ? phoneDigits.length === 8
      : phoneDigits.length >= 6 && phoneDigits.length <= 15;

  const isFormValid = () => {
    if (!lastName.trim() || !firstName.trim()) return false;
    if (!agreedTerms) return false;
    return phoneValid;
  };

  const handleSubmit = async () => {
    if (!isFormValid()) {
      if (!agreedTerms) {
        setError(t("reg.terms_required"));
      } else {
        setError(t("reg.fill_all"));
      }
      return;
    }

    try {
      setLoading(true);
      setError("");

      const fullPhone = `${countryCode}${phoneNumber.replace(/\s/g, "")}`;
      const payload: BasicRegistrationInput = {
        last_name: lastName.trim(),
        first_name: firstName.trim(),
        phone_intl: fullPhone,
        email: email.trim() || undefined,
      };

      await submitBasicRegistration(payload);
      onRegistered();
    } catch (err) {
      console.error("Basic registration error:", err);
      setError(t("reg.submit_error"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[100] p-4 overflow-auto">
      <div className="bg-white dark:bg-dark-800 rounded-2xl max-w-lg w-full shadow-2xl my-4">
        {/* Header */}
        <div className="bg-gradient-to-r from-maroon-600 to-maroon-500 p-5 text-white rounded-t-2xl">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center">
                <User className="w-6 h-6" />
              </div>
              <div>
                <h2 className="text-xl font-bold">{t("qreg.title")}</h2>
                <p className="text-sm text-white/80">{t("qreg.subtitle")}</p>
              </div>
            </div>
            {onClose && (
              <button onClick={onClose} className="p-2 rounded-full hover:bg-white/20 transition">
                <X className="w-5 h-5" />
              </button>
            )}
          </div>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4">
          {/* Personal Info */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-maroon-700 dark:text-maroon-300 font-semibold">
              <User className="w-4 h-4" />
              <span>{t("reg.personal_info")}</span>
            </div>

            <div>
              <label className="text-xs text-slate-500 dark:text-ivory-400">{t("reg.last_name")} <span className="text-red-500">*</span></label>
              <input
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className="w-full rounded-lg border border-maroon-200 dark:border-dark-600 bg-white dark:bg-dark-700 text-dark-800 dark:text-ivory-200 p-2.5 text-sm"
                placeholder={t("reg.last_name")}
              />
            </div>

            <div>
              <label className="text-xs text-slate-500 dark:text-ivory-400">{t("reg.first_name")} <span className="text-red-500">*</span></label>
              <input
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className="w-full rounded-lg border border-maroon-200 dark:border-dark-600 bg-white dark:bg-dark-700 text-dark-800 dark:text-ivory-200 p-2.5 text-sm"
                placeholder={t("reg.first_name")}
              />
            </div>

            {/* International phone: country code selector + number input */}
            <div>
              <label className="text-xs text-slate-500 dark:text-ivory-400 flex items-center gap-1 mb-1">
                <Phone className="w-3 h-3" /> {t("qreg.phone")} <span className="text-red-500">*</span>
              </label>
              <div className="flex gap-2">
                <select
                  value={countryCode}
                  onChange={(e) => { setCountryCode(e.target.value); setPhoneNumber(""); }}
                  className="rounded-lg border border-maroon-200 dark:border-dark-600 bg-white dark:bg-dark-700 text-dark-800 dark:text-ivory-200 p-2.5 text-sm flex-shrink-0 max-w-[140px]"
                >
                  {COUNTRY_CODES.map((c) => (
                    <option key={`${c.code}-${c.name}`} value={c.code}>
                      {c.flag} {c.code}
                    </option>
                  ))}
                </select>
                <input
                  type="tel"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value.replace(/[^\d\s\-]/g, ""))}
                  className="flex-1 rounded-lg border border-maroon-200 dark:border-dark-600 bg-white dark:bg-dark-700 text-dark-800 dark:text-ivory-200 p-2.5 text-sm"
                  placeholder={countryCode === "+976" ? "9911 2233" : countryCode === "+7" ? "999 123 45 67" : "..."}
                />
              </div>
              {countryCode === "+976" && phoneDigits.length > 0 && phoneDigits.length !== 8 && (
                <p className="text-xs text-red-500 mt-1">8 оронтой дугаар оруулна уу / Введите 8 цифр</p>
              )}
            </div>

            <div>
              <label className="text-xs text-slate-500 dark:text-ivory-400 flex items-center gap-1">
                <Mail className="w-3 h-3" /> {t("reg.email_label")}
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border border-maroon-200 dark:border-dark-600 bg-white dark:bg-dark-700 text-dark-800 dark:text-ivory-200 p-2.5 text-sm"
                placeholder="example@email.com"
              />
            </div>
          </div>

          {/* Terms */}
          <div className="pt-3 border-t border-slate-100 dark:border-dark-600">
            <label className="flex items-start gap-3 cursor-pointer p-3 rounded-xl bg-slate-50 dark:bg-dark-700 hover:bg-slate-100 dark:hover:bg-dark-600 transition">
              <input
                type="checkbox"
                checked={agreedTerms}
                onChange={(e) => setAgreedTerms(e.target.checked)}
                className="mt-0.5 w-5 h-5 rounded border-slate-300 text-maroon-600 focus:ring-maroon-500"
              />
              <span className="text-sm text-slate-600 dark:text-ivory-300">
                {t("reg.terms_prefix")}
                <a
                  href={TERMS_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-maroon-600 dark:text-maroon-400 hover:underline font-medium inline-flex items-center gap-1"
                  onClick={(e) => e.stopPropagation()}
                >
                  {t("reg.terms_link")}
                  <ExternalLink className="w-3 h-3" />
                </a>
                {t("reg.terms_suffix")} <span className="text-red-500">*</span>
              </span>
            </label>
          </div>

          {/* Info note about limited access */}
          <div className="p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg text-sm text-amber-700 dark:text-amber-300">
            {t("qreg.limited_note")}
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-400 text-sm">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}

          {/* Submit */}
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
                {t("qreg.submit")}
              </>
            )}
          </button>

          <p className="text-xs text-center text-slate-400 dark:text-ivory-400">
            {t("qreg.footer_note")}
          </p>
        </div>
      </div>
    </div>
  );
}
