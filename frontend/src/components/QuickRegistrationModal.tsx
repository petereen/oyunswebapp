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
import { formatMongolianPhone } from "./RegistrationModal";

const TERMS_URL = "https://oyuns.mn/user-agreement";

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
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [agreedTerms, setAgreedTerms] = useState(false);

  const isFormValid = () => {
    if (!lastName.trim() || !firstName.trim() || !phone.trim()) return false;
    if (!agreedTerms) return false;
    // Phone must have 8 digits
    const digits = phone.replace(/\D/g, "").replace(/^976/, "");
    if (digits.length < 8) return false;
    return true;
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

      const payload: BasicRegistrationInput = {
        last_name: lastName.trim(),
        first_name: firstName.trim(),
        phone: phone.replace(/\D/g, "").replace(/^976/, "").slice(0, 8),
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

            <div>
              <label className="text-xs text-slate-500 dark:text-ivory-400 flex items-center gap-1">
                <Phone className="w-3 h-3" /> {t("qreg.phone")} <span className="text-red-500">*</span>
              </label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(formatMongolianPhone(e.target.value))}
                className="w-full rounded-lg border border-maroon-200 dark:border-dark-600 bg-white dark:bg-dark-700 text-dark-800 dark:text-ivory-200 p-2.5 text-sm"
                placeholder="+976 XXXX XXXX"
              />
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
