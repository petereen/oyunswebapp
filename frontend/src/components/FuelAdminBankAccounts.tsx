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
import { useFuelLang } from "../i18n/useFuelLang";

interface EditingAccount extends Partial<FuelAdminBankAccount> {
  isNew?: boolean;
}

export function FuelAdminBankAccounts() {
  const { t } = useFuelLang();
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
      setError(t("banks.loadError"));
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
      admin_id: undefined,
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
        admin_id: editingAccount.admin_id || undefined,
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
      setError(t("common.saveError"));
    }
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t("common.confirmDelete"))) return;
    try {
      await deleteFuelAdminBankAccount(id);
      await load();
    } catch {
      setError(t("common.deleteError"));
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
          <span className="text-sm font-semibold text-dark-800 dark:text-ivory-200">{t("banks.title")}</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="p-2 rounded-lg hover:bg-amber-100 dark:hover:bg-dark-700 transition">
            <RefreshCw className={`w-4 h-4 text-amber-600 ${loading ? "animate-spin" : ""}`} />
          </button>
          <button
            onClick={handleAdd}
            className="flex items-center gap-1 px-3 py-1.5 bg-amber-600 text-white text-xs font-semibold rounded-xl hover:bg-amber-700 transition"
          >
            <Plus className="w-3 h-3" /> {t("common.add")}
          </button>
        </div>
      </div>

      {error && <div className="text-red-500 text-sm">{error}</div>}

      {loading && <div className="text-center text-sm text-slate-500 py-8">{t("common.loading")}</div>}

      {/* Edit form */}
      {editingAccount && (
        <div className="bg-amber-50 dark:bg-amber-900/20 rounded-2xl p-4 border border-amber-200 dark:border-amber-800 space-y-3">
          <div className="text-sm font-semibold text-dark-800 dark:text-ivory-200">
            {editingAccount.isNew ? t("banks.addNew") : t("banks.edit")}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input
              placeholder={t("banks.bankName")}
              value={editingAccount.bank_name || ""}
              onChange={(e) => setEditingAccount({ ...editingAccount, bank_name: e.target.value })}
              className="px-3 py-2 text-xs border border-silver/60 dark:border-dark-600 rounded-xl bg-white dark:bg-dark-700 text-dark-800 dark:text-ivory-200"
            />
            <input
              placeholder={t("banks.owner")}
              value={editingAccount.owner_name || ""}
              onChange={(e) => setEditingAccount({ ...editingAccount, owner_name: e.target.value })}
              className="px-3 py-2 text-xs border border-silver/60 dark:border-dark-600 rounded-xl bg-white dark:bg-dark-700 text-dark-800 dark:text-ivory-200"
            />
            <input
              placeholder={t("banks.accountNumber")}
              value={editingAccount.account_number || ""}
              onChange={(e) => setEditingAccount({ ...editingAccount, account_number: e.target.value })}
              className="px-3 py-2 text-xs border border-silver/60 dark:border-dark-600 rounded-xl bg-white dark:bg-dark-700 text-dark-800 dark:text-ivory-200"
            />
            <input
              placeholder={t("banks.cardNumber")}
              value={editingAccount.card_number || ""}
              onChange={(e) => setEditingAccount({ ...editingAccount, card_number: e.target.value })}
              className="px-3 py-2 text-xs border border-silver/60 dark:border-dark-600 rounded-xl bg-white dark:bg-dark-700 text-dark-800 dark:text-ivory-200"
            />
            <input
              placeholder={t("banks.phone")}
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
            <input
              type="number"
              placeholder={t("banks.adminId")}
              value={editingAccount.admin_id ?? ""}
              onChange={(e) => setEditingAccount({ ...editingAccount, admin_id: e.target.value ? parseInt(e.target.value) : undefined })}
              className="px-3 py-2 text-xs border border-silver/60 dark:border-dark-600 rounded-xl bg-white dark:bg-dark-700 text-dark-800 dark:text-ivory-200"
            />
          </div>
          <label className="flex items-center gap-2 text-xs text-dark-800 dark:text-ivory-200">
            <input
              type="checkbox"
              checked={editingAccount.is_active !== false}
              onChange={(e) => setEditingAccount({ ...editingAccount, is_active: e.target.checked })}
              className="accent-amber-600"
            />
            {t("common.active")}
          </label>
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={saving || !editingAccount.bank_name || !editingAccount.owner_name}
              className="flex items-center gap-1 px-4 py-2 bg-amber-600 text-white text-xs font-semibold rounded-xl hover:bg-amber-700 transition disabled:opacity-50"
            >
              <Save className="w-3 h-3" /> {saving ? t("common.saving") : t("common.save")}
            </button>
            <button
              onClick={handleCancel}
              className="flex items-center gap-1 px-4 py-2 bg-slate-200 dark:bg-dark-600 text-dark-800 dark:text-ivory-200 text-xs font-semibold rounded-xl hover:bg-slate-300 dark:hover:bg-dark-500 transition"
            >
              <X className="w-3 h-3" /> {t("common.cancel")}
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
            <div>{t("banks.ownerLabel")} {account.owner_name}</div>
            {account.card_number && <div>{t("banks.cardLabel")} {account.card_number}</div>}
            {account.account_number && <div>{t("banks.accountLabel")} {account.account_number}</div>}
            {account.phone && <div>{t("banks.phoneLabel")} {account.phone}</div>}
            {account.admin_id && <div>{t("banks.adminIdLabel")} {account.admin_id}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}
