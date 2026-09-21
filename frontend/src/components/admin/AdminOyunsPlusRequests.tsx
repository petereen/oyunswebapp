import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, Gift, RotateCcw, Upload } from "lucide-react";
import {
  confirmAdminOyunsPlusRequest,
  fetchAdminOyunsPlusRequests,
  OyunsPlusVoucherRequest,
  presignAdminOyunsPlusUpload,
  refundAdminOyunsPlusRequest,
} from "../../api";
import { queryKeys } from "../../queryKeys";
import { ADMIN_CONTROL_CLASS, AdminEmptyState, AdminRefreshButton, AdminSectionHeader } from "./AdminPanelPrimitives";

const statuses = ["pending", "fulfilled", "refunded", "all"] as const;
type Status = (typeof statuses)[number];
const isImage = (file: File) => ["image/jpeg", "image/png", "image/webp"].includes(file.type);

export function AdminOyunsPlusRequests() {
  const [status, setStatus] = useState<Status>("pending");
  const [selected, setSelected] = useState<string | null>(null);
  const [photoPath, setPhotoPath] = useState<Record<string, string>>({});
  const [explanation, setExplanation] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const queryClient = useQueryClient();
  const requestsQuery = useQuery({ queryKey: queryKeys.admin.oyunsPlusRequests(status), queryFn: () => fetchAdminOyunsPlusRequests(status) });
  const confirmMutation = useMutation({ mutationFn: ({ id, path, note }: { id: string; path: string; note?: string }) => confirmAdminOyunsPlusRequest(id, path, note), onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["admin", "oyuns-plus", "requests"] }); setSelected(null); } });
  const refundMutation = useMutation({ mutationFn: ({ id, why }: { id: string; why: string }) => refundAdminOyunsPlusRequest(id, why), onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["admin", "oyuns-plus", "requests"] }); setSelected(null); setReason(""); }, onError: (mutationError: unknown) => { const statusCode = (mutationError as { response?: { status?: number } })?.response?.status; if (statusCode === 409) { setError("Энэ хүсэлт аль хэдийн боловсруулагдсан байна. Жагсаалтыг шинэчиллээ."); void queryClient.invalidateQueries({ queryKey: ["admin", "oyuns-plus", "requests"] }); } else { setError("Оноо буцаахад алдаа гарлаа. Дахин оролдоно уу."); } } });

  const uploadPhoto = async (request: OyunsPlusVoucherRequest, file: File) => {
    setError("");
    if (!isImage(file) || file.size > 2 * 1024 * 1024) { setError("JPG, PNG эсвэл WebP зураг 2MB-аас бага байх ёстой."); return; }
    setUploading(request.id);
    try {
      const extension = (file.name.split(".").pop()?.toLowerCase() || "jpg") as "jpg" | "jpeg" | "png" | "webp";
      const signed = await presignAdminOyunsPlusUpload({ asset_type: "confirmation", request_id: request.id, extension, mime_type: file.type as "image/jpeg" | "image/png" | "image/webp" });
      const response = await fetch(signed.upload_url, { method: "PUT", body: file, headers: { "Content-Type": file.type } });
      if (!response.ok) throw new Error("upload failed");
      setPhotoPath((current) => ({ ...current, [request.id]: signed.path }));
    } catch { setError("Баталгаажуулах зургийг оруулахад алдаа гарлаа."); } finally { setUploading(null); }
  };

  const requests = requestsQuery.data?.requests ?? [];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <AdminSectionHeader icon={Gift} title="OYUNS+ хүсэлтүүд" count={requests.length} />
        <div className="flex flex-wrap items-center gap-1.5">
          {statuses.map((item) => <button key={item} type="button" onClick={() => setStatus(item)} aria-pressed={status === item} className={`${ADMIN_CONTROL_CLASS} h-8 rounded-full px-3 ${status === item ? "!border-maroon-600 !bg-maroon-600 !text-white hover:!bg-maroon-700 hover:!text-white" : ""}`}>{item === "all" ? "Бүгд" : item === "pending" ? "Хүлээгдэж буй" : item === "fulfilled" ? "Баталгаажсан" : "Буцаасан"}</button>)}
          <AdminRefreshButton onClick={() => void requestsQuery.refetch()} loading={requestsQuery.isFetching} label="OYUNS+ хүсэлт шинэчлэх" />
        </div>
      </div>
      {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">{error}</p>}
      {requestsQuery.isLoading ? <p className="py-6 text-center text-xs text-slate-400">Ачаалж байна…</p> : requests.length === 0 ? <AdminEmptyState>Хүсэлт алга.</AdminEmptyState> : requests.map((request) => {
        const open = selected === request.id;
        const pending = request.status === "pending";
        return <article key={request.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-dark-600 dark:bg-dark-800">
          <button type="button" onClick={() => setSelected(open ? null : request.id)} className="flex w-full items-center justify-between gap-3 p-4 text-left"><span><span className="block font-semibold text-slate-800 dark:text-ivory-100">{request.card_name}</span><span className="block text-xs text-slate-500">{request.receiver_name} · {request.points_spent.toLocaleString()} оноо</span></span><ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} /></button>
          {open && <div className="space-y-3 border-t border-slate-100 p-4 text-sm dark:border-dark-600"><div className="grid gap-2 sm:grid-cols-2"><p><strong>Хүлээн авагч:</strong> {request.receiver_name}</p><p><strong>Утас:</strong> {request.receiver_phone}</p><p><strong>Хэрэглэгч:</strong> {request.user_name || request.user_id}</p><p><strong>Огноо:</strong> {request.created_at ? new Date(request.created_at).toLocaleString() : "—"}</p></div>{pending && <><label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-maroon-300 px-3 py-3 text-sm text-maroon-700"><Upload className="h-4 w-4" />{uploading === request.id ? "Оруулж байна…" : "Баталгааны зураг сонгох"}<input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={Boolean(uploading)} onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadPhoto(request, file); event.currentTarget.value = ""; }} /></label><input type="text" value={explanation[request.id] || ""} onChange={(event) => setExplanation((current) => ({ ...current, [request.id]: event.target.value }))} placeholder="Тайлбар" aria-label="Тайлбар" maxLength={2000} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition placeholder:text-slate-400 focus:border-maroon-400 focus:ring-2 focus:ring-maroon-100 dark:border-dark-600 dark:bg-dark-800 dark:placeholder:text-ivory-500" /><div className="flex flex-wrap gap-2"><button type="button" disabled={!photoPath[request.id] || confirmMutation.isPending} onClick={() => photoPath[request.id] && confirmMutation.mutate({ id: request.id, path: photoPath[request.id], note: explanation[request.id] })} className="inline-flex items-center gap-1 rounded-xl bg-emerald-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40"><Check className="h-4 w-4" />Баталгаажуулах</button><button type="button" onClick={() => { const why = window.prompt("Буцаах шалтгаан:", reason); if (why?.trim()) { setReason(why.trim()); refundMutation.mutate({ id: request.id, why: why.trim() }); } }} disabled={refundMutation.isPending} className="inline-flex items-center gap-1 rounded-xl bg-amber-100 px-3 py-2 text-sm font-semibold text-amber-800 disabled:opacity-40"><RotateCcw className="h-4 w-4" />Оноо буцаах</button></div></>}{request.confirmation_note && <p className="text-slate-600 dark:text-ivory-300">Тайлбар: {request.confirmation_note}</p>}{request.refund_reason && <p className="text-amber-700">Шалтгаан: {request.refund_reason}</p>}{request.confirmation_photo_url && <a className="text-xs text-maroon-700 underline" href={request.confirmation_photo_url} target="_blank" rel="noreferrer">Баталгааны зургийг харах</a>}</div>}
        </article>;
      })}
    </div>
  );
}
