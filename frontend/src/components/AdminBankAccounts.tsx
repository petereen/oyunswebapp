import { useState, useEffect, useMemo } from "react";
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
} from "lucide-react";
import {
  fetchAllAdminBankAccounts,
  createAdminBankAccount,
  updateAdminBankAccount,
  deleteAdminBankAccount,
  AdminBankAccountFull,
  fetchAdminUsers,
  AdminUser,
  requestPresignAdmin,
} from "../api";
import { AdminEmptyState, AdminRefreshButton, AdminSectionHeader } from "./admin/AdminPanelPrimitives";

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

  const adminNames = useMemo(
    () => new Map(admins.map((admin) => [admin.id, admin.name])),
    [admins],
  );

  const groupedAccounts = useMemo(() => {
    const groups = new Map<string, { adminId?: number; adminName: string; accounts: AdminBankAccountFull[] }>();

    accounts.forEach((account) => {
      const key = account.admin_id == null ? "unassigned" : String(account.admin_id);
      const group = groups.get(key);
      if (group) {
        group.accounts.push(account);
        return;
      }

      groups.set(key, {
        adminId: account.admin_id,
        adminName: account.admin_id == null
          ? "Админ оноогоогүй"
          : adminNames.get(account.admin_id) || `ID: ${account.admin_id}`,
        accounts: [account],
      });
    });

    return Array.from(groups.values()).sort((left, right) => {
      if (left.adminId == null) return 1;
      if (right.adminId == null) return -1;
      return left.adminName.localeCompare(right.adminName, "mn");
    });
  }, [accounts, adminNames]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [accountsRes, adminsRes] = await Promise.all([
        fetchAllAdminBankAccounts(),
        fetchAdminUsers(),
      ]);
      setAccounts(accountsRes.accounts);
      setAdmins(adminsRes.admins);
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

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="w-8 h-8 text-maroon-500 animate-spin" />
      </div>
    );
  }

  return (
    <div data-slot="admin-bank-accounts" className="space-y-4">
      {/* Header */}
      <AdminSectionHeader icon={CreditCard} title="Банкны дансны удирдлага" count={accounts.length} action={
        <div className="flex items-center gap-2">
          <AdminRefreshButton onClick={loadData} loading={loading} label="Данс шинэчлэх" />
          <button
            type="button"
            onClick={handleAdd}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-maroon-600 px-3 text-xs font-semibold text-white transition hover:bg-maroon-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-maroon-400"
          >
            <Plus className="size-3.5" />
            Данс нэмэх
          </button>
        </div>
      } />

      {error && (
        <div className="p-3 bg-red-50 text-red-600 rounded-lg text-sm">{error}</div>
      )}

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
      <div className="flex flex-col gap-4">
        {accounts.length === 0 && !editingId && (
          <div className="rounded-xl border border-maroon-100 bg-white/50"><AdminEmptyState icon={CreditCard}>Данс бүртгэгдээгүй байна</AdminEmptyState></div>
        )}

        {groupedAccounts.map((group) => {
          const activeCount = group.accounts.filter((account) => account.is_active).length;

          return (
            <section key={group.adminId ?? "unassigned"} data-slot="admin-bank-account-group" className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-3 border-b border-slate-200/80 px-1 pb-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-maroon-50 text-maroon-700">
                    <User className="size-4" />
                  </span>
                  <h4 className="truncate font-semibold text-slate-800">{group.adminName}</h4>
                </div>
                <span className="shrink-0 text-xs font-medium text-slate-500">
                  {activeCount}/{group.accounts.length} идэвхтэй
                </span>
              </div>

              <div className="flex flex-col gap-3">
                {group.accounts.map((account) => (
                  <div
                    key={account.id}
                    data-slot="admin-bank-account-card"
                    className={`rounded-xl border p-4 transition-colors ${
                      account.is_active
                        ? "border-maroon-200 bg-white shadow-card-xs ring-1 ring-maroon-100"
                        : "border-slate-200 bg-slate-50/70 text-slate-500 opacity-70 hover:opacity-100"
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
                        <div className="min-w-0 flex-1 space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            {account.logo_url && (
                              <img src={account.logo_url} alt="" className="size-6 rounded object-contain" />
                            )}
                            <span
                              className={`rounded px-2 py-0.5 text-xs font-semibold ${
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
                              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                                ⭐ PRIORITY
                              </span>
                            )}
                            {account.is_active ? (
                              <span className="inline-flex items-center gap-1 text-xs font-semibold text-green-600">
                                <CheckCircle2 className="size-4" /> Идэвхтэй
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-xs text-slate-400">
                                <XCircle className="size-4" /> Идэвхгүй
                              </span>
                            )}
                          </div>

                          <div className="grid grid-cols-1 gap-2 text-sm text-slate-600 sm:grid-cols-2">
                            <div className="flex min-w-0 items-center gap-1">
                              <User className="size-3 shrink-0" />
                              <span className="truncate">{account.owner_name}</span>
                            </div>
                            {account.account_number && (
                              <div className="flex min-w-0 items-center gap-1">
                                <Building className="size-3 shrink-0" />
                                <span className="truncate">{account.account_number}</span>
                              </div>
                            )}
                            {account.card_number && (
                              <div className="flex min-w-0 items-center gap-1">
                                <CreditCard className="size-3 shrink-0" />
                                <span className="truncate">{account.card_number}</span>
                              </div>
                            )}
                            {account.phone && (
                              <div className="flex min-w-0 items-center gap-1">
                                <Phone className="size-3 shrink-0" />
                                <span className="truncate">{account.phone}</span>
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="flex shrink-0 gap-1">
                          <button
                            type="button"
                            onClick={() => handleEdit(account)}
                            aria-label={`${account.bank_name} данс засах`}
                            className="flex size-10 items-center justify-center rounded-lg text-slate-600 transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-maroon-400"
                          >
                            <Edit2 className="size-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDelete(account.id)}
                            aria-label={`${account.bank_name} данс устгах`}
                            className="flex size-10 items-center justify-center rounded-lg text-red-600 transition hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
                          >
                            <Trash2 className="size-4" />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          );
        })}
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
