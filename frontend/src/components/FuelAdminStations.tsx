import { useState, useEffect } from "react";
import {
  Plus,
  Edit2,
  Trash2,
  Save,
  X,
  Fuel,
  RefreshCw,
  CheckCircle2,
  XCircle,
  GripVertical,
} from "lucide-react";
import {
  fetchFuelAdminStations,
  createFuelAdminStation,
  updateFuelAdminStation,
  deleteFuelAdminStation,
  FuelStation,
} from "../api";
import { useFuelLang } from "../i18n/useFuelLang";

interface EditingStation extends Partial<FuelStation> {
  isNew?: boolean;
}

export function FuelAdminStations() {
  const { t } = useFuelLang();
  const [stations, setStations] = useState<FuelStation[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editing, setEditing] = useState<EditingStation | null>(null);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const data = await fetchFuelAdminStations();
      setStations(data);
    } catch {
      setError(t("stations.loadError"));
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleAdd = () => {
    setEditingId("new");
    setEditing({
      isNew: true,
      name: "",
      discount_percent: 13,
      is_active: true,
      requires_dispenser: false,
      display_order: stations.length,
    });
  };

  const handleEdit = (station: FuelStation) => {
    setEditingId(station.id);
    setEditing({ ...station });
  };

  const handleSave = async () => {
    if (!editing || !editing.name?.trim()) return;
    setSaving(true);
    setError("");
    try {
      if (editing.isNew) {
        await createFuelAdminStation({
          name: editing.name!.trim(),
          discount_percent: editing.discount_percent ?? 13,
          is_active: editing.is_active ?? true,
          requires_dispenser: editing.requires_dispenser ?? false,
          display_order: editing.display_order ?? 0,
        });
      } else {
        await updateFuelAdminStation(editingId!, {
          name: editing.name?.trim(),
          discount_percent: editing.discount_percent,
          is_active: editing.is_active,
          requires_dispenser: editing.requires_dispenser,
          display_order: editing.display_order,
        });
      }
      setEditingId(null);
      setEditing(null);
      await load();
    } catch {
      setError(t("common.saveError"));
    }
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t("common.confirmDelete"))) return;
    try {
      await deleteFuelAdminStation(id);
      await load();
    } catch {
      setError(t("common.deleteError"));
    }
  };

  const handleCancel = () => {
    setEditingId(null);
    setEditing(null);
  };

  const handleToggleActive = async (station: FuelStation) => {
    try {
      await updateFuelAdminStation(station.id, { is_active: !station.is_active });
      await load();
    } catch {
      setError(t("stations.toggleError"));
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Fuel className="w-4 h-4 text-amber-600" />
          <span className="text-sm font-semibold text-dark-800 dark:text-ivory-200">
            {t("stations.title")} ({stations.length})
          </span>
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
      {editing && (
        <div className="bg-amber-50 dark:bg-amber-900/20 rounded-2xl p-4 border border-amber-200 dark:border-amber-800 space-y-3">
          <div className="text-sm font-semibold text-dark-800 dark:text-ivory-200">
            {editing.isNew ? t("stations.addNew") : t("stations.edit")}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input
              placeholder={t("stations.name")}
              value={editing.name || ""}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              className="col-span-2 px-3 py-2 text-xs border border-silver/60 dark:border-dark-600 rounded-xl bg-white dark:bg-dark-700 text-dark-800 dark:text-ivory-200"
            />
            <div>
              <label className="text-[10px] text-slate-400 mb-1 block">{t("stations.discountPercent")}</label>
              <input
                type="number"
                min={0}
                max={100}
                value={editing.discount_percent ?? 13}
                onChange={(e) => setEditing({ ...editing, discount_percent: parseInt(e.target.value) || 0 })}
                className="w-full px-3 py-2 text-xs border border-silver/60 dark:border-dark-600 rounded-xl bg-white dark:bg-dark-700 text-dark-800 dark:text-ivory-200"
              />
            </div>
            <div>
              <label className="text-[10px] text-slate-400 mb-1 block">{t("stations.order")}</label>
              <input
                type="number"
                min={0}
                value={editing.display_order ?? 0}
                onChange={(e) => setEditing({ ...editing, display_order: parseInt(e.target.value) || 0 })}
                className="w-full px-3 py-2 text-xs border border-silver/60 dark:border-dark-600 rounded-xl bg-white dark:bg-dark-700 text-dark-800 dark:text-ivory-200"
              />
            </div>
          </div>
          <label className="flex items-center gap-2 text-xs text-dark-800 dark:text-ivory-200">
            <input
              type="checkbox"
              checked={editing.is_active !== false}
              onChange={(e) => setEditing({ ...editing, is_active: e.target.checked })}
              className="accent-amber-600"
            />
            {t("common.active")}
          </label>
          <label className="flex items-center gap-2 text-xs text-dark-800 dark:text-ivory-200">
            <input
              type="checkbox"
              checked={editing.requires_dispenser === true}
              onChange={(e) => setEditing({ ...editing, requires_dispenser: e.target.checked })}
              className="accent-blue-600"
            />
            {t("stations.requireDispenser")}
          </label>
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={saving || !editing.name?.trim()}
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

      {/* Station list */}
      {stations.map((station) => (
        <div
          key={station.id}
          className={`bg-white dark:bg-dark-800 rounded-2xl border p-4 ${
            station.is_active
              ? "border-silver/60 dark:border-dark-600"
              : "border-red-200 dark:border-red-800 opacity-60"
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-8 h-8 bg-amber-100 dark:bg-amber-900/30 rounded-lg">
                <Fuel className="w-4 h-4 text-amber-600" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-dark-800 dark:text-ivory-200">{station.name}</span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400">
                    -{station.discount_percent}%
                  </span>
                  {station.is_active ? (
                    <CheckCircle2 className="w-3 h-3 text-green-500" />
                  ) : (
                    <XCircle className="w-3 h-3 text-red-500" />
                  )}
                </div>
                <div className="text-[10px] text-slate-400">
                  {t("stations.orderLabel")} {station.display_order}
                  {station.requires_dispenser && (
                    <span className="ml-2 text-blue-500">{t("stations.dispenserTag")}</span>
                  )}
                  {!station.requires_dispenser && (
                    <span className="ml-2 text-purple-500">{t("stations.qrTag")}</span>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => handleToggleActive(station)}
                className={`p-1.5 rounded-lg transition ${
                  station.is_active
                    ? "hover:bg-red-100 dark:hover:bg-red-900/20"
                    : "hover:bg-green-100 dark:hover:bg-green-900/20"
                }`}
                title={station.is_active ? t("stations.deactivate") : t("stations.activate")}
              >
                {station.is_active ? (
                  <XCircle className="w-3.5 h-3.5 text-red-500" />
                ) : (
                  <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
                )}
              </button>
              <button
                onClick={() => handleEdit(station)}
                className="p-1.5 rounded-lg hover:bg-amber-100 dark:hover:bg-dark-700 transition"
              >
                <Edit2 className="w-3.5 h-3.5 text-amber-600" />
              </button>
              <button
                onClick={() => handleDelete(station.id)}
                className="p-1.5 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/20 transition"
              >
                <Trash2 className="w-3.5 h-3.5 text-red-500" />
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
