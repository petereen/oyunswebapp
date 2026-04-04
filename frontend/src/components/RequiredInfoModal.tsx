import { useState } from "react";
import { X, Mail, Phone, AlertCircle, Loader2, Save } from "lucide-react";
import { updateBankInfo, UpdateBankInfoInput } from "../api";
import { useLang } from "../i18n/useLang";

interface Props {
  currentEmail?: string;
  currentPhoneMnt?: string;
  currentPhone?: string;
  currentBankMnt?: string;
  onSaved: () => void;
  onClose: () => void;
}

// Format Mongolian phone number
const formatMongolianPhone = (value: string): string => {
  // Remove all non-digits
  const digits = value.replace(/\D/g, '');
  
  // If starts with 976, remove it for formatting
  const localDigits = digits.startsWith('976') ? digits.slice(3) : digits;
  
  // Limit to 8 digits for Mongolian numbers
  const limited = localDigits.slice(0, 8);
  
  // Format: XXXX-XXXX
  if (limited.length <= 4) return limited;
  return `${limited.slice(0, 4)}-${limited.slice(4)}`;
};

// Parse bank_mnt: "Банк,Данс,Нэр,Утас"
const parseBankMnt = (bankMnt: string | undefined) => {
  if (!bankMnt) return { bankName: "", accountNumber: "", ownerName: "", phone: "" };
  const parts = bankMnt.split(",").map(p => p.trim());
  return {
    bankName: parts[0] || "",
    accountNumber: parts[1] || "",
    ownerName: parts[2] || "",
    phone: parts[3] || "",
  };
};

export function RequiredInfoModal({ currentEmail, currentPhoneMnt, currentPhone, currentBankMnt, onSaved, onClose }: Props) {
  const [email, setEmail] = useState(currentEmail || "");
  const [phoneMnt, setPhoneMnt] = useState(currentPhoneMnt || "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const { t } = useLang();

  // Check which fields are missing
  const missingEmail = !currentEmail?.trim();
  const missingPhoneMnt = !currentPhoneMnt?.trim();

  const isFormValid = () => {
    // Email validation
    if (missingEmail && email.trim()) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email.trim())) {
        return false;
      }
    }
    
    // Phone_mnt validation (Mongolian phone - 8 digits)
    if (missingPhoneMnt && phoneMnt.trim()) {
      const digits = phoneMnt.replace(/\D/g, '');
      if (digits.length !== 8) {
        return false;
      }
    }
    
    // At least one field must be filled if missing
    if (missingEmail && !email.trim()) return false;
    if (missingPhoneMnt && !phoneMnt.trim()) return false;
    
    return true;
  };

  const handleSave = async () => {
    if (!isFormValid()) {
      setError(t("req.fill_all"));
      return;
    }

    try {
      setLoading(true);
      setError("");
      
      // Parse existing bank_mnt to preserve bank info
      const existingMnt = parseBankMnt(currentBankMnt);
      const newPhoneMnt = phoneMnt.replace(/\D/g, '') || currentPhoneMnt || "";
      
      const payload: UpdateBankInfoInput = {
        phone: currentPhone || "",
        email: email.trim() || currentEmail || "",
        // Keep existing MNT bank info, just update the phone part
        mnt_bank_name: existingMnt.bankName,
        mnt_account_number: existingMnt.accountNumber,
        mnt_owner_name: existingMnt.ownerName,
        mnt_phone: newPhoneMnt,
        // Keep existing RUB bank info empty (not changing it)
        rub_bank_name: "",
        rub_phone_sbp: "",
        rub_card_number: "",
        rub_owner_name: "",
      };
      
      await updateBankInfo(payload);
      onSaved();
    } catch (err) {
      console.error("Save error:", err);
      setError(t("req.save_error"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[100] p-4">
      <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl">
        {/* Header */}
        <div className="bg-gradient-to-r from-amber-500 to-orange-500 p-5 text-white rounded-t-2xl">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center">
                <AlertCircle className="w-6 h-6" />
              </div>
              <div>
                <h2 className="text-xl font-bold">{t("req.title")}</h2>
                <p className="text-sm text-white/80">{t("req.subtitle")}</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-full hover:bg-white/20 transition"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          {error && (
            <div className="bg-red-50 text-red-700 p-3 rounded-lg text-sm">
              {error}
            </div>
          )}

          {/* Email Field */}
          {missingEmail && (
            <div>
              <label className="text-sm font-medium text-slate-700 flex items-center gap-2 mb-2">
                <Mail className="w-4 h-4 text-maroon-600" />
                {t("req.email_label")}
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border border-maroon-200 p-3 text-base focus:ring-2 focus:ring-maroon-500 focus:border-transparent"
                placeholder="example@email.com"
              />
              <p className="text-xs text-slate-500 mt-1">
                {t("req.email_desc")}
              </p>
            </div>
          )}

          {/* Phone MNT Field */}
          {missingPhoneMnt && (
            <div>
              <label className="text-sm font-medium text-slate-700 flex items-center gap-2 mb-2">
                <Phone className="w-4 h-4 text-maroon-600" />
                {t("req.phone_mn_label")}
              </label>
              <input
                type="tel"
                value={phoneMnt}
                onChange={(e) => setPhoneMnt(formatMongolianPhone(e.target.value))}
                className="w-full rounded-lg border border-maroon-200 p-3 text-base focus:ring-2 focus:ring-maroon-500 focus:border-transparent"
                placeholder="9912-3456"
              />
              <p className="text-xs text-slate-500 mt-1">
                {t("req.phone_mn_desc")}
              </p>
            </div>
          )}

          {/* Info Box */}
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-amber-800">
                <strong>{t("req.why_required")}</strong>
                <ul className="mt-2 space-y-1 list-disc list-inside text-amber-700">
                  <li>{t("req.reason1")}</li>
                  <li>{t("req.reason2")}</li>
                  <li>{t("req.reason3")}</li>
                </ul>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-5 bg-slate-50 rounded-b-2xl flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-3 px-4 rounded-xl border border-slate-300 text-slate-700 font-medium hover:bg-slate-100 transition"
          >
            {t("req.close")}
          </button>
          <button
            onClick={handleSave}
            disabled={!isFormValid() || loading}
            className="flex-1 py-3 px-4 rounded-xl bg-maroon-600 text-white font-medium hover:bg-maroon-700 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                {t("req.saving")}
              </>
            ) : (
              <>
                <Save className="w-4 h-4" />
                {t("req.save")}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
