import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import {
  ArrowLeft, User, Phone, CreditCard, CheckCircle2, Tag, ChevronDown, ChevronUp,
  Gift, FileText, ExternalLink, Edit2, Loader2, AlertCircle, Building, Save, MessageCircle,
} from "lucide-react";
import { fetchMe, fetchUserPromoCodes, updateBankInfo, UpdateBankInfoInput } from "../api";
import { formatRussianPhone, formatCardNumber, formatIBAN, formatMongolianPhone } from "../components/RegistrationModal";

const TERMS_URL = "https://oyuns.mn/user-agreement";
const RUB_BANKS = ["Сбербанк", "Т-Банк", "Альфа-Банк", "ВТБ", "Райффайзен банк", "Газпромбанк", "ПСБ", "Россельхозбанк", "Бусад"];
const MNT_BANKS = ["Хаан банк", "Голомт банк", "М банк", "Хас банк", "Худалдаа хөгжлийн банк", "Ариг банк", "Богд банк", "Төрийн банк", "Капитрон банк", "Бусад"];

const parseBankRub = (bankStr: string | undefined) => {
  if (!bankStr || bankStr === ",,,") return { bankName: "", phoneSbp: "", cardNumber: "", ownerName: "", hasBank: false };
  const parts = bankStr.split(",").map(p => p.trim());
  return { bankName: parts[0] || "", phoneSbp: parts[1] || "", cardNumber: parts[2] || "", ownerName: parts[3] || "", hasBank: parts.some(p => p !== "") };
};

const parseBankMnt = (bankStr: string | undefined) => {
  if (!bankStr) return { bankName: "", accountNumber: "", ownerName: "", phone: "" };
  const parts = bankStr.split(",").map(p => p.trim());
  return { bankName: parts[0] || "", accountNumber: parts[1] || "", ownerName: parts[2] || "", phone: parts[3] || "" };
};

interface Props {
  userId?: number;
  onBack: () => void;
}

export function ProfilePage({ userId, onBack }: Props) {
  const queryClient = useQueryClient();
  const [showPromos, setShowPromos] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Bank form state
  const [phone, setPhone] = useState("");
  const [hasRubBank, setHasRubBank] = useState(false);
  const [rubBankName, setRubBankName] = useState("");
  const [rubBankNameOther, setRubBankNameOther] = useState("");
  const [rubPhoneSbp, setRubPhoneSbp] = useState("");
  const [rubCardNumber, setRubCardNumber] = useState("");
  const [rubOwnerName, setRubOwnerName] = useState("");
  const [mntBankName, setMntBankName] = useState("");
  const [mntBankNameOther, setMntBankNameOther] = useState("");
  const [mntAccountNumber, setMntAccountNumber] = useState("");
  const [mntOwnerName, setMntOwnerName] = useState("");
  const [mntPhone, setMntPhone] = useState("");

  const { data: profileData, isLoading } = useQuery({
    queryKey: ["me", userId],
    queryFn: () => fetchMe(),
    enabled: Boolean(userId),
    staleTime: 0,
  });
  const profile = profileData?.user;

  const { data: promoCodes, isLoading: promoLoading } = useQuery({
    queryKey: ["user-promos", userId],
    queryFn: () => fetchUserPromoCodes(),
    enabled: Boolean(userId) && showPromos,
  });

  useEffect(() => {
    if (profile && editMode) {
      setPhone(profile.phone || "");
      const rubBank = parseBankRub(profile.bank_rub);
      const mntBank = parseBankMnt(profile.bank_mnt);
      setHasRubBank(rubBank.hasBank);
      if (rubBank.bankName && !RUB_BANKS.includes(rubBank.bankName)) { setRubBankName("Бусад"); setRubBankNameOther(rubBank.bankName); } else { setRubBankName(rubBank.bankName); setRubBankNameOther(""); }
      setRubPhoneSbp(rubBank.phoneSbp);
      setRubCardNumber(rubBank.cardNumber);
      setRubOwnerName(rubBank.ownerName);
      if (mntBank.bankName && !MNT_BANKS.includes(mntBank.bankName)) { setMntBankName("Бусад"); setMntBankNameOther(mntBank.bankName); } else { setMntBankName(mntBank.bankName); setMntBankNameOther(""); }
      setMntAccountNumber(mntBank.accountNumber);
      setMntOwnerName(mntBank.ownerName);
      setMntPhone(mntBank.phone ? formatMongolianPhone(mntBank.phone) : "");
    }
  }, [profile, editMode]);

  const getActualRubBankName = () => rubBankName === "Бусад" ? rubBankNameOther.trim() : rubBankName;
  const getActualMntBankName = () => mntBankName === "Бусад" ? mntBankNameOther.trim() : mntBankName;

  const handleSave = async () => {
    try {
      setSaving(true);
      setError("");
      const payload: UpdateBankInfoInput = {
        phone,
        rub_bank_name: hasRubBank ? getActualRubBankName() : "",
        rub_phone_sbp: hasRubBank ? rubPhoneSbp : "",
        rub_card_number: hasRubBank ? rubCardNumber : "",
        rub_owner_name: hasRubBank ? rubOwnerName : "",
        mnt_bank_name: getActualMntBankName(),
        mnt_account_number: mntAccountNumber,
        mnt_owner_name: mntOwnerName,
        mnt_phone: mntPhone.replace(/\D/g, "").replace(/^976/, "").slice(0, 8),
      };
      await updateBankInfo(payload);
      queryClient.invalidateQueries({ queryKey: ["me", userId] });
      setEditMode(false);
    } catch {
      setError("Хадгалахад алдаа гарлаа");
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-4 animate-fadeIn">
        <Loader2 className="w-10 h-10 text-maroon-600 animate-spin" />
        <p className="text-dark-600 dark:text-ivory-400">Профайл ачаалж байна...</p>
      </div>
    );
  }

  return (
    <div className="animate-fadeIn space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="p-1.5 rounded-xl hover:bg-surface-100 dark:hover:bg-dark-700 transition">
          <ArrowLeft className="w-5 h-5 text-dark-600 dark:text-ivory-300" />
        </button>
        <h2 className="text-base font-bold text-dark-800 dark:text-ivory-200">{editMode ? "Мэдээлэл засах" : "Профайл"}</h2>
      </div>

      {profile ? (
        <div className="space-y-4">
          {/* Avatar & Name - hero card */}
          <div className="relative overflow-hidden bg-gradient-to-br from-maroon-700 via-maroon-800 to-dark-900 dark:from-maroon-900 dark:via-dark-900 dark:to-dark-950 p-5 rounded-3xl shadow-card-dark text-white">
            <div className="absolute -top-8 -right-8 w-28 h-28 bg-gold-400/15 rounded-full blur-2xl" />
            <div className="relative z-10 flex items-center gap-4">
              <div className="w-14 h-14 bg-gold-400/20 rounded-2xl flex items-center justify-center text-gold-400 font-bold text-xl shadow-btn">
                {profile.first_name?.[0] || "U"}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-bold text-base text-white">{profile.first_name} {profile.last_name}</div>
                {profile.username && <div className="text-sm text-white/60">@{profile.username}</div>}
                <div className="text-[11px] text-white/40 mt-0.5">ID: {profile.id}</div>
              </div>
              {profile.verified && (
                <div className="w-8 h-8 bg-green-500/20 rounded-xl flex items-center justify-center flex-shrink-0">
                  <CheckCircle2 className="w-5 h-5 text-green-400" />
                </div>
              )}
            </div>
          </div>

          {editMode ? (
            /* ───── Edit Mode ───── */
            <div className="space-y-4">
              {/* Phone */}
              <div>
                <label className="text-xs text-dark-600 dark:text-ivory-400 flex items-center gap-1 mb-1"><Phone className="w-3 h-3" /> Утас (Орос)</label>
                <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} className="w-full rounded-xl border border-silver dark:border-dark-600 bg-white dark:bg-dark-700 text-dark-800 dark:text-ivory-200 p-3 text-sm" placeholder="+7 900 123 4567" />
              </div>

              {/* RUB Bank */}
              <div className="space-y-2 p-4 bg-surface-50 dark:bg-dark-700 rounded-2xl">
                <div className="flex items-center gap-2 text-maroon-700 dark:text-maroon-300 font-semibold text-sm"><CreditCard className="w-4 h-4" />RUB банкны мэдээлэл</div>
                <label className="flex items-center gap-3 cursor-pointer p-2 rounded-lg bg-white dark:bg-dark-800">
                  <input type="checkbox" checked={hasRubBank} onChange={e => setHasRubBank(e.target.checked)} className="w-5 h-5 rounded border-silver dark:border-dark-600 text-maroon-600 focus:ring-maroon-500" />
                  <span className="text-sm text-dark-600 dark:text-ivory-300">Оросын банкны данс байгаа</span>
                </label>
                {hasRubBank && (
                  <div className="space-y-2 pl-3 border-l-2 border-maroon-200 dark:border-maroon-800">
                    <select value={rubBankName} onChange={e => setRubBankName(e.target.value)} className="w-full rounded-lg border border-silver dark:border-dark-600 bg-white dark:bg-dark-700 text-dark-800 dark:text-ivory-200 p-2 text-sm">
                      <option value="">Банк сонгоно уу</option>
                      {RUB_BANKS.map(b => <option key={b} value={b}>{b}</option>)}
                    </select>
                    {rubBankName === "Бусад" && <input type="text" value={rubBankNameOther} onChange={e => setRubBankNameOther(e.target.value)} className="w-full rounded-lg border border-silver dark:border-dark-600 bg-white dark:bg-dark-700 text-dark-800 dark:text-ivory-200 p-2 text-sm" placeholder="Банкны нэр" />}
                    <input type="tel" value={rubPhoneSbp} onChange={e => setRubPhoneSbp(formatRussianPhone(e.target.value))} className="w-full rounded-lg border border-silver dark:border-dark-600 bg-white dark:bg-dark-700 text-dark-800 dark:text-ivory-200 p-2 text-sm" placeholder="+7 XXX XXX XX XX" />
                    <input type="text" value={rubCardNumber} onChange={e => setRubCardNumber(formatCardNumber(e.target.value))} className="w-full rounded-lg border border-silver dark:border-dark-600 bg-white dark:bg-dark-700 text-dark-800 dark:text-ivory-200 p-2 text-sm" placeholder="XXXX XXXX XXXX XXXX" maxLength={19} />
                    <input type="text" value={rubOwnerName} onChange={e => setRubOwnerName(e.target.value)} className="w-full rounded-lg border border-silver dark:border-dark-600 bg-white dark:bg-dark-700 text-dark-800 dark:text-ivory-200 p-2 text-sm" placeholder="Эзэмшигчийн нэр" />
                  </div>
                )}
              </div>

              {/* MNT Bank */}
              <div className="space-y-2 p-4 bg-surface-50 dark:bg-dark-700 rounded-2xl">
                <div className="flex items-center gap-2 text-maroon-700 dark:text-maroon-300 font-semibold text-sm"><Building className="w-4 h-4" />MNT банкны мэдээлэл</div>
                <select value={mntBankName} onChange={e => setMntBankName(e.target.value)} className="w-full rounded-lg border border-silver dark:border-dark-600 bg-white dark:bg-dark-700 text-dark-800 dark:text-ivory-200 p-2 text-sm">
                  <option value="">Банк сонгоно уу</option>
                  {MNT_BANKS.map(b => <option key={b} value={b}>{b}</option>)}
                </select>
                {mntBankName === "Бусад" && <input type="text" value={mntBankNameOther} onChange={e => setMntBankNameOther(e.target.value)} className="w-full rounded-lg border border-silver dark:border-dark-600 bg-white dark:bg-dark-700 text-dark-800 dark:text-ivory-200 p-2 text-sm" placeholder="Банкны нэр" />}
                <input type="text" value={mntAccountNumber} onChange={e => setMntAccountNumber(formatIBAN(e.target.value))} className="w-full rounded-lg border border-silver dark:border-dark-600 bg-white dark:bg-dark-700 text-dark-800 dark:text-ivory-200 p-2 text-sm" placeholder="MN XX XXXX XX XXXXXXXXXX" />
                <input type="text" value={mntOwnerName} onChange={e => setMntOwnerName(e.target.value)} className="w-full rounded-lg border border-silver dark:border-dark-600 bg-white dark:bg-dark-700 text-dark-800 dark:text-ivory-200 p-2 text-sm" placeholder="Эзэмшигчийн нэр" />
                <input type="tel" value={mntPhone} onChange={e => setMntPhone(formatMongolianPhone(e.target.value))} className="w-full rounded-lg border border-silver dark:border-dark-600 bg-white dark:bg-dark-700 text-dark-800 dark:text-ivory-200 p-2 text-sm" placeholder="+976 XXXX XXXX" />
              </div>

              {error && (
                <div className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-400 text-sm">
                  <AlertCircle className="w-4 h-4" />{error}
                </div>
              )}

              <div className="flex gap-3">
                <button onClick={() => setEditMode(false)} className="flex-1 py-3 rounded-xl border border-silver dark:border-dark-600 text-dark-600 dark:text-ivory-300 font-medium hover:bg-surface-50 dark:hover:bg-dark-700 transition">Болих</button>
                <button onClick={handleSave} disabled={saving} className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-maroon-600 text-white font-medium shadow-btn hover:bg-maroon-500 transition disabled:opacity-50">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}Хадгалах
                </button>
              </div>
            </div>
          ) : (
            /* ───── View Mode ───── */
            <div className="space-y-4">
              {/* Contact Info - grouped list */}
              <div className="bg-white dark:bg-dark-800 rounded-2xl shadow-card-xs border border-silver/60 dark:border-dark-600 overflow-hidden divide-y divide-surface-50 dark:divide-dark-700">
                {profile.email && (
                  <div className="flex items-center gap-3 px-4 py-3">
                    <div className="w-8 h-8 bg-maroon-50 dark:bg-maroon-900/30 rounded-xl flex items-center justify-center"><span className="text-maroon-600 dark:text-maroon-400 text-xs font-bold">@</span></div>
                    <div className="flex-1 min-w-0"><div className="text-[11px] text-dark-600 dark:text-ivory-400 font-medium">Имэйл</div><div className="font-medium text-sm text-dark-800 dark:text-ivory-200 truncate">{profile.email}</div></div>
                  </div>
                )}
                {profile.phone && (
                  <div className="flex items-center gap-3 px-4 py-3">
                    <div className="w-8 h-8 bg-maroon-50 dark:bg-maroon-900/30 rounded-xl flex items-center justify-center"><Phone className="w-3.5 h-3.5 text-maroon-600 dark:text-maroon-400" /></div>
                    <div className="flex-1"><div className="text-[11px] text-dark-600 dark:text-ivory-400 font-medium">Орос утас</div><div className="font-medium text-sm text-dark-800 dark:text-ivory-200">{profile.phone}</div></div>
                  </div>
                )}
                {profile.phone_mnt && (
                  <div className="flex items-center gap-3 px-4 py-3">
                    <div className="w-8 h-8 bg-green-50 dark:bg-green-900/20 rounded-xl flex items-center justify-center"><Phone className="w-3.5 h-3.5 text-green-500" /></div>
                    <div className="flex-1"><div className="text-[11px] text-dark-600 dark:text-ivory-400 font-medium">Монгол утас</div><div className="font-medium text-sm text-dark-800 dark:text-ivory-200">{profile.phone_mnt}</div></div>
                  </div>
                )}
              </div>

              {/* Banks */}
              <div className="grid grid-cols-2 gap-3">
                {profile.bank_rub && (
                  <div className="p-3.5 bg-surface-50 dark:bg-dark-700 rounded-xl">
                    <div className="flex items-center gap-1.5 text-[11px] text-dark-600 dark:text-ivory-400 font-medium mb-1"><CreditCard className="w-3 h-3" /> RUB банк</div>
                    <div className="font-medium text-sm text-dark-800 dark:text-ivory-200 truncate">{profile.bank_rub}</div>
                  </div>
                )}
                {profile.bank_mnt && (
                  <div className="p-3.5 bg-surface-50 dark:bg-dark-700 rounded-xl">
                    <div className="flex items-center gap-1.5 text-[11px] text-dark-600 dark:text-ivory-400 font-medium mb-1"><CreditCard className="w-3 h-3" /> MNT банк</div>
                    <div className="font-medium text-sm text-dark-800 dark:text-ivory-200 truncate">{profile.bank_mnt}</div>
                  </div>
                )}
              </div>

              {/* Edit Bank */}
              {profile.verified && (profile.bank_rub || profile.bank_mnt) && (
                <button onClick={() => setEditMode(true)} className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-silver dark:border-dark-600 text-dark-600 dark:text-ivory-300 font-medium hover:bg-surface-50 dark:hover:bg-dark-700 transition">
                  <Edit2 className="w-3.5 h-3.5" />Засах
                </button>
              )}

              {/* Promo Codes */}
              <div className="bg-white dark:bg-dark-800 rounded-2xl overflow-hidden shadow-card-xs border border-silver/60 dark:border-dark-600">
                <button onClick={() => setShowPromos(!showPromos)} className="w-full px-4 py-3 flex items-center justify-between hover:bg-surface-50 dark:hover:bg-dark-700 transition">
                  <div className="flex items-center gap-2.5"><Tag className="w-4 h-4 text-purple-500" /><span className="font-medium text-sm text-dark-800 dark:text-ivory-200">Промокодууд</span></div>
                  {showPromos ? <ChevronUp className="w-4 h-4 text-dark-600 dark:text-ivory-400" /> : <ChevronDown className="w-4 h-4 text-dark-600 dark:text-ivory-400" />}
                </button>
                {showPromos && (
                  <div className="p-3 border-t border-silver/60 dark:border-dark-600">
                    {promoLoading ? (
                      <div className="text-center text-dark-600 dark:text-ivory-400 text-sm py-2">Ачаалж байна...</div>
                    ) : promoCodes?.promo_codes && promoCodes.promo_codes.length > 0 ? (
                      <div className="space-y-2">
                        {promoCodes.promo_codes.map(promo => (
                          <div key={promo.code} className={`p-3 rounded-lg border ${promo.active ? "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800" : "bg-surface-50 dark:bg-dark-700 border-silver dark:border-dark-600 opacity-60"}`}>
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2"><Gift className="w-4 h-4 text-purple-500" /><span className="font-mono font-bold text-maroon-700 dark:text-maroon-300">{promo.code}</span></div>
                              <span className={`text-xs px-2 py-0.5 rounded-full ${promo.active ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400" : "bg-silver dark:bg-dark-600 text-dark-600 dark:text-ivory-400"}`}>{promo.active ? "Идэвхтэй" : "Идэвхгүй"}</span>
                            </div>
                            <div className="mt-1 text-sm text-dark-600 dark:text-ivory-300"><span className="font-medium text-green-600 dark:text-green-400">+{promo.discount} ₮</span> ханшинд нэмэгдэнэ</div>
                            {promo.expires_at && <div className="mt-1 text-xs text-dark-600 dark:text-ivory-400">Дуусах: {new Date(promo.expires_at).toLocaleDateString()}</div>}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center text-dark-600 dark:text-ivory-400 text-sm py-2">Танд одоогоор промокод байхгүй байна</div>
                    )}
                  </div>
                )}
              </div>

              {/* Actions - grouped list */}
              <div className="bg-white dark:bg-dark-800 rounded-2xl shadow-card-xs border border-silver/60 dark:border-dark-600 overflow-hidden divide-y divide-surface-50 dark:divide-dark-700">
                <a href="https://t.me/oyuns_finance" target="_blank" rel="noopener noreferrer" className="flex items-center justify-between px-4 py-3 hover:bg-surface-50 dark:hover:bg-dark-700 transition">
                  <div className="flex items-center gap-2.5"><MessageCircle className="w-4 h-4 text-maroon-600 dark:text-maroon-400" /><span className="font-medium text-sm text-dark-800 dark:text-ivory-200">Тусламж</span></div>
                  <ExternalLink className="w-3.5 h-3.5 text-dark-600 dark:text-ivory-400" />
                </a>
                <a href={TERMS_URL} target="_blank" rel="noopener noreferrer" className="flex items-center justify-between px-4 py-3 hover:bg-surface-50 dark:hover:bg-dark-700 transition">
                  <div className="flex items-center gap-2.5"><FileText className="w-4 h-4 text-dark-600 dark:text-ivory-400" /><span className="font-medium text-sm text-dark-800 dark:text-ivory-200">Хэрэглэгчийн гэрээ</span></div>
                  <ExternalLink className="w-3.5 h-3.5 text-dark-600 dark:text-ivory-400" />
                </a>
              </div>

              {/* App Version */}
              <div className="text-center text-xs text-dark-600 dark:text-ivory-400 pt-2">
                Oyuns Finance v2.0 • © 2026
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="text-center text-dark-600 dark:text-ivory-400 py-12">Профайл ачаалж чадсангүй</div>
      )}
    </div>
  );
}
