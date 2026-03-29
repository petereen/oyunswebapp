import { useState, useEffect } from "react";
import {
  Plus,
  Edit2,
  Trash2,
  Save,
  X,
  CreditCard,
  RefreshCw,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import {
  fetchFuelAdminBankAccounts,
  createFuelAdminBankAccount,
  updateFuelAdminBankAccount,
  deleteFuelAdminBankAccount,
  FuelAdminBankAccount,
} from "../api";

interface EditingAccount extends Partial<FuelAdminBankAccount> {
  isNew?: boolean;
}

export function FuelAdminBankAccounts() {
  const [accounts, setAccounts] = useState<FuelAdminBankAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingAccount, setEditingAccount] = useState<EditingAccount | null>(null);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetchFuelAdminBankAccounts();
      setAccounts(res.accounts || []);
    } catch {
      setError("Дансны мэдээлэл ачаалахад алдаа гарлаа");
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleAdd = () => {
    setEditingId("new");
    setEditingAccount({
      isNew: true,
      bank_name: "",
      account_number: "",
      card_number: "",
      phone: "",
      owner_name: "",
      currency: "RUB",
      is_active: true,
      display_order: accounts.length,
    });
  };

  const handleEdit = (account: FuelAdminBankAccount) => {
    setEditingId(account.id);
    setEditingAccount({ ...account });
  };

  const handleSave = async () => {
    if (!editingAccount) return;
    setSaving(true);
    setError("");
    try {
      const payload = {
        bank_name: editingAccount.bank_name,
        account_number: editingAccount.account_number,
        card_number: editingAccount.card_number,
        phone: editingAccount.phone,
        owner_name: editingAccount.owner_name,
        currency: editingAccount.currency,
        is_active: editingAccount.is_active,
        display_order: editingAccount.display_order,
      };
      if (editingAccount.isNew) {
        await createFuelAdminBankAccount(payload);
      } else {
        await updateFuelAdminBankAccount(editingId!, payload);
      }
      setEditingId(null);
      setEditingAccount(null);
      await load();
    } catch {
      setError("Хадгалахад алдаа гарлаа");
    }
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Устгах уу?")) return;
    try {
      await deleteFuelAdminBankAccount(id);
      await load();
    } catch {
      setError("Устгахад алдаа гарлаа");
    }
  };

  const handleCancel = () => {
    setEditingId(null);
    setEditingAccount(null);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CreditCard className="w-4 h-4 text-amber-600" />
          <span className="text-sm font-semibold text-dark-800 dark:text-ivory-200">Банкны дансууд</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="p-2 rounded-lg hover:bg-amber-100 dark:hover:bg-dark-700 transition">
            <RefreshCw className={`w-4 h-4 text-amber-600 ${loading ? "animate-spin" : ""}`} />
          </button>
          <button
            onClick={handleAdd}
            className="flex items-center gap-1 px-3 py-1.5 bg-amber-600 text-white text-xs font-semibold rounded-xl hover:bg-amber-700 transition"
          >
            <Plus className="w-3 h-3" /> Нэмэх
          </button>
        </div>
      </div>

      {error && <div className="text-red-500 text-sm">{error}</div>}

      {loading && <div className="text-center text-sm text-slate-500 py-8">Ачааллаж байна...</div>}

      {/* Edit form */}
      {editingAccount && (
        <div className="bg-amber-50 dark:bg-amber-900/20 rounded-2xl p-4 border border-amber-200 dark:border-amber-800 space-y-3">
          <div className="text-sm font-semibold text-dark-800 dark:text-ivory-200">
            {editingAccount.isNew ? "Шинэ данс нэмэх" : "Данс засах"}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input
              placeholder="Банкны нэр *"
              value={editingAccount.bank_name || ""}
              onChange={(e) => setEditingAccount({ ...editingAccount, bank_name: e.target.value })}
              className="px-3 py-2 text-xs border border-silver/60 dark:border-dark-600 rounded-xl bg-white dark:bg-dark-700 text-dark-800 dark:text-ivory-200"
            />
            <input
              placeholder="Эзэмшигч *"
              value={editingAccount.owner_name || ""}
              onChange={(e) => setEditingAccount({ ...editingAccount, owner_name: e.target.value })}
              className="px-3 py-2 text-xs border border-silver/60 dark:border-dark-600 rounded-xl bg-white dark:bg-dark-700 text-dark-800 dark:text-ivory-200"
            />
            <input
              placeholder="Дансны дугаар"
              value={editingAccount.account_number || ""}
              onChange={(e) => setEditingAccount({ ...editingAccount, account_number: e.target.value })}
              className="px-3 py-2 text-xs border border-silver/60 dark:border-dark-600 rounded-xl bg-white dark:bg-dark-700 text-dark-800 dark:text-ivory-200"
            />
            <input
              placeholder="Картын дугаар"
              value={editingAccount.card_number || ""}
              onChange={(e) => setEditingAccount({ ...editingAccount, card_number: e.target.value })}
              className="px-3 py-2 text-xs border border-silver/60 dark:border-dark-600 rounded-xl bg-white dark:bg-dark-700 text-dark-800 dark:text-ivory-200"
            />
            <input
              placeholder="Утасны дугаар"
              value={editingAccount.phone || ""}
              onChange={(e) => setEditingAccount({ ...editingAccount, phone: e.target.value })}
              className="px-3 py-2 text-xs border border-silver/60 dark:border-dark-600 rounded-xl bg-white dark:bg-dark-700 text-dark-800 dark:text-ivory-200"
            />
            <select
              value={editingAccount.currency || "RUB"}
              onChange={(e) => setEditingAccount({ ...editingAccount, currency: e.target.value as "RUB" | "MNT" })}
              className="px-3 py-2 text-xs border border-silver/60 dark:border-dark-600 rounded-xl bg-white dark:bg-dark-700 text-dark-800 dark:text-ivory-200"
            >
              <option value="RUB">RUB ₽</option>
              <option value="MNT">MNT ₮</option>
            </select>
          </div>
          <label className="flex items-center gap-2 text-xs text-dark-800 dark:text-ivory-200">
            <input
              type="checkbox"
              checked={editingAccount.is_active !== false}
              onChange={(e) => setEditingAccount({ ...editingAccount, is_active: e.target.checked })}
              className="accent-amber-600"
            />
            Идэвхтэй
          </label>
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={saving || !editingAccount.bank_name || !editingAccount.owner_name}
              className="flex items-center gap-1 px-4 py-2 bg-amber-600 text-white text-xs font-semibold rounded-xl hover:bg-amber-700 transition disabled:opacity-50"
            >
              <Save className="w-3 h-3" /> {saving ? "Хадгалж байна..." : "Хадгалах"}
            </button>
            <button
              onClick={handleCancel}
              className="flex items-center gap-1 px-4 py-2 bg-slate-200 dark:bg-dark-600 text-dark-800 dark:text-ivory-200 text-xs font-semibold rounded-xl hover:bg-slate-300 dark:hover:bg-dark-500 transition"
            >
              <X className="w-3 h-3" /> Болих
            </button>
          </div>
        </div>
      )}

      {/* Account list */}
      {accounts.map((account) => (
        <div
          key={account.id}
          className={`bg-white dark:bg-dark-800 rounded-2xl border p-4 ${
            account.is_active
              ? "border-silver/60 dark:border-dark-600"
              : "border-red-200 dark:border-red-800 opacity-60"
          }`}
        >
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-dark-800 dark:text-ivory-200">{account.bank_name}</span>
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${account.currency === "RUB" ? "bg-blue-100 text-blue-700" : "bg-green-100 text-green-700"}`}>
                {account.currency}
              </span>
              {account.is_active ? (
                <CheckCircle2 className="w-3 h-3 text-green-500" />
              ) : (
                <XCircle className="w-3 h-3 text-red-500" />
              )}
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => handleEdit(account)}
                className="p-1.5 rounded-lg hover:bg-amber-100 dark:hover:bg-dark-700 transition"
              >
                <Edit2 className="w-3.5 h-3.5 text-amber-600" />
              </button>
              <button
                onClick={() => handleDelete(account.id)}
                className="p-1.5 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/20 transition"
              >
                <Trash2 className="w-3.5 h-3.5 text-red-500" />
              </button>
            </div>
          </div>
          <div className="text-xs text-slate-500 dark:text-ivory-400 space-y-0.5">
            <div>Эзэмшигч: {account.owner_name}</div>
            {account.card_number && <div>Карт: {account.card_number}</div>}
            {account.account_number && <div>Данс: {account.account_number}</div>}
            {account.phone && <div>Утас: {account.phone}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}
