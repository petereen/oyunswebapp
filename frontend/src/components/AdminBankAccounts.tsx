import { useState, useEffect } from "react";
import {
  Plus,
  Edit2,
  Trash2,
  Save,
  X,
  CreditCard,
  Building,
  Phone,
  User,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Upload,
  Image,
  Settings,
} from "lucide-react";
import {
  DEFAULT_APP_SETTINGS,
  fetchAllAdminBankAccounts,
  createAdminBankAccount,
  updateAdminBankAccount,
  deleteAdminBankAccount,
  AdminBankAccountFull,
  fetchAdminUsers,
  AdminUser,
  requestPresignAdmin,
  requestPresign,
  fetchAppSettings,
  updateAppSettings,
  AppSettings,
} from "../api";

type NumericAppSettingsField =
  | "min_rub_amount"
  | "min_rub_buy"
  | "oyuns_plus_enabled"
  | "oyuns_plus_threshold_rub"
  | "oyuns_plus_points_per_threshold"
  | "oyuns_plus_referral_reward_points"
  | "oyuns_plus_referral_max_uses";

const HOME_BANNER_TARGET_RATIO = 3;

interface EditingAccount extends Partial<AdminBankAccountFull> {
  isNew?: boolean;
}

export function AdminBankAccounts() {
  const [accounts, setAccounts] = useState<AdminBankAccountFull[]>([]);
  const [admins, setAdmins] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingAccount, setEditingAccount] = useState<EditingAccount | null>(null);
  const [error, setError] = useState("");

  // Exchange limits state
  const [exchangeLimits, setExchangeLimits] = useState<AppSettings>(DEFAULT_APP_SETTINGS);
  const [editingLimits, setEditingLimits] = useState<AppSettings>(DEFAULT_APP_SETTINGS);
  const [limitsChanged, setLimitsChanged] = useState(false);
  const [savingLimits, setSavingLimits] = useState(false);
  const [bannerUploading, setBannerUploading] = useState(false);
  const [bannerUploadError, setBannerUploadError] = useState("");

  const loadData = async () => {
    setLoading(true);
    try {
      const [accountsRes, adminsRes, settingsRes] = await Promise.all([
        fetchAllAdminBankAccounts(),
        fetchAdminUsers(),
        fetchAppSettings(),
      ]);
      setAccounts(accountsRes.accounts);
      setAdmins(adminsRes.admins);
      setExchangeLimits(settingsRes);
      setEditingLimits(settingsRes);
      setLimitsChanged(false);
    } catch (err) {
      console.error("Failed to load bank accounts:", err);
      setError("Дансны мэдээлэл ачаалахад алдаа гарлаа");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleAdd = () => {
    setEditingAccount({
      isNew: true,
      bank_name: "",
      owner_name: "",
      currency: "RUB",
      is_active: true,
      display_order: 0,
    });
    setEditingId("new");
  };

  const handleEdit = (account: AdminBankAccountFull) => {
    setEditingAccount({ ...account });
    setEditingId(account.id);
  };

  const handleCancel = () => {
    setEditingAccount(null);
    setEditingId(null);
  };

  const handleSave = async () => {
    if (!editingAccount) return;

    if (!editingAccount.bank_name || !editingAccount.owner_name || !editingAccount.currency) {
      setError("Банкны нэр, эзэмшигчийн нэр, валют заавал бөглөнө");
      return;
    }

    setSaving(true);
    setError("");

    try {
      if (editingAccount.isNew) {
        await createAdminBankAccount(editingAccount);
      } else if (editingId) {
        await updateAdminBankAccount(editingId, editingAccount);
      }
      await loadData();
      handleCancel();
    } catch (err) {
      console.error("Failed to save bank account:", err);
      setError("Хадгалахад алдаа гарлаа");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Энэ дансыг устгахдаа итгэлтэй байна уу?")) return;

    try {
      await deleteAdminBankAccount(id);
      await loadData();
    } catch (err) {
      console.error("Failed to delete bank account:", err);
      setError("Устгахад алдаа гарлаа");
    }
  };

  const getAdminName = (adminId?: number) => {
    if (!adminId) return "Тодорхойгүй";
    const admin = admins.find((a) => a.id === adminId);
    return admin?.name || `ID: ${adminId}`;
  };

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
    next.home_banner_link_url.trim() !== exchangeLimits.home_banner_link_url.trim();

  const handleLimitsChange = (field: NumericAppSettingsField, value: string) => {
    const num = parseInt(value, 10);
    if (value !== "" && isNaN(num)) return;
    const updated = { ...editingLimits, [field]: value === "" ? 0 : num };
    setEditingLimits(updated);
    setLimitsChanged(hasSettingsChanges(updated));
  };

  const handleOyunsEnabledToggle = (enabled: boolean) => {
    const updated = {
      ...editingLimits,
      oyuns_plus_enabled: enabled ? 1 : 0,
    };
    setEditingLimits(updated);
    setLimitsChanged(hasSettingsChanges(updated));
  };

  const handleHomeBannerToggle = (enabled: boolean) => {
    const updated = {
      ...editingLimits,
      home_banner_enabled: enabled ? 1 : 0,
    };
    setEditingLimits(updated);
    setLimitsChanged(hasSettingsChanges(updated));
  };

  const handleBannerTextChange = (field: "home_banner_image_url" | "home_banner_link_url", value: string) => {
    const updated = { ...editingLimits, [field]: value };
    setEditingLimits(updated);
    setLimitsChanged(hasSettingsChanges(updated));
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
        await fetch(presigned.upload_url, {
          method: "PUT",
          body: file,
          headers: { "Content-Type": file.type },
        });

        const updated = { ...editingLimits, home_banner_image_url: presigned.public_url };
        setEditingLimits(updated);
        setLimitsChanged(hasSettingsChanges(updated));
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

  const handleSaveLimits = async () => {
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

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="w-8 h-8 text-maroon-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
          <CreditCard className="w-5 h-5 text-maroon-600" />
          Банкны дансны удирдлага
        </h3>
        <div className="flex gap-2">
          <button
            onClick={loadData}
            className="p-2 text-slate-600 hover:bg-slate-100 rounded-lg transition"
          >
            <RefreshCw className="w-5 h-5" />
          </button>
          <button
            onClick={handleAdd}
            className="flex items-center gap-2 px-4 py-2 bg-maroon-600 text-white rounded-lg hover:bg-maroon-700 transition"
          >
            <Plus className="w-4 h-4" />
            Данс нэмэх
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3 bg-red-50 text-red-600 rounded-lg text-sm">{error}</div>
      )}

      {/* Exchange Limits Section */}
      <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl space-y-3">
        <h4 className="font-semibold text-amber-800 flex items-center gap-2">
          <Settings className="w-4 h-4" />
          Гүйлгээ ба Oyuns Plus тохиргоо
        </h4>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-slate-600 font-medium">
              🇷🇺→🇲🇳 RUB→MNT (доод ₽)
            </label>
            <input
              type="number"
              min={0}
              value={editingLimits.min_rub_buy}
              onChange={(e) => handleLimitsChange("min_rub_buy", e.target.value)}
              className="w-full mt-1 p-2 border border-amber-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-400 focus:border-amber-400"
            />
          </div>
          <div>
            <label className="text-xs text-slate-600 font-medium">
              🇲🇳→🇷🇺 MNT→RUB (доод ₽)
            </label>
            <input
              type="number"
              min={0}
              value={editingLimits.min_rub_amount}
              onChange={(e) => handleLimitsChange("min_rub_amount", e.target.value)}
              className="w-full mt-1 p-2 border border-amber-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-400 focus:border-amber-400"
            />
          </div>
        </div>

        <div className="pt-3 mt-1 border-t border-amber-200 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-slate-700">OYUNS Plus</p>
              <p className="text-xs text-slate-500">Оноо тооцох систем</p>
            </div>
            <label className="inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={editingLimits.oyuns_plus_enabled > 0}
                onChange={(e) => handleOyunsEnabledToggle(e.target.checked)}
                className="sr-only"
              />
              <span
                className={`w-11 h-6 rounded-full transition relative ${
                  editingLimits.oyuns_plus_enabled > 0 ? "bg-maroon-600" : "bg-slate-300"
                }`}
              >
                <span
                  className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition ${
                    editingLimits.oyuns_plus_enabled > 0 ? "left-5" : "left-0.5"
                  }`}
                />
              </span>
            </label>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-slate-600 font-medium">Оноо тооцох босго (₽)</label>
              <input
                type="number"
                min={1}
                value={editingLimits.oyuns_plus_threshold_rub}
                onChange={(e) => handleLimitsChange("oyuns_plus_threshold_rub", e.target.value)}
                className="w-full mt-1 p-2 border border-amber-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-400 focus:border-amber-400"
              />
            </div>

            <div>
              <label className="text-xs text-slate-600 font-medium">Босго рублид харгалзах оноо</label>
              <input
                type="number"
                min={1}
                value={editingLimits.oyuns_plus_points_per_threshold}
                onChange={(e) => handleLimitsChange("oyuns_plus_points_per_threshold", e.target.value)}
                className="w-full mt-1 p-2 border border-amber-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-400 focus:border-amber-400"
              />
            </div>

            <div>
              <label className="text-xs text-slate-600 font-medium">Найзаа уриад авах OYUNS+ оноо</label>
              <input
                type="number"
                min={0}
                value={editingLimits.oyuns_plus_referral_reward_points}
                onChange={(e) => handleLimitsChange("oyuns_plus_referral_reward_points", e.target.value)}
                className="w-full mt-1 p-2 border border-amber-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-400 focus:border-amber-400"
              />
            </div>

            <div>
              <label className="text-xs text-slate-600 font-medium">Нэг хэрэглэгчийн урих найзын хязгаар</label>
              <input
                type="number"
                min={1}
                value={editingLimits.oyuns_plus_referral_max_uses}
                onChange={(e) => handleLimitsChange("oyuns_plus_referral_max_uses", e.target.value)}
                className="w-full mt-1 p-2 border border-amber-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-400 focus:border-amber-400"
              />
            </div>
          </div>
        </div>

        <div className="pt-3 mt-1 border-t border-amber-200 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-slate-700">Home дээрх түр banner</p>
              <p className="text-xs text-slate-500">Зарлал эсвэл сурталчилгааны зураг. Home tab-ын дээд хэсэгт харагдана.</p>
            </div>
            <label className="inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={editingLimits.home_banner_enabled > 0}
                onChange={(e) => handleHomeBannerToggle(e.target.checked)}
                className="sr-only"
              />
              <span
                className={`w-11 h-6 rounded-full transition relative ${
                  editingLimits.home_banner_enabled > 0 ? "bg-maroon-600" : "bg-slate-300"
                }`}
              >
                <span
                  className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition ${
                    editingLimits.home_banner_enabled > 0 ? "left-5" : "left-0.5"
                  }`}
                />
              </span>
            </label>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <div className="text-xs text-slate-600 font-medium flex items-center gap-1">
                <Image className="w-3 h-3" /> Banner зураг (3:1, санал болгох хэмжээ 1200x400)
              </div>

              {editingLimits.home_banner_image_url ? (
                <div className="space-y-2">
                  <div className="overflow-hidden rounded-xl border border-amber-200 bg-white aspect-[3/1]">
                    <img
                      src={editingLimits.home_banner_image_url}
                      alt="Home banner preview"
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div className="flex gap-2">
                    <label className="cursor-pointer inline-flex items-center gap-2 px-3 py-2 bg-white border border-amber-300 rounded-lg text-sm text-slate-700 hover:bg-amber-50 transition">
                      {bannerUploading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                      Зураг солих
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) void handleBannerImageUpload(file);
                        }}
                        disabled={bannerUploading}
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => handleBannerTextChange("home_banner_image_url", "")}
                      className="inline-flex items-center gap-2 px-3 py-2 bg-white border border-red-200 rounded-lg text-sm text-red-600 hover:bg-red-50 transition"
                    >
                      <X className="w-4 h-4" /> Зураг устгах
                    </button>
                  </div>
                </div>
              ) : (
                <label className="block cursor-pointer">
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void handleBannerImageUpload(file);
                    }}
                    disabled={bannerUploading}
                  />
                  <div className="border-2 border-dashed border-amber-300 rounded-xl p-4 text-center hover:border-amber-400 transition bg-white">
                    {bannerUploading ? (
                      <RefreshCw className="w-5 h-5 text-amber-500 mx-auto animate-spin" />
                    ) : (
                      <Upload className="w-5 h-5 text-amber-500 mx-auto mb-2" />
                    )}
                    <div className="text-xs text-slate-500">PNG/JPG/WEBP, 3:1 banner</div>
                  </div>
                </label>
              )}

              {bannerUploadError && <div className="text-xs text-red-500">{bannerUploadError}</div>}
            </div>

            <div className="space-y-2">
              <label className="text-xs text-slate-600 font-medium">Banner дарахад нээгдэх холбоос</label>
              <input
                type="text"
                value={editingLimits.home_banner_link_url}
                onChange={(e) => handleBannerTextChange("home_banner_link_url", e.target.value)}
                placeholder="/?tab=oyuns-plus&tournament=basketball&section=stages"
                className="w-full p-2 border border-amber-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-400 focus:border-amber-400"
              />
              <div className="text-xs text-slate-500">App дотор tournament руу оруулах бол `/?tab=oyuns-plus&tournament=basketball` эсвэл stage руу шууд оруулах бол `/?tab=oyuns-plus&tournament=basketball&section=stages` гэж оруулж болно.</div>
            </div>
          </div>
        </div>

        {limitsChanged && (
          <div className="flex justify-end">
            <button
              onClick={handleSaveLimits}
              disabled={savingLimits}
              className="flex items-center gap-2 px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition text-sm disabled:opacity-50"
            >
              {savingLimits ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <Save className="w-4 h-4" />
              )}
              Тохиргоо хадгалах
            </button>
          </div>
        )}
      </div>

      {/* New Account Form */}
      {editingId === "new" && editingAccount && (
        <div className="p-4 bg-green-50 border border-green-200 rounded-xl space-y-3">
          <h4 className="font-semibold text-green-800">Шинэ данс нэмэх</h4>
          <AccountForm
            account={editingAccount}
            admins={admins}
            onChange={setEditingAccount}
            onSave={handleSave}
            onCancel={handleCancel}
            saving={saving}
          />
        </div>
      )}

      {/* Accounts List */}
      <div className="space-y-3">
        {accounts.length === 0 && !editingId && (
          <div className="text-center py-12 bg-white/50 rounded-xl border border-maroon-100">
            <CreditCard className="w-12 h-12 mx-auto text-slate-300 mb-2" />
            <p className="text-slate-500">Данс бүртгэгдээгүй байна</p>
          </div>
        )}

        {accounts.map((account) => (
          <div
            key={account.id}
            className={`p-4 rounded-xl border ${
              account.is_active
                ? "bg-white border-maroon-100"
                : "bg-slate-50 border-slate-200 opacity-75"
            }`}
          >
            {editingId === account.id && editingAccount ? (
              <AccountForm
                account={editingAccount}
                admins={admins}
                onChange={setEditingAccount}
                onSave={handleSave}
                onCancel={handleCancel}
                saving={saving}
              />
            ) : (
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 space-y-2">
                  <div className="flex items-center gap-2">
                    {account.logo_url && (
                      <img src={account.logo_url} alt="" className="w-6 h-6 rounded object-contain" />
                    )}
                    <span
                      className={`px-2 py-0.5 text-xs font-semibold rounded ${
                        account.currency === "RUB"
                          ? "bg-blue-100 text-blue-700"
                          : "bg-green-100 text-green-700"
                      }`}
                    >
                      {account.currency}
                    </span>
                    <span className="font-semibold text-slate-800">
                      {account.bank_name}
                    </span>
                    {account.is_priority && (
                      <span className="px-1.5 py-0.5 text-[10px] font-semibold rounded bg-amber-100 text-amber-700">
                        ⭐ PRIORITY
                      </span>
                    )}
                    {account.is_active ? (
                      <CheckCircle2 className="w-4 h-4 text-green-500" />
                    ) : (
                      <XCircle className="w-4 h-4 text-slate-400" />
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-sm text-slate-600">
                    <div className="flex items-center gap-1">
                      <User className="w-3 h-3" />
                      {account.owner_name}
                    </div>
                    {account.account_number && (
                      <div className="flex items-center gap-1">
                        <Building className="w-3 h-3" />
                        {account.account_number}
                      </div>
                    )}
                    {account.card_number && (
                      <div className="flex items-center gap-1">
                        <CreditCard className="w-3 h-3" />
                        {account.card_number}
                      </div>
                    )}
                    {account.phone && (
                      <div className="flex items-center gap-1">
                        <Phone className="w-3 h-3" />
                        {account.phone}
                      </div>
                    )}
                  </div>

                  <div className="text-xs text-slate-500">
                    Админ: {getAdminName(account.admin_id)}
                  </div>
                </div>

                <div className="flex gap-1">
                  <button
                    onClick={() => handleEdit(account)}
                    className="p-2 text-slate-600 hover:bg-slate-100 rounded-lg transition"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDelete(account.id)}
                    className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// Account Form Component
function AccountForm({
  account,
  admins,
  onChange,
  onSave,
  onCancel,
  saving,
}: {
  account: EditingAccount;
  admins: AdminUser[];
  onChange: (account: EditingAccount) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
}) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-slate-500">Банкны нэр *</label>
          <input
            type="text"
            value={account.bank_name || ""}
            onChange={(e) => onChange({ ...account, bank_name: e.target.value })}
            className="w-full p-2 border border-slate-200 rounded-lg text-sm"
            placeholder="Tinkoff, Sber, Khan Bank..."
          />
        </div>
        <div>
          <label className="text-xs text-slate-500">Эзэмшигчийн нэр *</label>
          <input
            type="text"
            value={account.owner_name || ""}
            onChange={(e) => onChange({ ...account, owner_name: e.target.value })}
            className="w-full p-2 border border-slate-200 rounded-lg text-sm"
            placeholder="ИВАНОВ ИВАН"
          />
        </div>
        <div>
          <label className="text-xs text-slate-500">Валют *</label>
          <select
            value={account.currency || "RUB"}
            onChange={(e) =>
              onChange({ ...account, currency: e.target.value as "RUB" | "MNT" })
            }
            className="w-full p-2 border border-slate-200 rounded-lg text-sm"
          >
            <option value="RUB">RUB (Рубль)</option>
            <option value="MNT">MNT (Төгрөг)</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-slate-500">Админ</label>
          <select
            value={account.admin_id || ""}
            onChange={(e) =>
              onChange({
                ...account,
                admin_id: e.target.value ? Number(e.target.value) : undefined,
              })
            }
            className="w-full p-2 border border-slate-200 rounded-lg text-sm"
          >
            <option value="">-- Сонгоно уу --</option>
            {admins.map((admin) => (
              <option key={admin.id} value={admin.id}>
                {admin.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-slate-500">Дансны дугаар</label>
          <input
            type="text"
            value={account.account_number || ""}
            onChange={(e) => onChange({ ...account, account_number: e.target.value })}
            className="w-full p-2 border border-slate-200 rounded-lg text-sm"
            placeholder="1234567890"
          />
        </div>
        <div>
          <label className="text-xs text-slate-500">Картын дугаар</label>
          <input
            type="text"
            value={account.card_number || ""}
            onChange={(e) => onChange({ ...account, card_number: e.target.value })}
            className="w-full p-2 border border-slate-200 rounded-lg text-sm"
            placeholder="2200 1234 5678 9012"
          />
        </div>
        <div>
          <label className="text-xs text-slate-500">Утас (СБП)</label>
          <input
            type="text"
            value={account.phone || ""}
            onChange={(e) => onChange({ ...account, phone: e.target.value })}
            className="w-full p-2 border border-slate-200 rounded-lg text-sm"
            placeholder="+7 900 123 4567"
          />
        </div>
        <div>
          <label className="text-xs text-slate-500">Дараалал</label>
          <input
            type="number"
            value={account.display_order || 0}
            onChange={(e) =>
              onChange({ ...account, display_order: Number(e.target.value) })
            }
            className="w-full p-2 border border-slate-200 rounded-lg text-sm"
            min={0}
          />
        </div>
      </div>

      {/* Bank Logo Upload */}
      <div className="space-y-2">
        <div className="text-xs text-slate-500 flex items-center gap-1">
          <Image className="w-3 h-3" /> Банкны лого (1:1, макс 256×256)
        </div>
        {account.logo_url ? (
          <div className="flex items-center gap-3">
            <img src={account.logo_url} alt="logo" className="w-12 h-12 rounded-lg object-contain border border-slate-200" />
            <button
              type="button"
              onClick={() => onChange({ ...account, logo_url: undefined })}
              className="text-xs text-red-500 hover:text-red-700 flex items-center gap-1"
            >
              <X className="w-3 h-3" /> Устгах
            </button>
          </div>
        ) : (
          <BankLogoUpload onChange={onChange} account={account} />
        )}
      </div>

      <div className="flex items-center gap-4">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={account.is_active ?? true}
            onChange={(e) => onChange({ ...account, is_active: e.target.checked })}
            className="w-4 h-4 text-maroon-600 border-slate-300 rounded"
          />
          Идэвхтэй
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={account.is_priority ?? false}
            onChange={(e) => onChange({ ...account, is_priority: e.target.checked })}
            className="w-4 h-4 text-amber-600 border-slate-300 rounded"
          />
          ⭐ Priority карта
        </label>
      </div>

      <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
        <button
          onClick={onCancel}
          className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg transition flex items-center gap-2"
        >
          <X className="w-4 h-4" />
          Болих
        </button>
        <button
          onClick={onSave}
          disabled={saving}
          className="px-4 py-2 bg-maroon-600 text-white rounded-lg hover:bg-maroon-700 transition flex items-center gap-2 disabled:opacity-50"
        >
          {saving ? (
            <RefreshCw className="w-4 h-4 animate-spin" />
          ) : (
            <Save className="w-4 h-4" />
          )}
          Хадгалах
        </button>
      </div>
    </div>
  );
}

// Bank Logo Upload Component
function BankLogoUpload({
  onChange,
  account,
}: {
  onChange: (account: EditingAccount) => void;
  account: EditingAccount;
}) {
  const [uploadError, setUploadError] = useState("");
  const [uploading, setUploading] = useState(false);

  return (
    <label className="block cursor-pointer">
      <input
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          setUploadError("");
          const img = new window.Image();
          img.onload = async () => {
            URL.revokeObjectURL(img.src);
            if (Math.abs(img.width / img.height - 1) > 0.1) {
              setUploadError("Лого нь 1:1 харьцаатай байх ёстой (жишээ: 128×128)");
              return;
            }
            if (img.width > 256 || img.height > 256) {
              setUploadError("Лого нь 256×256 хэмжээнээс хэтрэхгүй байх ёстой");
              return;
            }
            setUploading(true);
            try {
              const ext = file.name.split(".").pop() || "png";
              const path = `bank-logos/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
              const presigned = await requestPresignAdmin({ bucket: "bills", path });
              await fetch(presigned.upload_url, {
                method: "PUT",
                body: file,
                headers: { "Content-Type": file.type },
              });
              onChange({ ...account, logo_url: presigned.public_url });
            } catch {
              setUploadError("Лого оруулахад алдаа гарлаа");
            }
            setUploading(false);
          };
          img.src = URL.createObjectURL(file);
        }}
      />
      <div className="border-2 border-dashed border-slate-300 rounded-lg p-3 text-center hover:border-maroon-400 transition">
        {uploading ? (
          <RefreshCw className="w-4 h-4 text-slate-400 mx-auto animate-spin" />
        ) : (
          <Upload className="w-4 h-4 text-slate-400 mx-auto mb-1" />
        )}
        <div className="text-xs text-slate-500">PNG/JPG/WEBP, 1:1, макс 256×256</div>
      </div>
      {uploadError && <div className="text-xs text-red-500 mt-1">{uploadError}</div>}
    </label>
  );
}
