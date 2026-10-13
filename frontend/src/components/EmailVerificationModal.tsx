import { useEffect, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, Mail, MessageSquareText, Pencil, ShieldCheck, X } from "lucide-react";
import { completeEmailVerification, startEmailVerification } from "../api";
import { useLang } from "../i18n/useLang";
import { getSupabaseBrowserClient, isSupabaseAuthConfigured } from "../supabase";

interface Props {
  emailAddress: string;
  onVerified: () => void;
  onClose?: () => void;
  autoSend?: boolean;
  allowEditEmail?: boolean;
  isEmailVerified?: boolean;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function EmailVerificationPanel({ emailAddress, onVerified, onClose, autoSend = false, allowEditEmail = false, isEmailVerified = false }: Props) {
  const { t } = useLang();
  const [email, setEmail] = useState(emailAddress);
  const [editing, setEditing] = useState(allowEditEmail && !emailAddress.trim());
  const [otpCode, setOtpCode] = useState("");
  const [requestingCode, setRequestingCode] = useState(false);
  const [verifyingCode, setVerifyingCode] = useState(false);
  const [codeRequested, setCodeRequested] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [alreadyVerified, setAlreadyVerified] = useState(isEmailVerified);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const autoSendTriggeredRef = useRef(false);

  const isConfigured = isSupabaseAuthConfigured();

  const handleRequestCode = async () => {
    if (!isConfigured || requestingCode || resendCooldown > 0) return;

    const targetEmail = email.trim().toLowerCase();
    if (!EMAIL_REGEX.test(targetEmail)) {
      setError(t("emailv.invalid_email"));
      setEditing(true);
      return;
    }

    try {
      setRequestingCode(true);
      setError("");
      setInfo("");

      // For existing users, persist the (possibly edited) email and mark it
      // pending before requesting a code so the backend will accept the OTP.
      if (allowEditEmail) {
        const result = await startEmailVerification(targetEmail);
        if (result.already_verified) {
          setAlreadyVerified(true);
          return;
        }
        setEmail(targetEmail);
        setEditing(false);
      }

      const supabase = getSupabaseBrowserClient();
      const { error: otpError } = await supabase.auth.signInWithOtp({
        email: targetEmail,
        options: { shouldCreateUser: true },
      });

      if (otpError) {
        throw otpError;
      }

      setCodeRequested(true);
      setResendCooldown(60);
      setInfo(t("emailv.code_sent"));
    } catch (err: any) {
      console.error("Email OTP request error:", err);
      setError(err?.response?.data?.detail || err?.message || t("emailv.request_error"));
    } finally {
      setRequestingCode(false);
    }
  };

  useEffect(() => {
    if (resendCooldown <= 0) return undefined;
    const timer = window.setInterval(() => {
      setResendCooldown((current) => Math.max(0, current - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [resendCooldown]);

  const handleVerifyCode = async () => {
    if (!isConfigured || verifyingCode) return;

    try {
      setVerifyingCode(true);
      setError("");
      setInfo("");

      const supabase = getSupabaseBrowserClient();
      const { data, error: otpError } = await supabase.auth.verifyOtp({
        email: email.trim().toLowerCase(),
        token: otpCode.trim(),
        type: "email",
      });

      if (otpError) {
        throw otpError;
      }

      const accessToken = data.session?.access_token;
      if (!accessToken) {
        throw new Error(t("emailv.session_error"));
      }

      await completeEmailVerification({ access_token: accessToken });
      await supabase.auth.signOut().catch(() => undefined);
      onVerified();
    } catch (err: any) {
      console.error("Email OTP verify error:", err);
      setError(err?.response?.data?.detail || err?.message || t("emailv.verify_error"));
    } finally {
      setVerifyingCode(false);
    }
  };

  useEffect(() => {
    if (isEmailVerified || !autoSend || !isConfigured || autoSendTriggeredRef.current) return;
    autoSendTriggeredRef.current = true;
    void handleRequestCode();
  }, [autoSend, isConfigured, isEmailVerified]);

  useEffect(() => {
    if (!isConfigured) {
      setError(t("emailv.not_configured"));
    }
  }, [isConfigured, t]);

  if (isEmailVerified || alreadyVerified) {
    return (
      <div className="bg-white dark:bg-dark-800 rounded-2xl max-w-lg w-full shadow-2xl max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <div className="bg-gradient-to-r from-maroon-700 to-maroon-500 px-4 py-3 text-white rounded-t-2xl">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center"><ShieldCheck className="w-5 h-5" /></div>
              <div><h2 className="text-lg font-bold">{t("emailv.title")}</h2></div>
            </div>
            {onClose && <button onClick={onClose} className="p-2 rounded-full hover:bg-white/20 transition" aria-label={t("common.close")}><X className="w-5 h-5" /></button>}
          </div>
        </div>
        <div className="p-5 text-center space-y-3">
          <CheckCircle2 className="w-10 h-10 mx-auto text-emerald-500" />
          <div className="text-lg font-bold text-dark-800 dark:text-ivory-200">{t("emailv.already_verified")}</div>
          <div className="text-sm text-dark-600 dark:text-ivory-300 break-all">{emailAddress}</div>
          {onClose && <button onClick={onClose} className="w-full py-3 rounded-xl bg-maroon-600 text-white font-semibold hover:bg-maroon-700 transition">{t("common.close")}</button>}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-dark-800 rounded-2xl max-w-lg w-full shadow-2xl flex flex-col max-h-[calc(100dvh-2rem)] overflow-hidden">
      <div className="bg-gradient-to-r from-maroon-700 to-maroon-500 px-4 py-3 text-white shrink-0">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center shrink-0">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-lg font-bold leading-tight">{t("emailv.title")}</h2>
              <p className="text-xs text-white/80 leading-snug hidden [@media(min-height:640px)]:block">{t("emailv.subtitle")}</p>
            </div>
          </div>
          {onClose && (
            <button onClick={onClose} className="p-2 rounded-full hover:bg-white/20 transition shrink-0" aria-label={t("common.close")}>
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain scroll-smooth [scrollbar-width:thin] p-4 space-y-3">
        <div className="rounded-xl border border-maroon-100 dark:border-dark-600 bg-maroon-50/70 dark:bg-dark-700 p-3 flex items-start gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-white dark:bg-dark-800 flex items-center justify-center shadow-sm shrink-0">
            <Mail className="w-4 h-4 text-maroon-600 dark:text-maroon-300" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-semibold text-dark-800 dark:text-ivory-200">{t("emailv.email_label")}</div>
            {allowEditEmail ? (
              <div className="flex items-center gap-2 mt-1">
                <input
                  type="email"
                  inputMode="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onClick={() => { if (!editing) setEditing(true); }}
                  readOnly={!editing}
                  placeholder="example@email.com"
                  className={`flex-1 min-w-0 rounded-lg px-2.5 py-1.5 text-base font-bold break-all border transition ${
                    editing
                      ? "border-maroon-300 dark:border-maroon-600 bg-white dark:bg-dark-800 text-dark-800 dark:text-ivory-200"
                      : "border-transparent bg-transparent text-maroon-700 dark:text-maroon-300 cursor-pointer"
                  }`}
                />
                <button
                  type="button"
                  onClick={() => setEditing((v) => !v)}
                  className="p-2 rounded-lg bg-white dark:bg-dark-800 border border-maroon-200 dark:border-dark-600 text-maroon-600 dark:text-maroon-300 hover:bg-maroon-50 dark:hover:bg-dark-700 transition shrink-0"
                  aria-label={t("emailv.edit_email")}
                >
                  <Pencil className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <div className="text-sm font-bold text-maroon-700 dark:text-maroon-300 break-all">{email}</div>
            )}
            <div className="text-[11px] leading-snug text-dark-600 dark:text-ivory-400 mt-1">{t("emailv.instructions")}</div>
          </div>
        </div>

        <button
          onClick={handleRequestCode}
          disabled={!isConfigured || requestingCode || resendCooldown > 0}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-maroon-600 text-white text-sm font-semibold hover:bg-maroon-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {requestingCode ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              {t("emailv.sending")}
            </>
          ) : (
            <>
              <MessageSquareText className="w-4 h-4" />
              {resendCooldown > 0 ? `${t("emailv.resend")} (${resendCooldown}s)` : codeRequested ? t("emailv.resend") : t("emailv.send_code")}
            </>
          )}
        </button>

        <div>
          <label className="text-xs text-slate-500 dark:text-ivory-400">{t("emailv.code_label")}</label>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={otpCode}
            onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            className="w-full rounded-lg border border-maroon-200 dark:border-dark-600 bg-white dark:bg-dark-700 text-dark-800 dark:text-ivory-200 px-3 py-2 text-base tracking-[0.35em] text-center"
            placeholder="123456"
          />
        </div>

        {info && (
          <div className="flex items-center gap-2 px-3 py-2 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-lg text-emerald-700 dark:text-emerald-400 text-xs">
            <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
            {info}
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 px-3 py-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-400 text-xs">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            {error}
          </div>
        )}
      </div>

      <div className="shrink-0 px-4 pt-3 pb-4 border-t border-maroon-100 dark:border-dark-600 bg-white dark:bg-dark-800">
        <button
          onClick={handleVerifyCode}
          disabled={!isConfigured || verifyingCode || otpCode.trim().length < 4}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-gold-500 text-dark-900 font-bold text-base hover:bg-gold-400 transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {verifyingCode ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              {t("emailv.verifying")}
            </>
          ) : (
            <>
              <ShieldCheck className="w-5 h-5" />
              {t("emailv.verify")}
            </>
          )}
        </button>
      </div>
    </div>
  );
}

export function EmailVerificationModal(props: Props) {
  return (
    <div className="fixed inset-0 bg-black/60 z-[110] overflow-y-auto overscroll-contain">
      <div className="flex min-h-[100dvh] items-center justify-center p-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))]">
        <EmailVerificationPanel {...props} />
      </div>
    </div>
  );
}
