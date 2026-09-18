import { useEffect, useState } from "react";
import {
  Image,
  RefreshCw,
  Save,
  Settings,
  Upload,
  X,
} from "lucide-react";
import {
  DEFAULT_APP_SETTINGS,
  ExchangeGroupAutomationSettings,
  AppSettings,
  fetchAppSettings,
  fetchExchangeGroupSettings,
  requestPresign,
  updateAppSettings,
  updateExchangeGroupSettings,
} from "../../api";
import { AdminRefreshButton, AdminSectionHeader } from "./AdminPanelPrimitives";

type NumericAppSettingsField =
  | "min_rub_amount"
  | "min_rub_buy"
  | "oyuns_plus_enabled"
  | "oyuns_plus_threshold_rub"
  | "oyuns_plus_points_per_threshold"
  | "oyuns_plus_referral_reward_points"
  | "oyuns_plus_referral_max_uses";

const HOME_BANNER_TARGET_RATIO = 3;

export function AdminSettings() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [exchangeLimits, setExchangeLimits] = useState<AppSettings>(DEFAULT_APP_SETTINGS);
  const [editingLimits, setEditingLimits] = useState<AppSettings>(DEFAULT_APP_SETTINGS);
  const [limitsChanged, setLimitsChanged] = useState(false);
  const [savingLimits, setSavingLimits] = useState(false);
  const [bannerUploading, setBannerUploading] = useState(false);
  const [bannerUploadError, setBannerUploadError] = useState("");
  const [groupSettings, setGroupSettings] = useState<ExchangeGroupAutomationSettings>({ mnt_to_rub_enabled: 0, rub_to_mnt_enabled: 0, telegram_group_id: null });
  const [editingGroupSettings, setEditingGroupSettings] = useState<ExchangeGroupAutomationSettings>({ mnt_to_rub_enabled: 0, rub_to_mnt_enabled: 0, telegram_group_id: null });
  const [savingGroupSettings, setSavingGroupSettings] = useState(false);

  const loadSettings = async () => {
    setLoading(true);
    setError("");
    try {
      const [settings, groups] = await Promise.all([fetchAppSettings(), fetchExchangeGroupSettings()]);
      setExchangeLimits(settings);
      setEditingLimits(settings);
      setGroupSettings(groups);
      setEditingGroupSettings(groups);
      setLimitsChanged(false);
    } catch (err) {
      console.error("Failed to load admin settings:", err);
      setError("Тохиргоо ачаалахад алдаа гарлаа");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadSettings(); }, []);

  const hasSettingsChanges = (next: AppSettings) =>
    next.min_rub_amount !== exchangeLimits.min_rub_amount ||
    next.min_rub_buy !== exchangeLimits.min_rub_buy ||
    next.oyuns_plus_enabled !== exchangeLimits.oyuns_plus_enabled ||
    next.oyuns_plus_threshold_rub !== exchangeLimits.oyuns_plus_threshold_rub ||
    next.oyuns_plus_points_per_threshold !== exchangeLimits.oyuns_plus_points_per_threshold ||
    next.oyuns_plus_referral_reward_points !== exchangeLimits.oyuns_plus_referral_reward_points ||
    next.oyuns_plus_referral_max_uses !== exchangeLimits.oyuns_plus_referral_max_uses ||
    next.home_banner_enabled !== exchangeLimits.home_banner_enabled ||
    next.home_banner_image_url.trim() !== exchangeLimits.home_banner_image_url.trim() ||
    next.home_banner_link_url.trim() !== exchangeLimits.home_banner_link_url.trim() ||
    next.email_verification_enabled !== exchangeLimits.email_verification_enabled;

  const updateLimits = (updated: AppSettings) => {
    setEditingLimits(updated);
    setLimitsChanged(hasSettingsChanges(updated));
  };

  const handleLimitsChange = (field: NumericAppSettingsField, value: string) => {
    const num = parseInt(value, 10);
    if (value !== "" && Number.isNaN(num)) return;
    updateLimits({ ...editingLimits, [field]: value === "" ? 0 : num });
  };

  const handleToggle = (field: "oyuns_plus_enabled" | "home_banner_enabled" | "email_verification_enabled", enabled: boolean) => {
    updateLimits({ ...editingLimits, [field]: enabled ? 1 : 0 });
  };

  const handleBannerImageUpload = async (file: File) => {
    setBannerUploadError("");
    const img = new window.Image();
    img.onload = async () => {
      URL.revokeObjectURL(img.src);
      if (Math.abs(img.width / img.height - HOME_BANNER_TARGET_RATIO) > 0.12) {
        setBannerUploadError("Banner зураг 3:1 харьцаатай байх ёстой. Жишээ нь 1200x400.");
        return;
      }
      setBannerUploading(true);
      try {
        const ext = file.name.split(".").pop() || "jpg";
        const path = `home-banners/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
        const presigned = await requestPresign({ bucket: "bills", path });
        await fetch(presigned.upload_url, { method: "PUT", body: file, headers: { "Content-Type": file.type } });
        updateLimits({ ...editingLimits, home_banner_image_url: presigned.public_url });
      } catch {
        setBannerUploadError("Banner зураг оруулахад алдаа гарлаа");
      } finally {
        setBannerUploading(false);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(img.src);
      setBannerUploadError("Зургийг уншихад алдаа гарлаа");
    };
    img.src = URL.createObjectURL(file);
  };

  const saveLimits = async () => {
    setSavingLimits(true);
    setError("");
    try {
      const result = await updateAppSettings(editingLimits);
      setExchangeLimits(result);
      setEditingLimits(result);
      setLimitsChanged(false);
    } catch (err) {
      console.error("Failed to save exchange limits:", err);
      setError("Лимит хадгалахад алдаа гарлаа");
    } finally {
      setSavingLimits(false);
    }
  };

  const saveGroupSettings = async () => {
    setSavingGroupSettings(true);
    setError("");
    try {
      const result = await updateExchangeGroupSettings({
        telegram_group_id: editingGroupSettings.telegram_group_id,
        mnt_to_rub_enabled: 0,
        rub_to_mnt_enabled: 0,
      });
      setGroupSettings(result);
      setEditingGroupSettings(result);
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
      setError(typeof detail === "string" && detail.trim() ? detail : "Telegram группийн тохиргоо хадгалахад алдаа гарлаа");
    } finally {
      setSavingGroupSettings(false);
    }
  };

  if (loading) return <div className="flex items-center justify-center py-12"><RefreshCw className="w-8 h-8 text-maroon-500 animate-spin" /></div>;

  const groupSettingsChanged = groupSettings.telegram_group_id !== editingGroupSettings.telegram_group_id;
  const toggle = (field: "oyuns_plus_enabled" | "home_banner_enabled" | "email_verification_enabled", label: string, description: string) => (
    <div className="flex items-center justify-between gap-4">
      <div><p className="text-sm font-semibold text-slate-700 dark:text-ivory-200">{label}</p><p className="text-xs text-slate-500 dark:text-ivory-400">{description}</p></div>
      <label className="inline-flex items-center cursor-pointer"><input type="checkbox" className="sr-only" checked={editingLimits[field] > 0} onChange={(event) => handleToggle(field, event.target.checked)} /><span className={`w-11 h-6 rounded-full transition relative ${editingLimits[field] > 0 ? "bg-maroon-600" : "bg-slate-300"}`}><span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition ${editingLimits[field] > 0 ? "left-5" : "left-0.5"}`} /></span></label>
    </div>
  );

  return (
    <div className="space-y-4">
      <AdminSectionHeader icon={Settings} title="Системийн тохиргоо" action={<AdminRefreshButton onClick={() => void loadSettings()} loading={loading} label="Системийн тохиргоо шинэчлэх" />} />
      {error && <div className="p-3 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-300 rounded-lg text-sm">{error}</div>}

      <details open className="p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl space-y-4">
        <summary className="cursor-pointer list-none"><h4 className="font-semibold text-blue-800 dark:text-blue-300 flex items-center gap-2"><Settings className="w-4 h-4" /> Telegram тохиргоо</h4><p className="text-xs text-blue-600 dark:text-blue-400 mt-1">Inbox дээрх “Групп рүү илгээх” үйлдлийн дараа сонгосон хүсэлтийг энэ группт илгээнэ.</p></summary>
        <div><label className="text-xs text-slate-600 dark:text-ivory-400 font-medium">Telegram group ID</label><input type="number" value={editingGroupSettings.telegram_group_id ?? ""} onChange={(event) => setEditingGroupSettings((current) => ({ ...current, telegram_group_id: event.target.value === "" ? null : Number(event.target.value) }))} placeholder="-1001234567890" className="w-full mt-1 p-2 border border-blue-300 dark:border-blue-800 rounded-lg text-sm font-mono bg-white dark:bg-dark-700 dark:text-ivory-200 focus:ring-2 focus:ring-blue-400" /><p className="text-[11px] text-slate-500 dark:text-ivory-400 mt-1">Group ID нь сөрөг тоо байна. Bot группт message илгээх эрхтэй байх ёстой.</p></div>
        {groupSettingsChanged && <div className="flex justify-end"><button onClick={() => void saveGroupSettings()} disabled={savingGroupSettings} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition text-sm disabled:opacity-50">{savingGroupSettings ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}Telegram тохиргоо хадгалах</button></div>}
      </details>

      <details open className="p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl space-y-4">
        <summary className="cursor-pointer list-none"><h4 className="font-semibold text-amber-800 dark:text-amber-300 flex items-center gap-2"><Settings className="w-4 h-4" /> Лимит ба хязгаар</h4></summary>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4"><label className="text-xs text-slate-600 dark:text-ivory-400 font-medium">🇷🇺→🇲🇳 RUB→MNT (доод ₽)<input type="number" min={0} value={editingLimits.min_rub_buy} onChange={(event) => handleLimitsChange("min_rub_buy", event.target.value)} className="w-full mt-1 p-2 border border-amber-300 dark:border-amber-800 rounded-lg text-sm bg-white dark:bg-dark-700 dark:text-ivory-200" /></label><label className="text-xs text-slate-600 dark:text-ivory-400 font-medium">🇲🇳→🇷🇺 MNT→RUB (доод ₽)<input type="number" min={0} value={editingLimits.min_rub_amount} onChange={(event) => handleLimitsChange("min_rub_amount", event.target.value)} className="w-full mt-1 p-2 border border-amber-300 dark:border-amber-800 rounded-lg text-sm bg-white dark:bg-dark-700 dark:text-ivory-200" /></label></div>
        {toggle("email_verification_enabled", "Имэйл баталгаажуулалт (бүртгэл)", "Унтраавал бүртгүүлэхэд имэйл код шаардахгүй, шууд идэвхжинэ.")}
      </details>

      <details open className="p-4 bg-white dark:bg-dark-800 border border-slate-200 dark:border-dark-600 rounded-xl space-y-4">
        <summary className="cursor-pointer list-none"><h4 className="font-semibold text-slate-800 dark:text-ivory-200 flex items-center gap-2"><Settings className="w-4 h-4 text-maroon-600" /> OYUNS Plus ба нэмэлт</h4></summary>
        {toggle("oyuns_plus_enabled", "OYUNS Plus", "Оноо тооцох систем")}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4"><label className="text-xs text-slate-600 dark:text-ivory-400 font-medium">Оноо тооцох босго (₽)<input type="number" min={1} value={editingLimits.oyuns_plus_threshold_rub} onChange={(event) => handleLimitsChange("oyuns_plus_threshold_rub", event.target.value)} className="w-full mt-1 p-2 border border-slate-200 dark:border-dark-600 rounded-lg text-sm bg-white dark:bg-dark-700 dark:text-ivory-200" /></label><label className="text-xs text-slate-600 dark:text-ivory-400 font-medium">Босго рублид харгалзах оноо<input type="number" min={1} value={editingLimits.oyuns_plus_points_per_threshold} onChange={(event) => handleLimitsChange("oyuns_plus_points_per_threshold", event.target.value)} className="w-full mt-1 p-2 border border-slate-200 dark:border-dark-600 rounded-lg text-sm bg-white dark:bg-dark-700 dark:text-ivory-200" /></label><label className="text-xs text-slate-600 dark:text-ivory-400 font-medium">Найзаа уриад авах OYUNS+ оноо<input type="number" min={0} value={editingLimits.oyuns_plus_referral_reward_points} onChange={(event) => handleLimitsChange("oyuns_plus_referral_reward_points", event.target.value)} className="w-full mt-1 p-2 border border-slate-200 dark:border-dark-600 rounded-lg text-sm bg-white dark:bg-dark-700 dark:text-ivory-200" /></label><label className="text-xs text-slate-600 dark:text-ivory-400 font-medium">Нэг хэрэглэгчийн урих найзын хязгаар<input type="number" min={1} value={editingLimits.oyuns_plus_referral_max_uses} onChange={(event) => handleLimitsChange("oyuns_plus_referral_max_uses", event.target.value)} className="w-full mt-1 p-2 border border-slate-200 dark:border-dark-600 rounded-lg text-sm bg-white dark:bg-dark-700 dark:text-ivory-200" /></label></div>
        <div className="pt-3 border-t border-slate-200 dark:border-dark-600 space-y-3">{toggle("home_banner_enabled", "Home дээрх түр banner", "Зарлал эсвэл сурталчилгааны зураг Home tab-ын дээд хэсэгт харагдана.")}<div className="grid grid-cols-1 md:grid-cols-2 gap-4"><div className="space-y-2"><div className="text-xs text-slate-600 dark:text-ivory-400 font-medium flex items-center gap-1"><Image className="w-3 h-3" /> Banner зураг (3:1, 1200x400 санал болгох)</div>{editingLimits.home_banner_image_url ? <div className="space-y-2"><div className="overflow-hidden rounded-xl border border-amber-200 bg-white aspect-[3/1]"><img src={editingLimits.home_banner_image_url} alt="Home banner preview" className="w-full h-full object-cover" /></div><div className="flex gap-2"><label className="cursor-pointer inline-flex items-center gap-2 px-3 py-2 bg-white dark:bg-dark-700 border border-amber-300 rounded-lg text-sm text-slate-700 dark:text-ivory-200 hover:bg-amber-50"><Upload className="w-4 h-4" />Зураг солих<input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void handleBannerImageUpload(file); }} disabled={bannerUploading} /></label><button type="button" onClick={() => updateLimits({ ...editingLimits, home_banner_image_url: "" })} className="inline-flex items-center gap-2 px-3 py-2 bg-white dark:bg-dark-700 border border-red-200 rounded-lg text-sm text-red-600 hover:bg-red-50"><X className="w-4 h-4" />Зураг устгах</button></div></div> : <label className="block cursor-pointer"><input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void handleBannerImageUpload(file); }} disabled={bannerUploading} /><div className="border-2 border-dashed border-amber-300 rounded-xl p-4 text-center hover:border-amber-400 transition bg-white dark:bg-dark-700">{bannerUploading ? <RefreshCw className="w-5 h-5 text-amber-500 mx-auto animate-spin" /> : <Upload className="w-5 h-5 text-amber-500 mx-auto mb-2" />}<div className="text-xs text-slate-500 dark:text-ivory-400">PNG/JPG/WEBP, 3:1 banner</div></div></label>}{bannerUploadError && <div className="text-xs text-red-500">{bannerUploadError}</div>}</div><div className="space-y-2"><label className="text-xs text-slate-600 dark:text-ivory-400 font-medium">Banner дарахад нээгдэх холбоос<input type="text" value={editingLimits.home_banner_link_url} onChange={(event) => updateLimits({ ...editingLimits, home_banner_link_url: event.target.value })} placeholder="/?tab=oyuns-plus" className="w-full mt-1 p-2 border border-amber-300 dark:border-amber-800 rounded-lg text-sm bg-white dark:bg-dark-700 dark:text-ivory-200" /></label><div className="text-xs text-slate-500 dark:text-ivory-400">App доторх tab руу орох замыг оруулна.</div></div></div></div>
        {limitsChanged && <div className="flex justify-end"><button onClick={() => void saveLimits()} disabled={savingLimits} className="flex items-center gap-2 px-4 py-2 bg-maroon-600 text-white rounded-lg hover:bg-maroon-700 transition text-sm disabled:opacity-50">{savingLimits ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}Тохиргоо хадгалах</button></div>}
      </details>
    </div>
  );
}
