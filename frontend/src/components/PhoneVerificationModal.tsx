import { useEffect, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, MessageSquareText, Phone, ShieldCheck, X } from "lucide-react";
import { completePhoneVerification } from "../api";
import { useLang } from "../i18n/useLang";
import { getSupabaseBrowserClient, isSupabasePhoneAuthConfigured } from "../supabase";

interface Props {
  phoneNumber: string;
  onVerified: () => void;
  onClose?: () => void;
  autoSend?: boolean;
}

export function PhoneVerificationModal({ phoneNumber, onVerified, onClose, autoSend = false }: Props) {
  const { t } = useLang();
  const [otpCode, setOtpCode] = useState("");
  const [requestingCode, setRequestingCode] = useState(false);
  const [verifyingCode, setVerifyingCode] = useState(false);
  const [codeRequested, setCodeRequested] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const autoSendTriggeredRef = useRef(false);

  const isConfigured = isSupabasePhoneAuthConfigured();

  const handleRequestCode = async () => {
    if (!isConfigured || requestingCode) return;

    try {
      setRequestingCode(true);
      setError("");
      setInfo("");

      const supabase = getSupabaseBrowserClient();
      const { error: otpError } = await supabase.auth.signInWithOtp({ phone: phoneNumber });
      if (otpError) {
        throw otpError;
      }

      setCodeRequested(true);
      setInfo(t("phonev.code_sent"));
    } catch (err: any) {
      console.error("Phone OTP request error:", err);
      setError(err?.message || t("phonev.request_error"));
    } finally {
      setRequestingCode(false);
    }
  };

  const handleVerifyCode = async () => {
    if (!isConfigured || verifyingCode) return;

    try {
      setVerifyingCode(true);
      setError("");
      setInfo("");

      const supabase = getSupabaseBrowserClient();
      const { data, error: otpError } = await supabase.auth.verifyOtp({
        phone: phoneNumber,
        token: otpCode.trim(),
        type: "sms",
      });

      if (otpError) {
        throw otpError;
      }

      const accessToken = data.session?.access_token;
      if (!accessToken) {
        throw new Error(t("phonev.session_error"));
      }

      await completePhoneVerification({ access_token: accessToken });
      await supabase.auth.signOut().catch(() => undefined);
      onVerified();
    } catch (err: any) {
      console.error("Phone OTP verify error:", err);
      setError(err?.message || t("phonev.verify_error"));
    } finally {
      setVerifyingCode(false);
    }
  };

  useEffect(() => {
    if (!autoSend || !isConfigured || autoSendTriggeredRef.current) return;
    autoSendTriggeredRef.current = true;
    void handleRequestCode();
  }, [autoSend, isConfigured]);

  useEffect(() => {
    if (!isConfigured) {
      setError(t("phonev.not_configured"));
    }
  }, [isConfigured, t]);

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[110] p-4 overflow-auto">
      <div className="bg-white dark:bg-dark-800 rounded-2xl max-w-lg w-full shadow-2xl my-4">
        <div className="bg-gradient-to-r from-maroon-700 to-maroon-500 p-5 text-white rounded-t-2xl">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center">
                <ShieldCheck className="w-6 h-6" />
              </div>
              <div>
                <h2 className="text-xl font-bold">{t("phonev.title")}</h2>
                <p className="text-sm text-white/80">{t("phonev.subtitle")}</p>
              </div>
            </div>
            {onClose && (
              <button onClick={onClose} className="p-2 rounded-full hover:bg-white/20 transition" aria-label={t("common.close")}>
                <X className="w-5 h-5" />
              </button>
            )}
          </div>
        </div>

        <div className="p-5 space-y-4">
          <div className="rounded-2xl border border-maroon-100 dark:border-dark-600 bg-maroon-50/70 dark:bg-dark-700 p-4 flex items-start gap-3">
            <div className="w-10 h-10 rounded-2xl bg-white dark:bg-dark-800 flex items-center justify-center shadow-sm shrink-0">
              <Phone className="w-5 h-5 text-maroon-600 dark:text-maroon-300" />
            </div>
            <div>
              <div className="text-sm font-semibold text-dark-800 dark:text-ivory-200">{t("phonev.phone_label")}</div>
              <div className="text-base font-bold text-maroon-700 dark:text-maroon-300">{phoneNumber}</div>
              <div className="text-xs text-dark-600 dark:text-ivory-400 mt-1">{t("phonev.instructions")}</div>
            </div>
          </div>

          <button
            onClick={handleRequestCode}
            disabled={!isConfigured || requestingCode}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-maroon-600 text-white font-semibold hover:bg-maroon-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {requestingCode ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                {t("phonev.sending")}
              </>
            ) : (
              <>
                <MessageSquareText className="w-4 h-4" />
                {codeRequested ? t("phonev.resend") : t("phonev.send_code")}
              </>
            )}
          </button>

          <div>
            <label className="text-xs text-slate-500 dark:text-ivory-400">{t("phonev.code_label")}</label>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={otpCode}
              onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              className="w-full rounded-lg border border-maroon-200 dark:border-dark-600 bg-white dark:bg-dark-700 text-dark-800 dark:text-ivory-200 p-3 text-base tracking-[0.35em] text-center"
              placeholder="123456"
            />
          </div>

          {info && (
            <div className="flex items-center gap-2 p-3 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-lg text-emerald-700 dark:text-emerald-400 text-sm">
              <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
              {info}
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-400 text-sm">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}

          <button
            onClick={handleVerifyCode}
            disabled={!isConfigured || verifyingCode || otpCode.trim().length < 4}
            className="w-full flex items-center justify-center gap-2 py-4 rounded-xl bg-gold-500 text-dark-900 font-bold text-lg hover:bg-gold-400 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {verifyingCode ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                {t("phonev.verifying")}
              </>
            ) : (
              <>
                <ShieldCheck className="w-5 h-5" />
                {t("phonev.verify")}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}