import { useState } from "react";
import {
  User,
  Phone,
  CreditCard,
  Building,
  Upload,
  CheckCircle2,
  Loader2,
  FileText,
  AlertCircle,
} from "lucide-react";
import { submitRegistration, requestPresign, RegistrationInput } from "../api";

interface Props {
  initData: string;
  onRegistered: () => void;
}

export function RegistrationModal({ initData, onRegistered }: Props) {
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  // Personal info
  const [lastName, setLastName] = useState("");
  const [firstName, setFirstName] = useState("");
  const [phone, setPhone] = useState("");

  // RUB bank info
  const [rubBankName, setRubBankName] = useState("");
  const [rubPhoneSbp, setRubPhoneSbp] = useState("");
  const [rubCardNumber, setRubCardNumber] = useState("");
  const [rubOwnerName, setRubOwnerName] = useState("");

  // MNT bank info
  const [mntBankName, setMntBankName] = useState("");
  const [mntAccountNumber, setMntAccountNumber] = useState("");
  const [mntOwnerName, setMntOwnerName] = useState("");

  // Passport photo
  const [passportUrl, setPassportUrl] = useState("");

  // Sanitize filename - remove special characters and spaces
  const sanitizeFilename = (filename: string): string => {
    // Get extension
    const ext = filename.split('.').pop() || 'jpg';
    // Generate safe filename with timestamp
    return `passport_${Date.now()}.${ext}`;
  };

  const handlePassportUpload = async (file: File) => {
    try {
      setUploading(true);
      setError("");
      const safeFilename = sanitizeFilename(file.name);
      const path = `passports/${safeFilename}`;
      const presigned = await requestPresign(initData, { bucket: "passports", path });
      await fetch(presigned.upload_url, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type },
      });
      setPassportUrl(presigned.public_url);
    } catch (err) {
      console.error("Passport upload error:", err);
      setError("Зураг оруулахад алдаа гарлаа. Дахин оролдоно уу.");
    } finally {
      setUploading(false);
    }
  };

  const isFormValid = () => {
    return (
      lastName.trim() &&
      firstName.trim() &&
      phone.trim() &&
      rubBankName.trim() &&
      rubPhoneSbp.trim() &&
      rubCardNumber.trim() &&
      rubOwnerName.trim() &&
      mntBankName.trim() &&
      mntAccountNumber.trim() &&
      mntOwnerName.trim() &&
      passportUrl
    );
  };

  const handleSubmit = async () => {
    if (!isFormValid()) {
      setError("Бүх талбарыг бөглөнө үү");
      return;
    }

    try {
      setLoading(true);
      setError("");

      const payload: RegistrationInput = {
        last_name: lastName.trim(),
        first_name: firstName.trim(),
        phone: phone.trim(),
        rub_bank_name: rubBankName.trim(),
        rub_phone_sbp: rubPhoneSbp.trim(),
        rub_card_number: rubCardNumber.trim(),
        rub_owner_name: rubOwnerName.trim(),
        mnt_bank_name: mntBankName.trim(),
        mnt_account_number: mntAccountNumber.trim(),
        mnt_owner_name: mntOwnerName.trim(),
        passport_storage_url: passportUrl,
      };

      await submitRegistration(initData, payload);
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
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center">
              <FileText className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-bold">OYUNS FINANCE ХЭРЭГЛЭГЧИЙН БҮРТГЭЛ</h2>
              <p className="text-sm text-white/80">Та манай үйлчилгээг ашиглахын өмнө бүртгүүлнэ үү</p>
            </div>
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
              <label className="text-xs text-slate-500">Утасны дугаар (Орос) <span className="text-red-500">*</span></label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full rounded-lg border border-ocean-200 p-2.5 text-sm"
                placeholder="+7 900 123 4567"
              />
            </div>
          </div>

          {/* RUB Bank Section */}
          <div className="space-y-3 pt-3 border-t border-slate-100">
            <div className="flex items-center gap-2 text-ocean-700 font-semibold">
              <CreditCard className="w-4 h-4" />
              <span>Орос дахь банкны мэдээлэл (RUB)</span>
            </div>

            <div>
              <label className="text-xs text-slate-500">Банкны нэр <span className="text-red-500">*</span></label>
              <input
                type="text"
                value={rubBankName}
                onChange={(e) => setRubBankName(e.target.value)}
                className="w-full rounded-lg border border-ocean-200 p-2.5 text-sm"
                placeholder="Tinkoff, Sber, Alfa..."
              />
            </div>

            <div>
              <label className="text-xs text-slate-500">СБП холбосон орос утасны дугаар <span className="text-red-500">*</span></label>
              <input
                type="tel"
                value={rubPhoneSbp}
                onChange={(e) => setRubPhoneSbp(e.target.value)}
                className="w-full rounded-lg border border-ocean-200 p-2.5 text-sm"
                placeholder="+7 900 123 4567"
              />
            </div>

            <div>
              <label className="text-xs text-slate-500">Картын дугаар <span className="text-red-500">*</span></label>
              <input
                type="text"
                value={rubCardNumber}
                onChange={(e) => setRubCardNumber(e.target.value)}
                className="w-full rounded-lg border border-ocean-200 p-2.5 text-sm"
                placeholder="2200 1234 5678 9012"
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

          {/* MNT Bank Section */}
          <div className="space-y-3 pt-3 border-t border-slate-100">
            <div className="flex items-center gap-2 text-ocean-700 font-semibold">
              <Building className="w-4 h-4" />
              <span>Монгол дахь банкны мэдээлэл (MNT)</span>
            </div>

            <div>
              <label className="text-xs text-slate-500">Банкны нэр <span className="text-red-500">*</span></label>
              <input
                type="text"
                value={mntBankName}
                onChange={(e) => setMntBankName(e.target.value)}
                className="w-full rounded-lg border border-ocean-200 p-2.5 text-sm"
                placeholder="Хаан банк, Голомт банк..."
              />
            </div>

            <div>
              <label className="text-xs text-slate-500">IBAN дансны дугаар <span className="text-red-500">*</span></label>
              <input
                type="text"
                value={mntAccountNumber}
                onChange={(e) => setMntAccountNumber(e.target.value)}
                className="w-full rounded-lg border border-ocean-200 p-2.5 text-sm"
                placeholder="MN 00000 000 5001234567"
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
          </div>

          {/* Passport Upload Section */}
          <div className="space-y-3 pt-3 border-t border-slate-100">
            <div className="flex items-center gap-2 text-ocean-700 font-semibold">
              <Upload className="w-4 h-4" />
              <span>Паспортын зураг <span className="text-red-500">*</span></span>
            </div>

            <label className="flex flex-col items-center justify-center border-2 border-dashed border-ocean-200 rounded-xl py-6 cursor-pointer bg-white/60 hover:bg-ocean-50 transition">
              {passportUrl ? (
                <div className="flex flex-col items-center gap-2 text-green-600">
                  <CheckCircle2 className="w-8 h-8" />
                  <span className="font-medium text-sm">Амжилттай хавсаргалаа!</span>
                  <img src={passportUrl} alt="Passport" className="mt-2 max-h-32 rounded-lg" />
                </div>
              ) : (
                <>
                  <Upload className="w-8 h-8 text-ocean-600" />
                  <span className="text-sm text-slate-500 mt-2">
                    {uploading ? "Хавсаргаж байна..." : "Паспортын зураг оруулах"}
                  </span>
                  <span className="text-xs text-slate-400 mt-1">
                    Нүүр хэсгийн зургийг оруулаарай (.jpg, .png форматаар)
                  </span>
                </>
              )}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handlePassportUpload(file);
                }}
                disabled={uploading}
              />
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
