import { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, Pencil, Plus, RotateCcw, Upload } from "lucide-react";
import {
  createAdminOyunsPlusCard,
  fetchAdminOyunsPlusCards,
  OyunsPlusCard,
  presignAdminOyunsPlusUpload,
  archiveAdminOyunsPlusCard,
  restoreAdminOyunsPlusCard,
  updateAdminOyunsPlusCard,
} from "../../api";
import { queryKeys } from "../../queryKeys";
import { prepareImageForUpload } from "../../utils/imageUpload";
import { AdminEmptyState, AdminRefreshButton, AdminSectionHeader } from "./AdminPanelPrimitives";

const empty = { name: "", description: "", points_price: 0, image_url: "", image_path: null as string | null, is_active: true };
const validImage = (file: File) => ["image/jpeg", "image/png", "image/webp"].includes(file.type) && file.size <= 2 * 1024 * 1024;

function AdminOyunsPlusCardsContent() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(empty);
  const [editing, setEditing] = useState<string | null>(null);
  const [showArchive, setShowArchive] = useState(false);
  const [error, setError] = useState("");
  const cardsQuery = useQuery({ queryKey: queryKeys.admin.oyunsPlusCards, queryFn: () => fetchAdminOyunsPlusCards(true) });
  const saveMutation = useMutation({ mutationFn: () => editing ? updateAdminOyunsPlusCard(editing, form) : createAdminOyunsPlusCard(form), onSuccess: () => { void queryClient.invalidateQueries({ queryKey: queryKeys.admin.oyunsPlusCards }); setForm(empty); setEditing(null); } });
  const archiveMutation = useMutation({ mutationFn: (card: OyunsPlusCard) => card.archived_at ? restoreAdminOyunsPlusCard(card.id) : archiveAdminOyunsPlusCard(card.id), onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.admin.oyunsPlusCards }) });
  const toggleMutation = useMutation({ mutationFn: (card: OyunsPlusCard) => updateAdminOyunsPlusCard(card.id, { is_active: !card.is_active }), onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.admin.oyunsPlusCards }) });
  const cards = (cardsQuery.data?.cards ?? []).filter((card) => Boolean(card.archived_at) === showArchive);

  useEffect(() => { if (!editing) setForm(empty); }, [editing]);
  const upload = async (file: File) => {
    setError("");
    if (!validImage(file)) { setError("JPG, PNG эсвэл WebP зураг 2MB-аас бага байх ёстой."); return; }
    const image = new Image(); image.onload = async () => { URL.revokeObjectURL(image.src); if (Math.abs(image.width / image.height - 2) > 0.08 || image.width < 800 || image.height < 400) { setError("Зураг 2:1 харьцаатай, дор хаяж 800×400px байх ёстой."); return; } try { const prepared = await prepareImageForUpload(file); const signed = await presignAdminOyunsPlusUpload({ asset_type: "card", extension: prepared.extension as "jpg" | "jpeg" | "png" | "webp", mime_type: prepared.mimeType as "image/jpeg" | "image/png" | "image/webp" }); const response = await fetch(signed.upload_url, { method: "PUT", body: prepared.file, headers: { "Content-Type": prepared.mimeType } }); if (!response.ok) throw new Error(); setForm((current) => ({ ...current, image_url: signed.public_url || "", image_path: signed.path })); } catch { setError("Зураг оруулахад алдаа гарлаа."); } }; image.onerror = () => { URL.revokeObjectURL(image.src); setError("Зургийг уншихад алдаа гарлаа."); }; image.src = URL.createObjectURL(file);
  };
  return <div className="space-y-4">
    <form className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-dark-600 dark:bg-dark-800" onSubmit={(event) => { event.preventDefault(); if (!form.name.trim() || !form.description.trim() || form.points_price < 1 || !form.image_url) { setError("Нэр, тайлбар, үнэ болон зураг шаардлагатай."); return; } saveMutation.mutate(); }}>
      <div className="flex items-center justify-between"><h3 className="font-semibold">{editing ? "Эрх засах" : "Шинэ эрх үүсгэх"}</h3>{editing && <button type="button" className="text-xs text-slate-500" onClick={() => setEditing(null)}>Цуцлах</button>}</div>
      <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Эрхийн нэр" className="w-full rounded-xl border px-3 py-2 dark:border-dark-600 dark:bg-dark-700" />
      <textarea required value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Тайлбар" className="min-h-20 w-full rounded-xl border px-3 py-2 dark:border-dark-600 dark:bg-dark-700" />
      <input required min={1} type="number" value={form.points_price || ""} onChange={(e) => setForm({ ...form, points_price: Number(e.target.value) })} placeholder="Онооны үнэ" className="w-full rounded-xl border px-3 py-2 dark:border-dark-600 dark:bg-dark-700" />
      <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed px-3 py-3 text-sm"><Upload className="h-4 w-4" />{form.image_url ? "Зургийг солих" : "2:1 зураг оруулах"}<input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => { const file = e.target.files?.[0]; if (file) void upload(file); e.currentTarget.value = ""; }} /></label>
      {form.image_url && <img src={form.image_url} alt="" className="h-28 w-full rounded-xl object-cover" />}
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />Идэвхтэй</label>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button disabled={saveMutation.isPending} className="inline-flex items-center gap-2 rounded-xl bg-maroon-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"><Plus className="h-4 w-4" />{editing ? "Хадгалах" : "Үүсгэх"}</button>
    </form>
    <div className="flex flex-wrap items-center justify-between gap-2"><AdminSectionHeader icon={Archive} title={showArchive ? "Архив" : "Идэвхтэй эрхүүд"} count={cards.length} action={<div className="flex items-center gap-2"><AdminRefreshButton onClick={() => void cardsQuery.refetch()} loading={cardsQuery.isFetching} label="OYUNS+ эрх шинэчлэх" /><button type="button" onClick={() => setShowArchive(!showArchive)} className="text-xs font-semibold text-maroon-700 hover:text-maroon-800">{showArchive ? "Идэвхтэйг харах" : "Архив харах"}</button></div>} /></div>
    <div className="space-y-2">{cards.length === 0 ? <AdminEmptyState>Эрх бүртгэгдээгүй байна</AdminEmptyState> : cards.map((card) => <div key={card.id} className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 dark:border-dark-600 dark:bg-dark-800">{card.image_url && <img src={card.image_url} alt="" className="h-14 w-24 rounded-lg object-cover" />}<div className="min-w-0 flex-1"><p className="truncate font-semibold">{card.name}</p><p className="text-xs text-slate-500">{card.points_price.toLocaleString()} оноо · {card.is_active ? "идэвхтэй" : "идэвхгүй"}</p></div>{!showArchive && <><button type="button" title="Засах" onClick={() => { setEditing(card.id); setForm({ name: card.name, description: card.description, points_price: card.points_price, image_url: card.image_url, image_path: card.image_path || null, is_active: card.is_active }); }} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><Pencil className="h-4 w-4" /></button><button type="button" onClick={() => toggleMutation.mutate(card)} className="rounded-lg px-2 py-1 text-xs text-slate-500">{card.is_active ? "Унтраах" : "Идэвхжүүлэх"}</button></>}<button type="button" onClick={() => archiveMutation.mutate(card)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" title={showArchive ? "Сэргээх" : "Архивлах"}>{showArchive ? <RotateCcw className="h-4 w-4" /> : <Archive className="h-4 w-4" />}</button></div>)}</div>
  </div>;
}

// Keep this settings module independently renderable in the standalone admin
// shell and in lightweight tests that do not mount the app query provider.
export function AdminOyunsPlusCards() {
  const [queryClient] = useState(() => new QueryClient());
  return <QueryClientProvider client={queryClient}><AdminOyunsPlusCardsContent /></QueryClientProvider>;
}
