import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Clock,
  Pause,
  Play,
  Power,
  RefreshCw,
  Settings,
  UserCheck,
  X,
} from "lucide-react";
import {
  closeShift,
  fetchWorkingHours,
  openShift,
  transferShift,
  updateWorkingHours,
  WorkingHoursConfig,
} from "../../api";
import { queryKeys } from "../../queryKeys";
import { useAdminShiftContext } from "../../hooks/useAdminShift";

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

export function AdminShiftBar() {
  const queryClient = useQueryClient();
  const { data: shiftContext, isLoading: shiftLoading } = useAdminShiftContext();
  const { data: workingHours, isLoading: workingHoursLoading } = useQuery<WorkingHoursConfig>({
    queryKey: queryKeys.admin.workingHours,
    queryFn: fetchWorkingHours,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
  });

  const [showShiftModal, setShowShiftModal] = useState(false);
  const [showWorkingHoursModal, setShowWorkingHoursModal] = useState(false);
  const [selectedAdminId, setSelectedAdminId] = useState<number | null>(null);
  const [editStartHour, setEditStartHour] = useState(4);
  const [editEndHour, setEditEndHour] = useState(23);
  const [editIsEnabled, setEditIsEnabled] = useState(true);

  useEffect(() => {
    if (!workingHours) return;
    setEditStartHour(workingHours.start_hour_moscow);
    setEditEndHour(workingHours.end_hour_moscow);
    setEditIsEnabled(workingHours.is_enabled);
  }, [workingHours]);

  const refreshShift = () => queryClient.invalidateQueries({ queryKey: queryKeys.admin.shiftContext });
  const refreshWorkingHours = () => queryClient.invalidateQueries({ queryKey: queryKeys.admin.workingHours });

  const shiftMutation = useMutation({
    mutationFn: async (input: { type: "open" | "transfer" | "close"; adminId?: number; adminName?: string }) => {
      const currentShift = shiftContext?.shift;
      if (input.type === "open" && input.adminId) {
        return openShift(input.adminId, input.adminName);
      }
      if (input.type === "transfer" && currentShift?.current_admin_id && input.adminId) {
        return transferShift(currentShift.current_admin_id, input.adminId, input.adminName);
      }
      if (input.type === "close" && currentShift?.current_admin_id) {
        return closeShift(currentShift.current_admin_id);
      }
      throw new Error("Шилжилтийн мэдээлэл дутуу байна");
    },
    onSuccess: () => {
      void refreshShift();
      setShowShiftModal(false);
      setSelectedAdminId(null);
    },
    onError: (_error, input) => {
      const messages = {
        open: "Ээлж эхлүүлэхэд алдаа гарлаа",
        transfer: "Ээлж шилжүүлэхэд алдаа гарлаа",
        close: "Ээлж хаахад алдаа гарлаа",
      } as const;
      alert(messages[input.type]);
    },
  });

  const workingHoursMutation = useMutation({
    mutationFn: () => updateWorkingHours({
      start_hour_moscow: editStartHour,
      end_hour_moscow: editEndHour,
      is_enabled: editIsEnabled,
    }),
    onSuccess: () => {
      void refreshWorkingHours();
      setShowWorkingHoursModal(false);
    },
    onError: () => alert("Ажлын цаг шинэчлэхэд алдаа гарлаа"),
  });

  const shift = shiftContext?.shift;
  const admins = shiftContext?.admins || [];
  const selectedAdmin = admins.find((admin) => admin.id === selectedAdminId);
  const mutationLoading = shiftMutation.isPending;

  const handleCloseShift = () => {
    if (!shift?.current_admin_id || !confirm("Ээлж хаахдаа итгэлтэй байна уу?")) return;
    shiftMutation.mutate({ type: "close" });
  };

  const handleShiftSubmit = () => {
    if (!selectedAdminId) return;
    shiftMutation.mutate({
      type: shift?.is_shift_active ? "transfer" : "open",
      adminId: selectedAdminId,
      adminName: selectedAdmin?.name,
    });
  };

  return (
    <div className="space-y-2" aria-label="Ээлж ба ажлын цаг">
      <div className={`p-3 rounded-xl border ${shift?.is_shift_active ? "bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-800" : "bg-slate-50 border-slate-200 dark:bg-dark-800 dark:border-dark-600"}`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${shift?.is_shift_active ? "bg-green-500 animate-pulse" : "bg-slate-400"}`} />
            <span className={`text-sm font-medium ${shift?.is_shift_active ? "text-green-700 dark:text-green-300" : "text-slate-600 dark:text-ivory-300"}`}>
              {shiftLoading ? "Ээлж ачаалж байна..." : shift?.is_shift_active ? `Ээлж: ${shift.current_admin_name || `Admin ${shift.current_admin_id}`}` : "Ээлж идэвхгүй байна"}
            </span>
            {shift?.last_updated && <span className="text-xs text-green-600 dark:text-green-400">({new Date(shift.last_updated).toLocaleTimeString()}-с)</span>}
          </div>
          <div className="flex items-center gap-2">
            {shift?.is_shift_active ? (
              <>
                <button onClick={() => setShowShiftModal(true)} disabled={mutationLoading} className="text-xs px-2 py-1 rounded-lg bg-blue-100 text-blue-700 hover:bg-blue-200 dark:bg-blue-900/30 dark:text-blue-300 flex items-center gap-1 disabled:opacity-50">
                  <RefreshCw className="w-3 h-3" /> Шилжүүлэх
                </button>
                <button onClick={handleCloseShift} disabled={mutationLoading} className="text-xs px-2 py-1 rounded-lg bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-300 flex items-center gap-1 disabled:opacity-50">
                  <Pause className="w-3 h-3" /> Хаах
                </button>
              </>
            ) : (
              <button onClick={() => setShowShiftModal(true)} disabled={mutationLoading} className="text-xs px-2 py-1 rounded-lg bg-green-100 text-green-700 hover:bg-green-200 dark:bg-green-900/30 dark:text-green-300 flex items-center gap-1 disabled:opacity-50">
                <Play className="w-3 h-3" /> Ээлж эхлүүлэх
              </button>
            )}
          </div>
        </div>
      </div>

      <div className={`p-3 rounded-xl border ${workingHours?.is_enabled ? "bg-blue-50 border-blue-200 dark:bg-blue-900/20 dark:border-blue-800" : "bg-slate-50 border-slate-200 dark:bg-dark-800 dark:border-dark-600"}`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-blue-600 dark:text-blue-300" />
            <div className="flex flex-col">
              <span className="text-sm font-medium text-blue-700 dark:text-blue-300">Ажлын цаг: {workingHours?.start_time_moscow || "04:00"} - {workingHours?.end_time_moscow || "23:00"} (Москва)</span>
              <span className="text-xs text-blue-600 dark:text-blue-400">{workingHours?.start_time_ub || "09:00"} - {workingHours?.end_time_ub || "04:00"} (УБ)</span>
            </div>
            {workingHours && !workingHours.is_enabled && <span className="px-2 py-0.5 bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-300 text-xs rounded-full">Түр хаалттай</span>}
          </div>
          <button onClick={() => setShowWorkingHoursModal(true)} disabled={workingHoursLoading} className="text-xs px-2 py-1 rounded-lg bg-blue-100 text-blue-700 hover:bg-blue-200 dark:bg-blue-900/30 dark:text-blue-300 flex items-center gap-1 disabled:opacity-50">
            <Settings className="w-3 h-3" /> Тохируулах
          </button>
        </div>
      </div>

      {showShiftModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true" aria-label={shift?.is_shift_active ? "Ээлж шилжүүлэх" : "Ээлж эхлүүлэх"}>
          <div className="bg-white dark:bg-dark-800 rounded-xl p-5 max-w-md w-full">
            <div className="flex items-center justify-between mb-4">
              <div className="font-semibold text-maroon-700 dark:text-gold-400 flex items-center gap-2"><UserCheck className="w-5 h-5" />{shift?.is_shift_active ? "Ээлж шилжүүлэх" : "Ээлж эхлүүлэх"}</div>
              <button onClick={() => { setShowShiftModal(false); setSelectedAdminId(null); }} className="p-1 rounded hover:bg-slate-100 dark:hover:bg-dark-700"><X className="w-5 h-5 text-slate-500" /></button>
            </div>
            {shift?.is_shift_active && <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800 mb-4 text-sm text-blue-700 dark:text-blue-300">Одоогийн ээлж: <strong>{shift.current_admin_name || `Admin ${shift.current_admin_id}`}</strong></div>}
            <label className="block text-sm font-medium text-slate-700 dark:text-ivory-300 mb-1">{shift?.is_shift_active ? "Дараагийн админ" : "Админ сонгох"}</label>
            <select value={selectedAdminId || ""} onChange={(event) => setSelectedAdminId(event.target.value ? Number(event.target.value) : null)} className="w-full border border-maroon-200 dark:border-dark-600 rounded-lg p-3 text-sm bg-white dark:bg-dark-700 dark:text-ivory-200">
              <option value="">-- Админ сонгоно уу --</option>
              {admins.filter((admin) => !shift?.is_shift_active || admin.id !== shift.current_admin_id).map((admin) => <option key={admin.id} value={admin.id}>{admin.name} ({admin.id})</option>)}
            </select>
            <button onClick={handleShiftSubmit} disabled={!selectedAdminId || mutationLoading} className="w-full mt-4 py-3 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2">
              {shift?.is_shift_active ? <RefreshCw className={`w-4 h-4 ${mutationLoading ? "animate-spin" : ""}`} /> : <Play className={`w-4 h-4 ${mutationLoading ? "animate-spin" : ""}`} />}
              {shift?.is_shift_active ? "Шилжүүлэх" : "Ээлж эхлүүлэх"}
            </button>
          </div>
        </div>
      )}

      {showWorkingHoursModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true" aria-label="Ажлын цаг тохируулах">
          <div className="bg-white dark:bg-dark-800 rounded-xl p-5 max-w-md w-full">
            <div className="flex items-center justify-between mb-4"><div className="font-semibold text-maroon-700 dark:text-gold-400 flex items-center gap-2"><Clock className="w-5 h-5" />Ажлын цаг тохируулах</div><button onClick={() => setShowWorkingHoursModal(false)} className="p-1 rounded hover:bg-slate-100 dark:hover:bg-dark-700"><X className="w-5 h-5 text-slate-500" /></button></div>
            <div className="space-y-4">
              <div className="flex items-center justify-between p-3 bg-slate-50 dark:bg-dark-700 rounded-lg"><div className="flex items-center gap-2"><Power className={`w-4 h-4 ${editIsEnabled ? "text-green-600" : "text-slate-400"}`} /><span className="text-sm font-medium dark:text-ivory-200">Үйлчилгээ {editIsEnabled ? "идэвхтэй" : "идэвхгүй"}</span></div><button onClick={() => setEditIsEnabled((enabled) => !enabled)} className={`relative w-12 h-6 rounded-full transition-colors ${editIsEnabled ? "bg-green-500" : "bg-slate-300"}`}><span className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${editIsEnabled ? "right-1" : "left-1"}`} /></button></div>
              <div className="grid grid-cols-2 gap-4">
                {[{ label: "Эхлэх (Москвагийн цагаар)", value: editStartHour, set: setEditStartHour }, { label: "Дуусах (Москвагийн цагаар)", value: editEndHour, set: setEditEndHour }].map((field) => <div key={field.label}><label className="block text-sm font-medium text-slate-700 dark:text-ivory-300 mb-1">{field.label}</label><select value={field.value} onChange={(event) => field.set(Number(event.target.value))} disabled={!editIsEnabled} className="w-full border border-maroon-200 dark:border-dark-600 rounded-lg p-3 text-sm bg-white dark:bg-dark-700 dark:text-ivory-200">{HOURS.map((hour) => <option key={hour} value={hour}>{String(hour).padStart(2, "0")}:00</option>)}</select><div className="text-xs text-slate-500 mt-1">УБ: {String((field.value + 5) % 24).padStart(2, "0")}:00</div></div>)}
              </div>
              <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800 text-sm text-blue-700 dark:text-blue-300"><div className="font-medium mb-1">Ажлын цаг:</div><div>Москва: {String(editStartHour).padStart(2, "0")}:00 - {String(editEndHour).padStart(2, "0")}:00</div><div>Улаанбаатар: {String((editStartHour + 5) % 24).padStart(2, "0")}:00 - {String((editEndHour + 5) % 24).padStart(2, "0")}:00</div></div>
              <div className="flex gap-2"><button onClick={() => setShowWorkingHoursModal(false)} className="flex-1 py-2 rounded-lg bg-slate-100 dark:bg-dark-700 text-slate-700 dark:text-ivory-200 hover:bg-slate-200">Цуцлах</button><button onClick={() => workingHoursMutation.mutate()} disabled={workingHoursMutation.isPending} className="flex-1 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2">{workingHoursMutation.isPending && <RefreshCw className="w-4 h-4 animate-spin" />}Хадгалах</button></div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
