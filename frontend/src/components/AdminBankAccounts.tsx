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
} from "lucide-react";
import {
  fetchAllAdminBankAccounts,
  createAdminBankAccount,
  updateAdminBankAccount,
  deleteAdminBankAccount,
  AdminBankAccountFull,
  fetchAdminUsers,
  AdminUser,
} from "../api";

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

  const getAdminName = (adminId?: number) => {
    if (!adminId) return "Тодорхойгүй";
    const admin = admins.find((a) => a.id === adminId);
    return admin?.name || `ID: ${adminId}`;
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
