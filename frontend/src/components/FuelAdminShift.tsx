import { useState, useEffect } from "react";
import { Power, User, RefreshCw, AlertTriangle, Bell } from "lucide-react";
import { fetchFuelAdminShift, updateFuelAdminShift, FuelShiftStatus } from "../api";
import { useFuelLang } from "../i18n/useFuelLang";

export function FuelAdminShift() {
  const { t } = useFuelLang();
  const [shift, setShift] = useState<FuelShiftStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const data = await fetchFuelAdminShift();
      setShift(data);
    } catch {
      setError(t("shift.loadError"));
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const toggleShift = async () => {
    if (!shift) return;
    setSaving(true);
    setError("");
    try {
      const newActive = !shift.is_active;
      await updateFuelAdminShift({
        is_active: newActive,
        admin_id: newActive ? shift.current_admin?.admin_id ?? shift.admins[0]?.admin_id : shift.current_admin?.admin_id,
        always_notify_admin_id: shift.always_notify_admin_id,
      });
      await load();
    } catch {
      setError(t("shift.updateError"));
    }
    setSaving(false);
  };

  const changeAdmin = async (adminId: number) => {
    if (!shift) return;
    setSaving(true);
    setError("");
    try {
      await updateFuelAdminShift({ is_active: shift.is_active, admin_id: adminId, always_notify_admin_id: shift.always_notify_admin_id });
      await load();
    } catch {
      setError(t("shift.changeAdminError"));
    }
    setSaving(false);
  };

  const changeAlwaysNotify = async (adminId: number | null) => {
    if (!shift) return;
    setSaving(true);
    setError("");
    try {
      await updateFuelAdminShift({
        is_active: shift.is_active,
        admin_id: shift.current_admin?.admin_id,
        always_notify_admin_id: adminId ?? undefined,
      });
      await load();
    } catch {
      setError(t("shift.changeAdminError"));
    }
    setSaving(false);
  };

  if (loading) {
    return <div className="text-center text-sm text-slate-500 py-8">{t("common.loading")}</div>;
  }

  if (!shift) {
    return <div className="text-red-500 text-sm text-center py-4">{error || t("shift.notFound")}</div>;
  }

  return (
    <div className="space-y-4">
      {/* Shift status card */}
      <div className={`p-5 rounded-2xl border-2 ${
        shift.is_active
          ? "border-green-400 bg-green-50 dark:bg-green-900/20 dark:border-green-700"
          : "border-red-300 bg-red-50 dark:bg-red-900/20 dark:border-red-800"
      }`}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Power className={`w-5 h-5 ${shift.is_active ? "text-green-600" : "text-red-500"}`} />
            <span className="font-bold text-dark-800 dark:text-ivory-200">
              {shift.is_active ? t("shift.active") : t("shift.inactive")}
            </span>
          </div>
          <button onClick={load} className="p-2 rounded-lg hover:bg-white/50 dark:hover:bg-dark-700 transition">
            <RefreshCw className={`w-4 h-4 text-slate-500 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>

        {shift.is_active && shift.current_admin && (
          <div className="flex items-center gap-2 p-3 bg-white/70 dark:bg-dark-800/70 rounded-xl">
            <User className="w-4 h-4 text-green-600" />
            <span className="text-sm text-dark-800 dark:text-ivory-200">
              {t("shift.onDuty")} <b>{shift.current_admin.admin_name}</b> (ID: {shift.current_admin.admin_id})
            </span>
          </div>
        )}

        {!shift.is_active && (
          <div className="flex items-center gap-2 p-3 bg-white/70 dark:bg-dark-800/70 rounded-xl">
            <AlertTriangle className="w-4 h-4 text-red-500" />
            <span className="text-xs text-red-600 dark:text-red-400">
              {t("shift.offWarning")}
            </span>
          </div>
        )}

        <button
          onClick={toggleShift}
          disabled={saving}
          className={`mt-3 w-full py-3 rounded-xl font-semibold transition disabled:opacity-50 ${
            shift.is_active
              ? "bg-red-500 hover:bg-red-600 text-white"
              : "bg-green-500 hover:bg-green-600 text-white"
          }`}
        >
          {saving ? t("common.saving") : shift.is_active ? t("shift.turnOff") : t("shift.turnOn")}
        </button>
      </div>

      {/* Admin selection */}
      {shift.admins.length > 0 && (
        <div className="bg-white dark:bg-dark-800 p-4 rounded-2xl border border-silver/60 dark:border-dark-600 space-y-3">
          <div className="text-sm font-semibold text-dark-800 dark:text-ivory-200">
            {t("shift.changeAdmin")}
          </div>
          <div className="space-y-2">
            {shift.admins.map((admin) => {
              const isCurrent = shift.current_admin?.admin_id === admin.admin_id;
              return (
                <button
                  key={admin.admin_id}
                  onClick={() => changeAdmin(admin.admin_id)}
                  disabled={saving || isCurrent}
                  className={`w-full flex items-center justify-between p-3 rounded-xl border-2 text-left transition ${
                    isCurrent
                      ? "border-green-400 bg-green-50 dark:bg-green-900/20"
                      : "border-silver/40 dark:border-dark-600 hover:border-amber-400"
                  } disabled:opacity-60`}
                >
                  <div className="flex items-center gap-2">
                    <User className={`w-4 h-4 ${isCurrent ? "text-green-600" : "text-slate-400"}`} />
                    <div>
                      <div className="text-sm font-medium text-dark-800 dark:text-ivory-200">
                        {admin.admin_name}
                      </div>
                      <div className="text-[10px] text-slate-500 dark:text-ivory-400">
                        ID: {admin.admin_id} {admin.chat_id ? `• Chat: ${admin.chat_id}` : ""}
                      </div>
                    </div>
                  </div>
                  {isCurrent && (
                    <span className="text-[10px] px-2 py-0.5 bg-green-100 text-green-700 rounded-full font-medium">
                      {t("shift.current")}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Always Notify Admin */}
      {shift.admins.length > 0 && (
        <div className="bg-white dark:bg-dark-800 p-4 rounded-2xl border border-silver/60 dark:border-dark-600 space-y-3">
          <div className="flex items-center gap-2">
            <Bell className="w-4 h-4 text-amber-500" />
            <div className="text-sm font-semibold text-dark-800 dark:text-ivory-200">
              Байнга мэдэгдэл авах админ
            </div>
          </div>
          <p className="text-[10px] text-slate-500 dark:text-ivory-400">
            Ээлж солигдсон ч энэ админ бүх мэдэгдлийг авна
          </p>
          <div className="space-y-2">
            <button
              onClick={() => changeAlwaysNotify(null)}
              disabled={saving || !shift.always_notify_admin_id}
              className={`w-full flex items-center justify-between p-3 rounded-xl border-2 text-left transition ${
                !shift.always_notify_admin_id
                  ? "border-amber-400 bg-amber-50 dark:bg-amber-900/20"
                  : "border-silver/40 dark:border-dark-600 hover:border-amber-400"
              } disabled:opacity-60`}
            >
              <span className="text-sm text-dark-800 dark:text-ivory-200">Идэвхгүй</span>
              {!shift.always_notify_admin_id && (
                <span className="text-[10px] px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full font-medium">Сонгосон</span>
              )}
            </button>
            {shift.admins.map((admin) => {
              const isAlways = shift.always_notify_admin_id === admin.admin_id;
              return (
                <button
                  key={`always-${admin.admin_id}`}
                  onClick={() => changeAlwaysNotify(admin.admin_id)}
                  disabled={saving || isAlways}
                  className={`w-full flex items-center justify-between p-3 rounded-xl border-2 text-left transition ${
                    isAlways
                      ? "border-amber-400 bg-amber-50 dark:bg-amber-900/20"
                      : "border-silver/40 dark:border-dark-600 hover:border-amber-400"
                  } disabled:opacity-60`}
                >
                  <div className="flex items-center gap-2">
                    <Bell className={`w-4 h-4 ${isAlways ? "text-amber-500" : "text-slate-400"}`} />
                    <div>
                      <div className="text-sm font-medium text-dark-800 dark:text-ivory-200">
                        {admin.admin_name}
                      </div>
                      <div className="text-[10px] text-slate-500 dark:text-ivory-400">
                        ID: {admin.admin_id}
                      </div>
                    </div>
                  </div>
                  {isAlways && (
                    <span className="text-[10px] px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full font-medium">🔔 Байнга</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {error && <div className="text-red-500 text-sm text-center">{error}</div>}
    </div>
  );
}
