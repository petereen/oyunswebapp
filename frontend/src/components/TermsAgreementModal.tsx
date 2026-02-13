import { useState } from "react";
import { FileText, ExternalLink, CheckCircle2, Loader2 } from "lucide-react";
import { agreeToTerms } from "../api";

interface Props {
  onAgreed: () => void;
}

const TERMS_URL = "https://oyuns.mn/user-agreement";

export function TermsAgreementModal({ onAgreed }: Props) {
  const [loading, setLoading] = useState(false);
  const [hasReadTerms, setHasReadTerms] = useState(false);
  const [error, setError] = useState("");

  const handleAgree = async () => {
    if (!hasReadTerms) {
      setError("Та эхлээд үйлчилгээний нөхцөлтэй танилцана уу");
      return;
    }

    try {
      setLoading(true);
      setError("");
      await agreeToTerms();
      onAgreed();
    } catch (err) {
      console.error("Failed to agree to terms:", err);
      setError("Алдаа гарлаа. Дахин оролдоно уу.");
    } finally {
      setLoading(false);
    }
  };

  const openTerms = () => {
    window.open(TERMS_URL, "_blank");
    setHasReadTerms(true);
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[100] p-4">
      <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-ocean-600 to-ocean-500 p-6 text-white">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center">
              <FileText className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-bold">Үйлчилгээний нөхцөл</h2>
              <p className="text-sm text-white/80">Манай үйлчилгээг ашиглахын тулд зөвшөөрөх шаардлагатай</p>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          <div className="text-slate-600 text-sm leading-relaxed">
            <p className="mb-3">
              OYUNS FINANCE платформыг ашиглахын тулд та манай үйлчилгээний нөхцөлтэй танилцаж, зөвшөөрөх шаардлагатай.
            </p>
            <p>
              Үйлчилгээний нөхцөлд дараах мэдээллүүд багтана:
            </p>
            <ul className="list-disc list-inside mt-2 space-y-1 text-slate-500">
              <li>Ерөнхий үндэслэл</li>
              <li>Хувийн мэдээлэл цуглуулах, ашиглах, хамгаалах журам</li>
              <li>Үйлчилгээний нөхцөл</li>
              <li>Хэрэглэгчийн үүрэг, хариуцлага</li>
              <li>Гэрээний хүчин төгөлдөр байдал ба өөрчлөлт</li>
              <li>Маргаан шийдвэрлэх журам</li>
              <li>Холбоо барих мэдээлэл</li>
              <li>Зөвшөөрөл</li>
            </ul>
          </div>

          {/* Read Terms Button */}
          <button
            onClick={openTerms}
            className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl border-2 border-ocean-200 text-ocean-700 font-medium hover:bg-ocean-50 transition"
          >
            <ExternalLink className="w-5 h-5" />
            Хэрэглэгчийн гэрээтэй танилцах
          </button>

          {/* Checkbox */}
          <label className="flex items-start gap-3 cursor-pointer p-3 rounded-xl bg-slate-50 hover:bg-slate-100 transition">
            <input
              type="checkbox"
              checked={hasReadTerms}
              onChange={(e) => setHasReadTerms(e.target.checked)}
              className="mt-0.5 w-5 h-5 rounded border-slate-300 text-ocean-600 focus:ring-ocean-500"
            />
            <span className="text-sm text-slate-600">
              Би хэрэглэгчийн гэрээтэй танилцаж, зөвшөөрч байна
            </span>
          </label>

          {/* Error */}
          {error && (
            <div className="text-red-600 text-sm text-center bg-red-50 p-2 rounded-lg">
              {error}
            </div>
          )}

          {/* Agree Button */}
          <button
            onClick={handleAgree}
            disabled={loading || !hasReadTerms}
            className="w-full flex items-center justify-center gap-2 py-4 rounded-xl bg-ocean-600 text-white font-bold text-lg hover:bg-ocean-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Боловсруулж байна...
              </>
            ) : (
              <>
                <CheckCircle2 className="w-5 h-5" />
                Зөвшөөрч үргэлжлүүлэх
              </>
            )}
          </button>

          <p className="text-xs text-center text-slate-400">
            Хэрэглэгчийн гэрээтэй танилцахгүй бол та манай үйлчилгээг ашиглах боломжгүй болохыг анхаарна уу.
          </p>
        </div>
      </div>
    </div>
  );
}
