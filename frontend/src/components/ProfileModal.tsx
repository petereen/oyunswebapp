import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { X, User, Phone, CreditCard, CheckCircle2, Tag, ChevronDown, ChevronUp, Gift, FileText, ExternalLink, Edit2, Loader2, AlertCircle, Building, Save } from "lucide-react";
import { fetchMe, fetchUserPromoCodes, updateBankInfo, UserProfile, UserPromoCode, UpdateBankInfoInput } from "../api";

const TERMS_URL = "https://oyuns.mn/oyuns-aio-telegram-bot-%d1%85%d1%8d%d1%80%d1%8d%d0%b3%d0%bb%d1%8d%d0%b3%d1%87%d0%b8%d0%b9%d0%bd-%d0%b3%d1%8d%d1%80%d1%8d%d1%8d/";

interface Props {
  initData: string;
  onClose: () => void;
}

// Helper to parse bank string
const parseBankRub = (bankStr: string | undefined) => {
  if (!bankStr) return { bankName: "", phoneSbp: "", cardNumber: "", ownerName: "" };
  const parts = bankStr.split(",").map(p => p.trim());
  return {
    bankName: parts[0] || "",
    phoneSbp: parts[1] || "",
    cardNumber: parts[2] || "",
    ownerName: parts[3] || "",
  };
};

const parseBankMnt = (bankStr: string | undefined) => {
  if (!bankStr) return { bankName: "", accountNumber: "", ownerName: "" };
  const parts = bankStr.split(",").map(p => p.trim());
  return {
    bankName: parts[0] || "",
    accountNumber: parts[1] || "",
    ownerName: parts[2] || "",
  };
};

export function ProfileModal({ initData, onClose }: Props) {
  const queryClient = useQueryClient();
  const [showPromos, setShowPromos] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  
  // Bank info form state
  const [phone, setPhone] = useState("");
  const [rubBankName, setRubBankName] = useState("");
  const [rubPhoneSbp, setRubPhoneSbp] = useState("");
  const [rubCardNumber, setRubCardNumber] = useState("");
  const [rubOwnerName, setRubOwnerName] = useState("");
  const [mntBankName, setMntBankName] = useState("");
  const [mntAccountNumber, setMntAccountNumber] = useState("");
  const [mntOwnerName, setMntOwnerName] = useState("");
  
  const { data: profile, isLoading } = useQuery({
    queryKey: ["me", initData],
    queryFn: () => fetchMe(initData),
    enabled: Boolean(initData),
  });

  const { data: promoCodes, isLoading: promoLoading } = useQuery({
    queryKey: ["user-promos", initData],
    queryFn: () => fetchUserPromoCodes(initData),
    enabled: Boolean(initData) && showPromos,
  });

  // Initialize form values when profile loads or edit mode is enabled
  useEffect(() => {
    if (profile && editMode) {
      setPhone(profile.phone || "");
      const rubBank = parseBankRub(profile.bank_rub);
      const mntBank = parseBankMnt(profile.bank_mnt);
      setRubBankName(rubBank.bankName);
      setRubPhoneSbp(rubBank.phoneSbp);
      setRubCardNumber(rubBank.cardNumber);
      setRubOwnerName(rubBank.ownerName);
      setMntBankName(mntBank.bankName);
      setMntAccountNumber(mntBank.accountNumber);
      setMntOwnerName(mntBank.ownerName);
    }
  }, [profile, editMode]);

  const handleSave = async () => {
    try {
      setSaving(true);
      setError("");
      const payload: UpdateBankInfoInput = {
        phone,
        rub_bank_name: rubBankName,
        rub_phone_sbp: rubPhoneSbp,
        rub_card_number: rubCardNumber,
        rub_owner_name: rubOwnerName,
        mnt_bank_name: mntBankName,
        mnt_account_number: mntAccountNumber,
        mnt_owner_name: mntOwnerName,
      };
      await updateBankInfo(initData, payload);
      queryClient.invalidateQueries({ queryKey: ["me", initData] });
      setEditMode(false);
    } catch (err) {
      console.error("Save error:", err);
      setError("Хадгалахад алдаа гарлаа");
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
        <div className="glass-card rounded-2xl p-6 w-full max-w-md">
          <div className="text-center text-slate-500">Профайл ачаалж байна...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-auto" onClick={onClose}>
      <div className="glass-card rounded-2xl p-6 w-full max-w-md my-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-ocean-700">{editMode ? "Банкны мэдээлэл засах" : "Миний профайл"}</h2>
          <button onClick={onClose} className="p-2 hover:bg-ocean-100 rounded-full">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        {profile ? (
          <div className="space-y-4">
            {/* User Info - Always shown */}
            <div className="flex items-center gap-3 p-3 bg-ocean-50 rounded-xl">
              <div className="w-12 h-12 bg-ocean-600 rounded-full flex items-center justify-center text-white font-bold text-lg">
                {profile.first_name?.[0] || "U"}
              </div>
              <div>
                <div className="font-semibold text-ocean-700">
                  {profile.first_name} {profile.last_name}
                </div>
                <div className="text-xs text-slate-500">ID: {profile.id}</div>
              </div>
              {profile.verified && (
                <CheckCircle2 className="w-5 h-5 text-green-500 ml-auto" />
              )}
            </div>

            {editMode ? (
              /* Edit Mode Form */
              <div className="space-y-4 max-h-[60vh] overflow-auto">
                {/* Phone */}
                <div>
                  <label className="text-xs text-slate-500 flex items-center gap-1">
                    <Phone className="w-3 h-3" /> Утас (Орос)
                  </label>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full rounded-lg border border-ocean-200 p-2.5 text-sm"
                    placeholder="+7 900 123 4567"
                  />
                </div>

                {/* RUB Bank Section */}
                <div className="space-y-2 p-3 bg-slate-50 rounded-xl">
                  <div className="flex items-center gap-2 text-ocean-700 font-semibold text-sm">
                    <CreditCard className="w-4 h-4" />
                    RUB банкны мэдээлэл
                  </div>
                  <input
                    type="text"
                    value={rubBankName}
                    onChange={(e) => setRubBankName(e.target.value)}
                    className="w-full rounded-lg border border-ocean-200 p-2 text-sm"
                    placeholder="Банкны нэр (Tinkoff, Sber...)"
                  />
                  <input
                    type="tel"
                    value={rubPhoneSbp}
                    onChange={(e) => setRubPhoneSbp(e.target.value)}
                    className="w-full rounded-lg border border-ocean-200 p-2 text-sm"
                    placeholder="СБП утас"
                  />
                  <input
                    type="text"
                    value={rubCardNumber}
                    onChange={(e) => setRubCardNumber(e.target.value)}
                    className="w-full rounded-lg border border-ocean-200 p-2 text-sm"
                    placeholder="Картын дугаар"
                  />
                  <input
                    type="text"
                    value={rubOwnerName}
                    onChange={(e) => setRubOwnerName(e.target.value)}
                    className="w-full rounded-lg border border-ocean-200 p-2 text-sm"
                    placeholder="Эзэмшигчийн нэр"
                  />
                </div>

                {/* MNT Bank Section */}
                <div className="space-y-2 p-3 bg-slate-50 rounded-xl">
                  <div className="flex items-center gap-2 text-ocean-700 font-semibold text-sm">
                    <Building className="w-4 h-4" />
                    MNT банкны мэдээлэл
                  </div>
                  <input
                    type="text"
                    value={mntBankName}
                    onChange={(e) => setMntBankName(e.target.value)}
                    className="w-full rounded-lg border border-ocean-200 p-2 text-sm"
                    placeholder="Банкны нэр (Хаан, Голомт...)"
                  />
                  <input
                    type="text"
                    value={mntAccountNumber}
                    onChange={(e) => setMntAccountNumber(e.target.value)}
                    className="w-full rounded-lg border border-ocean-200 p-2 text-sm"
                    placeholder="Дансны дугаар"
                  />
                  <input
                    type="text"
                    value={mntOwnerName}
                    onChange={(e) => setMntOwnerName(e.target.value)}
                    className="w-full rounded-lg border border-ocean-200 p-2 text-sm"
                    placeholder="Эзэмшигчийн нэр"
                  />
                </div>

                {/* Error */}
                {error && (
                  <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                    <AlertCircle className="w-4 h-4" />
                    {error}
                  </div>
                )}

                {/* Save/Cancel Buttons */}
                <div className="flex gap-2">
                  <button
                    onClick={() => setEditMode(false)}
                    className="flex-1 py-3 rounded-xl border border-ocean-200 text-ocean-700 font-medium hover:bg-ocean-50 transition"
                  >
                    Болих
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-ocean-600 text-white font-medium hover:bg-ocean-700 transition disabled:opacity-50"
                  >
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    Хадгалах
                  </button>
                </div>
              </div>
            ) : (
              /* View Mode */
              <>
                {/* Contact */}
                {profile.phone && (
                  <div className="flex items-center gap-3 p-3 border border-ocean-100 rounded-xl">
                    <Phone className="w-5 h-5 text-ocean-600" />
                    <div>
                      <div className="text-xs text-slate-500">Утас</div>
                      <div className="font-medium">{profile.phone}</div>
                    </div>
                  </div>
                )}

                {/* Banks */}
                <div className="grid grid-cols-2 gap-3">
                  {profile.bank_rub && (
                    <div className="p-3 border border-ocean-100 rounded-xl">
                      <div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
                        <CreditCard className="w-4 h-4" /> RUB банк
                      </div>
                      <div className="font-medium text-sm truncate">{profile.bank_rub}</div>
                    </div>
                  )}
                  {profile.bank_mnt && (
                    <div className="p-3 border border-ocean-100 rounded-xl">
                      <div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
                        <CreditCard className="w-4 h-4" /> MNT банк
                      </div>
                      <div className="font-medium text-sm truncate">{profile.bank_mnt}</div>
                    </div>
                  )}
                </div>

                {/* Edit Bank Info Button - Only for verified users */}
                {profile.verified && (profile.bank_rub || profile.bank_mnt) && (
                  <button
                    onClick={() => setEditMode(true)}
                    className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-ocean-200 text-ocean-700 font-medium hover:bg-ocean-50 transition"
                  >
                    <Edit2 className="w-4 h-4" />
                    Банкны мэдээлэл засах
                  </button>
                )}

                {/* Promo Codes Section */}
                <div className="border border-ocean-100 rounded-xl overflow-hidden">
                  <button
                    onClick={() => setShowPromos(!showPromos)}
                    className="w-full p-3 flex items-center justify-between bg-gradient-to-r from-purple-50 to-pink-50 hover:from-purple-100 hover:to-pink-100 transition"
                  >
                    <div className="flex items-center gap-2">
                      <Tag className="w-5 h-5 text-purple-600" />
                      <span className="font-medium text-purple-700">Миний промокодууд</span>
                    </div>
                    {showPromos ? (
                      <ChevronUp className="w-5 h-5 text-purple-600" />
                    ) : (
                      <ChevronDown className="w-5 h-5 text-purple-600" />
                    )}
                  </button>
                  
                  {showPromos && (
                    <div className="p-3 bg-white border-t border-ocean-100">
                      {promoLoading ? (
                        <div className="text-center text-slate-500 text-sm py-2">Ачаалж байна...</div>
                      ) : promoCodes?.promo_codes && promoCodes.promo_codes.length > 0 ? (
                        <div className="space-y-2">
                          {promoCodes.promo_codes.map((promo) => (
                            <div 
                              key={promo.code}
                              className={`p-3 rounded-lg border ${promo.active ? 'bg-green-50 border-green-200' : 'bg-slate-50 border-slate-200 opacity-60'}`}
                            >
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <Gift className="w-4 h-4 text-purple-500" />
                                  <span className="font-mono font-bold text-ocean-700">{promo.code}</span>
                                </div>
                                <span className={`text-xs px-2 py-0.5 rounded-full ${promo.active ? 'bg-green-100 text-green-700' : 'bg-slate-200 text-slate-500'}`}>
                                  {promo.active ? 'Идэвхтэй' : 'Идэвхгүй'}
                                </span>
                              </div>
                              <div className="mt-1 text-sm text-slate-600">
                                <span className="font-medium text-green-600">+{promo.discount} ₮</span> ханшинд нэмэгдэнэ
                              </div>
                              {promo.expires_at && (
                                <div className="mt-1 text-xs text-slate-400">
                                  Дуусах: {new Date(promo.expires_at).toLocaleDateString()}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-center text-slate-500 text-sm py-2">
                          Танд одоогоор промокод байхгүй байна
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Verification Status */}
                <div className={`p-3 rounded-xl text-center ${profile.verified ? 'bg-green-50' : 'bg-yellow-50'}`}>
                  {profile.verified ? (
                    <div className="text-green-700 font-medium flex items-center justify-center gap-2">
                      <CheckCircle2 className="w-5 h-5" /> Хэрэглэгчийн мэдээлэл баталгаажсан
                    </div>
                  ) : (
                    <div className="text-yellow-700 font-medium">
                      Хэрэглэгчийн мэдээлэл баталгаажаагүй байна
                    </div>
                  )}
                </div>

                {/* Terms of Service Link */}
                <a
                  href={TERMS_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between p-3 border border-ocean-100 rounded-xl hover:bg-ocean-50 transition"
                >
                  <div className="flex items-center gap-2">
                    <FileText className="w-5 h-5 text-ocean-600" />
                    <span className="font-medium text-ocean-700">Хэрэглэгчийн гэрээ</span>
                  </div>
                  <ExternalLink className="w-4 h-4 text-slate-400" />
                </a>
              </>
            )}
          </div>
        ) : (
          <div className="text-center text-slate-500">Профайл ачаалж чадсангүй</div>
        )}
      </div>
    </div>
  );
}
