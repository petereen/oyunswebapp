import { useEffect, useState, useMemo } from "react";
import {
  ShieldCheck,
  XCircle,
  Image,
  X,
  Copy,
  CheckCircle2,
  Upload,
  Clock,
  ArrowUpDown,
  Filter,
  ChevronDown,
  ChevronUp,
  Play,
  Pause,
  RefreshCw,
  UserCheck,
  Settings,
  Power,
  AlertCircle,
} from "lucide-react";
import { 
  AdminInboxItem as InboxItem,
  adminAction, 
  fetchInbox, 
  requestPresign,
  fetchCurrentShift,
  fetchAdminUsers,
  openShift,
  closeShift,
  transferShift,
  fetchWorkingHours,
  updateWorkingHours,
  updateUserLabel,
  ShiftResponse,
  AdminUser,
  WorkingHoursConfig,
} from "../api";

const LABEL_PRESETS: { name: string; color: string; bg: string; border: string }[] = [
  { name: "Тэмдэглэл", color: "text-green-700", bg: "bg-green-100", border: "border-green-300" },
  { name: "Сэжигтэй", color: "text-red-700", bg: "bg-red-100", border: "border-red-300" },
];

function getLabelStyle(label: string | undefined) {
  if (!label) return { color: "text-slate-500", bg: "bg-slate-100", border: "border-slate-300" };
  const preset = LABEL_PRESETS.find(p => p.name === label);
  if (preset) return preset;
  return { color: "text-yellow-700", bg: "bg-yellow-100", border: "border-yellow-300" };
}

type SortOption = "oldest" | "newest" | "amount_asc" | "amount_desc";
type FilterOption = "all" | "buy" | "sell";

// Format date to Moscow/UB timezone
function formatToTimezone(dateStr: string, tz: string): string {
  const date = new Date(dateStr);
  return date.toLocaleString("en-GB", {
    timeZone: tz,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getTimeAgo(dateStr: string, nowMs: number): string {
  // Parse the timestamp as UTC
  let then: Date;
  if (dateStr.endsWith('Z') || dateStr.includes('+')) {
    then = new Date(dateStr);
  } else {
    // Assume UTC if no timezone specified
    then = new Date(dateStr + 'Z');
  }
  
  // Get current time in UTC
  const now = nowMs;
  const thenMs = then.getTime();
  
  // Calculate difference in milliseconds
  const diffMs = now - thenMs;
  
  // Handle edge case where server time might be slightly ahead
  if (diffMs < 0) return "дөнгөж сая";
  
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return "дөнгөж сая";
  if (diffMins < 60) return `${diffMins} мин өмнө`;
  if (diffHours < 24) return `${diffHours} цаг ${diffMins % 60} мин өмнө`;
  return `${diffDays} өдөр ${diffHours % 24} цаг өмнө`;
}

function getAdminActionError(error: unknown, fallback: string): string {
  const response = (error as { response?: { data?: { detail?: unknown } } })?.response;
  const detail = response?.data?.detail;
  return typeof detail === "string" && detail.trim() ? detail : fallback;
}

// No props needed - auth is removed
export function AdminInbox() {
  const [items, setItems] = useState<InboxItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [relativeNowMs, setRelativeNowMs] = useState(() => Date.now());

  // UI state - Changed from expandedInvoice to detailModal for popup
  const [detailModal, setDetailModal] = useState<InboxItem | null>(null);
  const [photoModal, setPhotoModal] = useState<string | null>(null);
  const [rejectModal, setRejectModal] = useState<string | null>(null);
  const [rejectComment, setRejectComment] = useState("");
  const [rejectBillUrls, setRejectBillUrls] = useState<string[]>([]);
  const [rejectUploading, setRejectUploading] = useState(false);
  const [confirmModal, setConfirmModal] = useState<InboxItem | null>(null);
  const [adminBillUrls, setAdminBillUrls] = useState<string[]>([]); // Changed to array for multiple photos
  const [confirmCompletedByAdminId, setConfirmCompletedByAdminId] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);

  // Label editing state
  const [labelModal, setLabelModal] = useState<{ userId: number; currentLabel?: string; currentNote?: string } | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editLabelNote, setEditLabelNote] = useState("");
  const [editLabelCustom, setEditLabelCustom] = useState("");
  const [labelSaving, setLabelSaving] = useState(false);
  const [expandedLabel, setExpandedLabel] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);

  // Helper function to parse bill_url (can be JSON array or single URL string)
  const parseBillUrls = (billUrl?: string): string[] => {
    if (!billUrl) return [];
    try {
      const parsed = JSON.parse(billUrl);
      if (Array.isArray(parsed)) return parsed;
      return [billUrl];
    } catch {
      // Not JSON, treat as single URL
      return [billUrl];
    }
  };

  // Sort & Filter
  const [sortBy, setSortBy] = useState<SortOption>("oldest");
  const [filterBy, setFilterBy] = useState<FilterOption>("all");
  const [showSortMenu, setShowSortMenu] = useState(false);
  const [showFilterMenu, setShowFilterMenu] = useState(false);

  // Shift Management State - using new flat structure
  const [currentShift, setCurrentShift] = useState<ShiftResponse | null>(null);
  const [shiftLoading, setShiftLoading] = useState(false);
  const [showShiftModal, setShowShiftModal] = useState(false);
  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([]);
  const [selectedAdminId, setSelectedAdminId] = useState<number | null>(null);

  // Working Hours Management State
  const [workingHours, setWorkingHours] = useState<WorkingHoursConfig | null>(null);
  const [showWorkingHoursModal, setShowWorkingHoursModal] = useState(false);
  const [workingHoursLoading, setWorkingHoursLoading] = useState(false);
  const [editStartHour, setEditStartHour] = useState<number>(4);
  const [editEndHour, setEditEndHour] = useState<number>(23);
  const [editIsEnabled, setEditIsEnabled] = useState<boolean>(true);

  const load = async () => {
    try {
      setLoading(true);
      const res = await fetchInbox();
      console.log("Loaded items:", res.items);
      setItems(res.items || []);
    } catch {
      setError("Ирсэн хүсэлтүүдийг ачаалж чадсангүй");
    } finally {
      setLoading(false);
    }
  };

  const loadShift = async () => {
    try {
      setShiftLoading(true);
      const [shiftRes, usersRes] = await Promise.all([
        fetchCurrentShift(),
        fetchAdminUsers(),
      ]);
      setCurrentShift(shiftRes);
      setAdminUsers(usersRes.admins || []);
    } catch (err) {
      console.error("Failed to load shift:", err);
    } finally {
      setShiftLoading(false);
    }
  };

  const loadWorkingHours = async () => {
    try {
      setWorkingHoursLoading(true);
      const config = await fetchWorkingHours();
      setWorkingHours(config);
      setEditStartHour(config.start_hour_moscow);
      setEditEndHour(config.end_hour_moscow);
      setEditIsEnabled(config.is_enabled);
    } catch (err) {
      console.error("Failed to load working hours:", err);
    } finally {
      setWorkingHoursLoading(false);
    }
  };

  const handleUpdateWorkingHours = async () => {
    try {
      setWorkingHoursLoading(true);
      await updateWorkingHours({
        start_hour_moscow: editStartHour,
        end_hour_moscow: editEndHour,
        is_enabled: editIsEnabled,
      });
      await loadWorkingHours();
      setShowWorkingHoursModal(false);
    } catch (err) {
      console.error("Failed to update working hours:", err);
      alert("Ажлын цаг шинэчлэхэд алдаа гарлаа");
    } finally {
      setWorkingHoursLoading(false);
    }
  };

  const handleOpenShift = async () => {
    if (!selectedAdminId) return;
    const selectedAdmin = adminUsers.find(a => a.id === selectedAdminId);
    try {
      setShiftLoading(true);
      await openShift(selectedAdminId, selectedAdmin?.name);
      await loadShift();
      setShowShiftModal(false);
      setSelectedAdminId(null);
    } catch (err) {
      console.error("Failed to open shift:", err);
      alert("Ээлж эхлүүлэхэд алдаа гарлаа");
    } finally {
      setShiftLoading(false);
    }
  };

  const handleCloseShift = async () => {
    if (!currentShift?.current_admin_id) return;
    if (!confirm("Ээлж хаахдаа итгэлтэй байна уу?")) return;
    try {
      setShiftLoading(true);
      await closeShift(currentShift.current_admin_id);
      setCurrentShift(null);
    } catch (err) {
      console.error("Failed to close shift:", err);
      alert("Ээлж хаахад алдаа гарлаа");
    } finally {
      setShiftLoading(false);
    }
  };

  const handleTransferShift = async () => {
    if (!currentShift?.current_admin_id || !selectedAdminId) return;
    const selectedAdmin = adminUsers.find(a => a.id === selectedAdminId);
    try {
      setShiftLoading(true);
      await transferShift(currentShift.current_admin_id, selectedAdminId, selectedAdmin?.name);
      await loadShift();
      setShowShiftModal(false);
      setSelectedAdminId(null);
    } catch (err) {
      console.error("Failed to transfer shift:", err);
      alert("Ээлж шилжүүлэхэд алдаа гарлаа");
    } finally {
      setShiftLoading(false);
    }
  };

  useEffect(() => {
    load();
    loadShift();
    loadWorkingHours();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setRelativeNowMs(Date.now());
    }, 30000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    if (!confirmModal) {
      setConfirmCompletedByAdminId(null);
      return;
    }
    if (confirmCompletedByAdminId !== null) return;
    if (currentShift?.current_admin_id) {
      setConfirmCompletedByAdminId(currentShift.current_admin_id);
    }
  }, [confirmModal, confirmCompletedByAdminId, currentShift?.current_admin_id]);

  // Sort and filter items
  const displayItems = useMemo(() => {
    let filtered = [...items];

    // Filter
    if (filterBy === "buy") {
      filtered = filtered.filter((i) => i.direction === "buy" || i.currency_from.toUpperCase() === "RUB");
    } else if (filterBy === "sell") {
      filtered = filtered.filter((i) => i.direction === "sell" || i.currency_from.toUpperCase() === "MNT");
    }

    // Sort
    filtered.sort((a, b) => {
      switch (sortBy) {
        case "oldest":
          return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
        case "newest":
          return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
        case "amount_asc":
          return Number(a.amount) - Number(b.amount);
        case "amount_desc":
          return Number(b.amount) - Number(a.amount);
        default:
          return 0;
      }
    });

    return filtered;
  }, [items, sortBy, filterBy]);

  // Separate pending and approved items
  const pendingItems = useMemo(() => {
    const pending = displayItems.filter((i) => i.status === "pending");
    console.log("Pending items:", pending.length, pending.map(i => ({ invoice: i.invoice, status: i.status })));
    return pending;
  }, [displayItems]);

  const approvedItems = useMemo(() => {
    const approved = displayItems.filter((i) => i.status === "approved");
    console.log("Approved items:", approved.length, approved.map(i => ({ invoice: i.invoice, status: i.status })));
    return approved;
  }, [displayItems]);

  const handleApprove = async (invoice: string) => {
    try {
      console.log("Approving invoice:", invoice);
      const result = await adminAction({ invoice, status: "approved", processing_mode: "traditional" });
      console.log("Approval result:", result);
      setDetailModal(null);
      await load();
      console.log("Items after reload:", items);
    } catch (err) {
      console.error("Approval error:", err);
      setError("Гүйлгээг баталж, Telegram дараалалд оруулахад алдаа гарлаа");
    }
  };

  const handleRevertToPending = async (invoice: string) => {
    try {
      await adminAction({ invoice, status: "pending" });
      await load();
    } catch (err) {
      console.error("Revert to pending error:", err);
    }
  };

  const handleSetWaitingEdit = async (invoice: string) => {
    const reason = window.prompt("Хэрэглэгчид харагдах тайлбар (заавал биш):", "Мэдээллээ засаад дахин илгээнэ үү.");
    if (reason === null) return;
    try {
      await adminAction({
        invoice,
        status: "waiting_edit",
        rejection_comment: reason.trim() || undefined,
      });
      setDetailModal(null);
      await load();
    } catch (err) {
      console.error("Set waiting_edit error:", err);
    }
  };

  const handleReject = async () => {
    if (!rejectModal) return;
    try {
      await adminAction({
        invoice: rejectModal,
        status: "rejected",
        rejection_comment: rejectComment,
        admin_bill_url: rejectBillUrls.length > 0 ? JSON.stringify(rejectBillUrls) : undefined,
      });
      setRejectModal(null);
      setRejectComment("");
      setRejectBillUrls([]);
      await load();
    } catch (err) {
      console.error("Rejection error:", err);
    }
  };

  const handleRejectBillUpload = async (files: FileList) => {
    if (!rejectModal || files.length === 0) return;
    setRejectUploading(true);
    try {
      const uploadedUrls: string[] = [...rejectBillUrls];
      for (const file of Array.from(files)) {
        const path = `admin/${Date.now()}-${file.name}`;
        const presigned = await requestPresign({ bucket: "bills", path });
        await fetch(presigned.upload_url, {
          method: "PUT",
          body: file,
          headers: { "Content-Type": file.type },
        });
        uploadedUrls.push(presigned.public_url);
      }
      setRejectBillUrls(uploadedUrls);
    } catch {
      alert("Upload failed");
    } finally {
      setRejectUploading(false);
    }
  };

  const handleSaveLabel = async () => {
    if (!labelModal) return;
    setLabelSaving(true);
    try {
      const finalLabel = editLabel === "__custom__" ? editLabelCustom.trim() : editLabel;
      await updateUserLabel({
        user_id: labelModal.userId,
        admin_label: finalLabel || null,
        admin_label_note: editLabelNote || null,
      });
      // Update the item in local state
      setItems(prev => prev.map(it =>
        it.user_id === labelModal.userId
          ? { ...it, admin_label: finalLabel || undefined, admin_label_note: editLabelNote || undefined }
          : it
      ));
      if (detailModal && detailModal.user_id === labelModal.userId) {
        setDetailModal(prev => prev ? { ...prev, admin_label: finalLabel || undefined, admin_label_note: editLabelNote || undefined } : null);
      }
      setLabelModal(null);
    } catch (err) {
      console.error("Label save error:", err);
      alert("Тэмдэглэл хадгалахад алдаа гарлаа");
    } finally {
      setLabelSaving(false);
    }
  };

  // Track which field was copied
  const [copiedField, setCopiedField] = useState<string | null>(null);
  
  const handleCopy = async (text: string, fieldId?: string) => {
    const cleanText = text.replace(/\s/g, "");
    try {
      await navigator.clipboard.writeText(cleanText);
    } catch {
      // Fallback for older browsers
      const textArea = document.createElement("textarea");
      textArea.value = cleanText;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand("copy");
      document.body.removeChild(textArea);
    }
    setCopiedField(fieldId || "generic");
    setCopied(true);
    setTimeout(() => {
      setCopied(false);
      setCopiedField(null);
    }, 2000);
  };

  // Parse bank_details into structured format
  // New format: "bank,phone,card,owner" (comma-separated) for RUB
  // or "bank,account,owner" for MNT
  const parseBankDetails = (details: string, isBuy: boolean) => {
    const result: { bank?: string; phone?: string; card?: string; account?: string; owner?: string; raw: string } = { raw: details };
    
    // Try comma-separated format first
    const parts = details.split(",").map(p => p.trim()).filter(Boolean);
    
    if (parts.length >= 3) {
      if (isBuy) {
        // MNT format: bank,account,owner
        result.bank = parts[0];
        result.account = parts[1];
        result.owner = parts[2];
      } else {
        // RUB format: bank,phone,card,owner
        result.bank = parts[0];
        result.phone = parts[1];
        result.card = parts[2];
        result.owner = parts[3] || "";
      }
      return result;
    }
    
    // Fallback: try old newline format
    const lines = details.split("\n").map(l => l.trim()).filter(Boolean);
    
    for (const line of lines) {
      // Detect card number (16 digits with or without spaces)
      if (/^\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}$/.test(line.replace(/\s/g, '').replace(/-/g, '')) || 
          /^\d{16}$/.test(line.replace(/\s/g, ''))) {
        result.card = line;
      }
      // Detect phone number (starts with + or 8 or digits only starting with 9)
      else if (/^[\+]?[78]?\d{10,11}$/.test(line.replace(/\s/g, '').replace(/-/g, '')) ||
               /^[\+]?\d{1,3}[\s-]?\d{3,4}[\s-]?\d{3,4}[\s-]?\d{2,4}$/.test(line)) {
        result.phone = line;
      }
      // Detect bank name (contains bank keywords)
      else if (/банк|bank|сбер|тинь|альфа|втб|хаан|голом|хас|төрийн/i.test(line)) {
        result.bank = line;
      }
      // Otherwise assume it's owner name (if it looks like a name - Cyrillic or Latin letters)
      else if (/^[а-яёА-ЯЁa-zA-Z\s]+$/.test(line) && line.length > 2) {
        result.owner = line;
      }
    }
    
    return result;
  };

  const isPhoneTopup = (item: InboxItem) => item.service_kind === "phone_topup";

  const getTopupDetails = (item: InboxItem) => {
    const fallbackParts = (item.bank_details || "").split(",").map((part) => part.trim()).filter(Boolean);
    return {
      phone: item.topup_phone || fallbackParts[0] || "-",
      telecom: item.topup_telecom || fallbackParts[1] || "-",
    };
  };

  const handleAdminBillUpload = async (files: FileList) => {
    if (!confirmModal || files.length === 0) return;
    setUploading(true);
    try {
      const uploadedUrls: string[] = [...adminBillUrls];
      for (const file of Array.from(files)) {
        const path = `admin/${Date.now()}-${file.name}`;
        const presigned = await requestPresign({ bucket: "bills", path });
        await fetch(presigned.upload_url, {
          method: "PUT",
          body: file,
          headers: { "Content-Type": file.type },
        });
        uploadedUrls.push(presigned.public_url);
      }
      setAdminBillUrls(uploadedUrls);
    } catch {
      alert("Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const removeAdminBillUrl = (index: number) => {
    setAdminBillUrls(prev => prev.filter((_, i) => i !== index));
  };

  const openConfirmModal = (item: InboxItem) => {
    setConfirmModal(item);
    setDetailModal(null);
    setAdminBillUrls(parseBillUrls(item.admin_bill_url));
    setConfirmCompletedByAdminId(currentShift?.current_admin_id ?? null);
  };

  const handleConfirmTransaction = async () => {
    if (!confirmModal) return;
    const completingAdminId = confirmCompletedByAdminId ?? currentShift?.current_admin_id ?? null;
    if (!completingAdminId) {
      alert("Гүйлгээг дуусгасан админыг сонгоно уу");
      return;
    }
    await adminAction({
      invoice: confirmModal.invoice,
      status: "successful",
      admin_bill_url: adminBillUrls.length > 0 ? JSON.stringify(adminBillUrls) : undefined,
      completed_by_admin: completingAdminId,
    });
    setConfirmModal(null);
    setAdminBillUrls([]);
    setConfirmCompletedByAdminId(null);
    await load();
  };

  const getDirectionLabel = (item: InboxItem) => {
    if (isPhoneTopup(item)) {
      return { label: "TOPUP", color: "bg-sky-100 text-sky-700" };
    }
    if (item.direction === "buy" || item.currency_from.toUpperCase() === "RUB") {
      return { label: "BUY", color: "bg-green-100 text-green-700" };
    }
    return { label: "SELL", color: "bg-orange-100 text-orange-700" };
  };

  const getDispatchLabel = (status?: InboxItem["group_dispatch_status"]) => {
    switch (status) {
      case "queued": return "Илгээх дараалалд";
      case "sending": return "Групп рүү илгээж байна";
      case "awaiting_proof": return "Группийн баримт хүлээж байна";
      case "processing": return "Баримт боловсруулж байна";
      case "completed": return "Автоматаар дууссан";
      case "failed": return "Telegram групп рүү илгээж чадсангүй";
      default: return "Дараалал үүсгэж байна";
    }
  };

  return (
    <div className="glass-card p-5 rounded-2xl border border-white/60 flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between text-maroon-700 font-semibold">
        <span>Ирсэн гүйлгээний хүсэлтүүд</span>
        <button
          className="text-xs px-3 py-1 rounded-full bg-maroon-600 text-white"
          onClick={load}
          disabled={loading}
        >
          Дахин ачаалах
        </button>
      </div>

      {/* Shift Status Bar */}
      <div className={`p-3 rounded-xl border ${currentShift?.is_shift_active ? 'bg-green-50 border-green-200' : 'bg-slate-50 border-slate-200'}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {currentShift?.is_shift_active ? (
              <>
                <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                <span className="text-sm font-medium text-green-700">
                  Ээлж: {currentShift.current_admin_name || `Admin ${currentShift.current_admin_id}`}
                </span>
                {currentShift.last_updated && (
                  <span className="text-xs text-green-600">
                    ({new Date(currentShift.last_updated).toLocaleTimeString()}-с)
                  </span>
                )}
              </>
            ) : (
              <>
                <div className="w-2 h-2 rounded-full bg-slate-400" />
                <span className="text-sm text-slate-600">Ээлж идэвхгүй байна</span>
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            {currentShift?.is_shift_active ? (
              <>
                <button
                  onClick={() => setShowShiftModal(true)}
                  className="text-xs px-2 py-1 rounded-lg bg-blue-100 text-blue-700 hover:bg-blue-200 flex items-center gap-1"
                  disabled={shiftLoading}
                >
                  <RefreshCw className="w-3 h-3" /> Шилжүүлэх
                </button>
                <button
                  onClick={handleCloseShift}
                  className="text-xs px-2 py-1 rounded-lg bg-red-100 text-red-700 hover:bg-red-200 flex items-center gap-1"
                  disabled={shiftLoading}
                >
                  <Pause className="w-3 h-3" /> Хаах
                </button>
              </>
            ) : (
              <button
                onClick={() => setShowShiftModal(true)}
                className="text-xs px-2 py-1 rounded-lg bg-green-100 text-green-700 hover:bg-green-200 flex items-center gap-1"
                disabled={shiftLoading}
              >
                <Play className="w-3 h-3" /> Ээлж эхлүүлэх
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Working Hours Status Bar */}
      <div className={`p-3 rounded-xl border ${workingHours?.is_enabled ? 'bg-blue-50 border-blue-200' : 'bg-slate-50 border-slate-200'}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-blue-600" />
            <div className="flex flex-col">
              <span className="text-sm font-medium text-blue-700">
                Ажлын цаг: {workingHours?.start_time_moscow || "04:00"} - {workingHours?.end_time_moscow || "23:00"} (Москва)
              </span>
              <span className="text-xs text-blue-600">
                {workingHours?.start_time_ub || "09:00"} - {workingHours?.end_time_ub || "04:00"} (УБ)
              </span>
            </div>
            {!workingHours?.is_enabled && (
              <span className="ml-2 px-2 py-0.5 bg-red-100 text-red-600 text-xs rounded-full">
                Түр хаалттай
              </span>
            )}
          </div>
          <button
            onClick={() => setShowWorkingHoursModal(true)}
            className="text-xs px-2 py-1 rounded-lg bg-blue-100 text-blue-700 hover:bg-blue-200 flex items-center gap-1"
            disabled={workingHoursLoading}
          >
            <Settings className="w-3 h-3" /> Тохируулах
          </button>
        </div>
      </div>

      {/* Sort & Filter Bar */}
      <div className="flex gap-2 text-sm">
        {/* Sort Dropdown */}
        <div className="relative">
          <button
            onClick={() => {
              setShowSortMenu(!showSortMenu);
              setShowFilterMenu(false);
            }}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-maroon-50 text-maroon-700 hover:bg-maroon-100"
          >
            <ArrowUpDown className="w-4 h-4" />
            Эрэмбэлэх
            {showSortMenu ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
          {showSortMenu && (
            <div className="absolute top-full left-0 mt-1 bg-white shadow-lg rounded-lg border z-10 min-w-[140px]">
              {[
                { value: "oldest", label: "Хуучин нь эхэндээ" },
                { value: "newest", label: "Шинэ нь эхэндээ" },
                { value: "amount_desc", label: "Дүн ↓" },
                { value: "amount_asc", label: "Дүн ↑" },
              ].map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => {
                    setSortBy(opt.value as SortOption);
                    setShowSortMenu(false);
                  }}
                  className={`block w-full text-left px-3 py-2 hover:bg-maroon-50 ${
                    sortBy === opt.value ? "bg-maroon-100 font-medium" : ""
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Filter Dropdown */}
        <div className="relative">
          <button
            onClick={() => {
              setShowFilterMenu(!showFilterMenu);
              setShowSortMenu(false);
            }}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-maroon-50 text-maroon-700 hover:bg-maroon-100"
          >
            <Filter className="w-4 h-4" />
            Шүүх
            {showFilterMenu ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
          {showFilterMenu && (
            <div className="absolute top-full left-0 mt-1 bg-white shadow-lg rounded-lg border z-10 min-w-[120px]">
              {[
                { value: "all", label: "Бүгд" },
                { value: "buy", label: "(RUB→MNT)" },
                { value: "sell", label: "(MNT→RUB)" },
              ].map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => {
                    setFilterBy(opt.value as FilterOption);
                    setShowFilterMenu(false);
                  }}
                  className={`block w-full text-left px-3 py-2 hover:bg-maroon-50 ${
                    filterBy === opt.value ? "bg-maroon-100 font-medium" : ""
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {error && <div className="text-red-600 text-sm">{error}</div>}

      {/* SECTION 1: Pending - Waiting for Approval */}
      <div className="border-2 border-amber-200 rounded-xl overflow-hidden">
        <div className="bg-amber-50 px-4 py-2 border-b border-amber-200">
          <h3 className="font-semibold text-amber-700 flex items-center gap-2">
            <Clock className="w-4 h-4" />
            Хүлээгдэж буй ({pendingItems.length})
          </h3>
          <p className="text-xs text-amber-600">Шалгаж баталгаажуулна уу</p>
        </div>
        <div className="flex flex-col gap-2 p-3 max-h-[250px] overflow-auto bg-amber-50/30">
          {pendingItems.map((item) => {
            const dirInfo = getDirectionLabel(item);
            const topup = getTopupDetails(item);
            const topupRequest = isPhoneTopup(item);
            return (
              <div
                key={item.invoice}
                onClick={() => setDetailModal(item)}
                className={`border rounded-xl bg-white p-3 cursor-pointer transition ${topupRequest ? "border-sky-200 hover:bg-sky-50/70" : "border-amber-200 hover:bg-amber-50"}`}
              >
                <div className="flex items-center gap-3">
                  <span className={`text-xs font-bold px-2 py-1 rounded ${dirInfo.color}`}>
                    {dirInfo.label}
                  </span>
                  {item.is_manual && <span className="rounded bg-[#2D62EC]/10 px-2 py-1 text-xs font-bold text-[#2D62EC]">Manual</span>}
                  <div className="flex-1">
                    <span className="font-semibold text-maroon-700">
                      {Number(item.amount).toLocaleString()} {item.currency_from}
                    </span>
                    <span className="text-slate-400 mx-1">→</span>
                    <span className="text-slate-600">{item.currency_to}</span>
                  </div>
                  <div className="flex items-center gap-1 text-xs text-slate-500">
                    <Clock className="w-3 h-3" />
                    {getTimeAgo(item.timestamp, relativeNowMs)}
                  </div>
                  {item.bill_url && (
                    <span className="p-1.5 rounded-lg bg-blue-50 text-blue-600">
                      <Image className="w-4 h-4" />
                    </span>
                  )}
                </div>
                {topupRequest && (
                  <div className="mt-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800">
                    <div>📱 {topup.phone}</div>
                    <div>📶 {topup.telecom}</div>
                  </div>
                )}
                <div className="mt-1 text-xs text-slate-400 font-mono truncate">#{item.invoice}</div>
              </div>
            );
          })}
          {pendingItems.length === 0 && (
            <div className="text-sm text-slate-500 text-center py-4">Хүлээгдэж буй гүйлгээ байхгүй байна</div>
          )}
        </div>
      </div>

      {/* SECTION 2: Pre-approved - Ready for Transfer */}
      <div className="border-2 border-green-200 rounded-xl overflow-hidden">
        <div className="bg-green-50 px-4 py-2 border-b border-green-200">
          <h3 className="font-semibold text-green-700 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4" />
            Урьдчилан баталгаажсан ({approvedItems.length})
          </h3>
          <p className="text-xs text-green-600">Гүйлгээ хийж, баримт оруулан баталгаажуулна уу</p>
        </div>
        <div className="flex flex-col gap-2 p-3 max-h-[250px] overflow-auto bg-green-50/30">
          {approvedItems.map((item) => {
            const dirInfo = getDirectionLabel(item);
            const isBuy = item.direction === "buy" || item.currency_from.toUpperCase() === "RUB";
            const transferAmt = isBuy 
              ? (Number(item.amount) * Number(item.rate)).toFixed(0)
              : (Number(item.amount) / Number(item.rate)).toFixed(2);
            const transferCur = isBuy ? "₮" : "₽";
            const topup = getTopupDetails(item);
            const topupRequest = isPhoneTopup(item);
            
            return (
              <div
                key={item.invoice}
                onClick={() => item.automation_managed ? setDetailModal(item) : openConfirmModal(item)}
                className={`border rounded-xl bg-white p-3 cursor-pointer transition ${topupRequest ? "border-sky-200 hover:bg-sky-50/70" : "border-green-200 hover:bg-green-50"}`}
              >
                <div className="flex items-center gap-3">
                  <span className={`text-xs font-bold px-2 py-1 rounded ${dirInfo.color}`}>
                    {dirInfo.label}
                  </span>
                  {item.is_manual && <span className="rounded bg-[#2D62EC]/10 px-2 py-1 text-xs font-bold text-[#2D62EC]">Manual</span>}
                  <div className="flex-1">
                    <span className="font-semibold text-maroon-700">
                      {Number(item.amount).toLocaleString()} {item.currency_from}
                    </span>
                    <span className="text-slate-400 mx-1">→</span>
                    <span className="text-slate-600">{item.currency_to}</span>
                  </div>
                  <div className="flex items-center gap-1 text-xs text-slate-500">
                    <Clock className="w-3 h-3" />
                    {getTimeAgo(item.timestamp, relativeNowMs)}
                  </div>
                </div>
                {topupRequest && (
                  <div className="mt-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800">
                    <div>📱 {topup.phone}</div>
                    <div>📶 {topup.telecom}</div>
                  </div>
                )}
                <div className="mt-2 p-2 bg-green-100 rounded-lg flex items-center justify-between">
                  <span className="text-sm text-green-700">{topupRequest ? "Цэнэглэх дүн:" : "Шилжүүлэх дүн:"}</span>
                  <span className="font-bold text-green-800">{Number(transferAmt).toLocaleString()} {transferCur}</span>
                </div>
                <div className="mt-1 text-xs text-slate-400 font-mono truncate">#{item.invoice}</div>
                {item.automation_managed ? (
                  <div className="mt-2 space-y-1">
                    <div className="rounded-lg bg-blue-50 border border-blue-200 px-3 py-2 text-xs font-medium text-blue-700">
                      {getDispatchLabel(item.group_dispatch_status)}
                    </div>
                    {item.group_dispatch_error && (
                      <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
                        {item.group_dispatch_error}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="mt-2 flex justify-end">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRevertToPending(item.invoice);
                      }}
                      className="flex items-center gap-1 px-2 py-1 text-xs bg-amber-100 hover:bg-amber-200 text-amber-700 rounded-lg transition font-medium border border-amber-200"
                      title="Хүлээгдэж буй төлөвт буцаах"
                    >
                      <RefreshCw className="w-3 h-3" />
                      Буцаах
                    </button>
                    {!topupRequest && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSetWaitingEdit(item.invoice);
                        }}
                        className="ml-2 flex items-center gap-1 px-2 py-1 text-xs bg-red-100 hover:bg-red-200 text-red-700 rounded-lg transition font-medium border border-red-200"
                        title="Хэрэглэгчээс засвар авч дахин илгээх"
                      >
                        <Pause className="w-3 h-3" />
                        Засвар хүлээх
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {approvedItems.length === 0 && (
            <div className="text-sm text-slate-500 text-center py-4">Баталгаажсан гүйлгээ байхгүй байна</div>
          )}
        </div>
      </div>

      {/* Detail Modal - Full transaction details popup */}
      {detailModal && (() => {
        const item = detailModal;
        const topupRequest = isPhoneTopup(item);
        const topup = getTopupDetails(item);
        const isBuy = item.direction === "buy" || item.currency_from.toUpperCase() === "RUB";
        const parsed = parseBankDetails(item.bank_details || "", isBuy);
        const transferAmount = isBuy 
          ? (Number(item.amount) * Number(item.rate)).toFixed(0)
          : (Number(item.amount) / Number(item.rate)).toFixed(2);
        const transferCurrency = isBuy ? "₮" : "₽";
        const dirInfo = getDirectionLabel(item);
        
        return (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl max-w-lg w-full max-h-[90vh] overflow-auto">
              {/* Header */}
              <div className="sticky top-0 bg-white border-b border-maroon-100 p-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-bold px-2 py-1 rounded ${dirInfo.color}`}>
                    {dirInfo.label}
                  </span>
                  <span className="font-semibold text-maroon-700">
                    {Number(item.amount).toLocaleString()} {item.currency_from} → {item.currency_to}
                  </span>
                </div>
                <button
                  onClick={() => setDetailModal(null)}
                  className="p-2 hover:bg-slate-100 rounded-full"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              
              <div className="p-4 space-y-4">
                {/* Invoice & User Info */}
                <div className="flex justify-between text-xs text-slate-500">
                  <span>Гүйлгээний дугаар: <span className="font-mono">{item.invoice}</span></span>
                  <span>Хэрэглэгчийн телеграм ID: {item.user_id}</span>
                </div>

                {/* User Contact Panel */}
                <div className="p-3 bg-blue-50 rounded-lg border border-blue-200">
                  <div className="text-xs text-slate-500 mb-2">👤 Хэрэглэгчтэй холбогдох:</div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => handleCopy(String(item.user_id), "user-id")}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 transition"
                    >
                      {copiedField === "user-id" ? (
                        <CheckCircle2 className="w-4 h-4" />
                      ) : (
                        <Copy className="w-4 h-4" />
                      )}
                      ID хуулах: {item.user_id}
                    </button>
                  </div>

                  {/* User Label */}
                  <div className="mt-2 pt-2 border-t border-blue-200">
                    {(() => {
                      const style = getLabelStyle(item.admin_label);
                      const hasLabel = !!item.admin_label;
                      return (
                        <div>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => {
                                if (hasLabel && expandedLabel !== item.user_id) {
                                  setExpandedLabel(item.user_id);
                                } else if (expandedLabel === item.user_id) {
                                  setExpandedLabel(null);
                                } else {
                                  setEditLabel(item.admin_label || "");
                                  setEditLabelNote(item.admin_label_note || "");
                                  setEditLabelCustom("");
                                  setLabelModal({ userId: item.user_id, currentLabel: item.admin_label, currentNote: item.admin_label_note });
                                }
                              }}
                              className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md border transition ${
                                hasLabel
                                  ? `${style.bg} ${style.color} ${style.border}`
                                  : "bg-slate-50 text-slate-500 border-slate-200 border-dashed hover:bg-slate-100"
                              }`}
                            >
                              🏷️ {hasLabel ? item.admin_label : "Тэмдэглэл"}
                            </button>
                            {hasLabel && (
                              <button
                                onClick={() => {
                                  setEditLabel(item.admin_label || "");
                                  setEditLabelNote(item.admin_label_note || "");
                                  setEditLabelCustom("");
                                  setLabelModal({ userId: item.user_id, currentLabel: item.admin_label, currentNote: item.admin_label_note });
                                }}
                                className="text-xs text-blue-600 hover:underline"
                              >
                                засах
                              </button>
                            )}
                          </div>
                          {expandedLabel === item.user_id && hasLabel && item.admin_label_note && (
                            <div className={`mt-1.5 px-2.5 py-1.5 rounded text-xs ${style.bg} ${style.color} border ${style.border}`}>
                              {item.admin_label_note}
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>

                  <div className="mt-2 pt-2 border-t border-blue-200 text-xs text-slate-500">
                    💡 Telegram бот дотор ID-г хайж хэрэглэгч рүү мессеж илгээх боломжтой
                  </div>
                </div>

                {/* Invoice ID - Copyable */}
                <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-xs text-slate-500">📋 Гүйлгээний дугаар (Invoice)</div>
                      <span className="font-mono font-medium text-maroon-700">{item.invoice}</span>
                    </div>
                    <button
                      onClick={() => handleCopy(item.invoice, "detail-invoice")}
                      className="p-2 rounded-lg hover:bg-slate-200 bg-white border border-slate-200"
                      title="Invoice хуулах"
                    >
                      {copiedField === "detail-invoice" ? (
                        <CheckCircle2 className="w-4 h-4 text-green-500" />
                      ) : (
                        <Copy className="w-4 h-4 text-maroon-600" />
                      )}
                    </button>
                  </div>
                </div>

                {/* Timestamps */}
                <div className="text-xs text-slate-500 space-y-1 p-2 bg-slate-50 rounded-lg">
                  <div>УБ: {formatToTimezone(item.timestamp, "Asia/Ulaanbaatar")}</div>
                  <div>МСК: {formatToTimezone(item.timestamp, "Europe/Moscow")}</div>
                  <div className="text-slate-400">{getTimeAgo(item.timestamp, relativeNowMs)}</div>
                </div>

                {/* User's Receipt Photos - Support multiple */}
                {item.bill_url && parseBillUrls(item.bill_url).length > 0 && (
                  <div>
                    <div className="text-xs text-slate-500 mb-2">📸 Хэрэглэгчийн баримт ({parseBillUrls(item.bill_url).length}):</div>
                    <div className="flex flex-wrap gap-2">
                      {parseBillUrls(item.bill_url).map((url, idx) => (
                        <div 
                          key={idx}
                          className="relative rounded-lg overflow-hidden cursor-pointer border border-maroon-200"
                          onClick={() => setPhotoModal(url)}
                        >
                          <img 
                            src={url} 
                            alt={`Receipt ${idx + 1}`} 
                            className="w-24 h-24 object-cover bg-slate-50"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Transfer Amount - What admin needs to send */}
                <div className="p-3 bg-gradient-to-r from-maroon-50 to-sky-50 rounded-lg border border-maroon-200">
                  <div className="text-xs text-slate-500 mb-1">{topupRequest ? "Цэнэглэх дүн:" : "Шилжүүлэх дүн:"}</div>
                  <div className="flex items-center justify-between">
                    <span className="text-xl font-bold text-maroon-700">
                      {Number(transferAmount).toLocaleString()} {transferCurrency}
                    </span>
                    <button
                      onClick={() => handleCopy(transferAmount, "detail-amount")}
                      className="p-1.5 rounded-lg hover:bg-maroon-100 bg-white/50"
                      title="Дүнг хуулбарлах"
                    >
                      {copiedField === "detail-amount" ? (
                        <CheckCircle2 className="w-4 h-4 text-green-500" />
                      ) : (
                        <Copy className="w-4 h-4 text-maroon-600" />
                      )}
                    </button>
                  </div>
                  <div className="text-xs text-slate-500 mt-1">
                    Ханш: {Number(item.rate).toFixed(2)} | Хэрэглэгчийн илгээсэн дүн: {Number(item.amount).toLocaleString()} {item.currency_from}
                  </div>
                </div>

                {topupRequest ? (
                  <div className="p-3 bg-white rounded-lg border border-sky-200">
                    <div className="text-xs text-slate-500 mb-2">Утас цэнэглэх мэдээлэл:</div>
                    <div className="flex items-center justify-between py-2 border-b border-slate-100">
                      <div className="text-xs text-slate-500">Утасны дугаар</div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-medium text-sky-800">{topup.phone}</span>
                        <button onClick={() => handleCopy(topup.phone, "detail-topup-phone")} className="p-1.5 rounded hover:bg-sky-100">
                          {copiedField === "detail-topup-phone" ? (
                            <CheckCircle2 className="w-4 h-4 text-green-500" />
                          ) : (
                            <Copy className="w-4 h-4 text-sky-600" />
                          )}
                        </button>
                      </div>
                    </div>
                    <div className="flex items-center justify-between py-2">
                      <div className="text-xs text-slate-500">Оператор</div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sky-800">{topup.telecom}</span>
                        <button onClick={() => handleCopy(topup.telecom, "detail-topup-telecom")} className="p-1.5 rounded hover:bg-sky-100">
                          {copiedField === "detail-topup-telecom" ? (
                            <CheckCircle2 className="w-4 h-4 text-green-500" />
                          ) : (
                            <Copy className="w-4 h-4 text-sky-600" />
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                /* Bank Details */
                item.bank_details && (
                  <div className="p-3 bg-white rounded-lg border border-maroon-200">
                    <div className="text-xs text-slate-500 mb-2">Хэрэглэгчийн банкны мэдээлэл:</div>
                    
                    {/* Bank Mismatch Warning */}
                    {item.bank_mismatch && (
                      <div className="mb-3 p-2 bg-amber-50 border border-amber-300 rounded-lg">
                        <div className="flex items-center gap-2 text-amber-700 font-medium text-sm">
                          <AlertCircle className="w-4 h-4 flex-shrink-0" />
                          <span>⚠️ Хэрэглэгч өөр данс ашигласан</span>
                        </div>

                      </div>
                    )}
                    
                    {parsed.bank && (
                      <div className="flex items-center justify-between py-2 border-b border-slate-100">
                        <div className="text-xs text-slate-500">Банк</div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-maroon-700">{parsed.bank}</span>
                          <button
                            onClick={() => handleCopy(parsed.bank!, "detail-bank")}
                            className="p-1.5 rounded hover:bg-maroon-100"
                          >
                            {copiedField === "detail-bank" ? (
                              <CheckCircle2 className="w-4 h-4 text-green-500" />
                            ) : (
                              <Copy className="w-4 h-4 text-maroon-500" />
                            )}
                          </button>
                        </div>
                      </div>
                    )}

                    {parsed.account && (
                      <div className="flex items-center justify-between py-2 border-b border-slate-100">
                        <div className="text-xs text-slate-500">Данс</div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-medium text-maroon-700">{parsed.account}</span>
                          <button
                            onClick={() => handleCopy(parsed.account!, "detail-account")}
                            className="p-1.5 rounded hover:bg-maroon-100"
                          >
                            {copiedField === "detail-account" ? (
                              <CheckCircle2 className="w-4 h-4 text-green-500" />
                            ) : (
                              <Copy className="w-4 h-4 text-maroon-500" />
                            )}
                          </button>
                        </div>
                      </div>
                    )}

                    {parsed.phone && (
                      <div className="flex items-center justify-between py-2 border-b border-slate-100">
                        <div className="text-xs text-slate-500">Утасны дугаар</div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-medium text-maroon-700">{parsed.phone}</span>
                          <button
                            onClick={() => handleCopy(parsed.phone!, "detail-phone")}
                            className="p-1.5 rounded hover:bg-maroon-100"
                          >
                            {copiedField === "detail-phone" ? (
                              <CheckCircle2 className="w-4 h-4 text-green-500" />
                            ) : (
                              <Copy className="w-4 h-4 text-maroon-500" />
                            )}
                          </button>
                        </div>
                      </div>
                    )}

                    {parsed.card && (
                      <div className="flex items-center justify-between py-2 border-b border-slate-100">
                        <div className="text-xs text-slate-500">Картын дугаар</div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-medium text-maroon-700">{parsed.card}</span>
                          <button
                            onClick={() => handleCopy(parsed.card!, "detail-card")}
                            className="p-1.5 rounded hover:bg-maroon-100"
                          >
                            {copiedField === "detail-card" ? (
                              <CheckCircle2 className="w-4 h-4 text-green-500" />
                            ) : (
                              <Copy className="w-4 h-4 text-maroon-500" />
                            )}
                          </button>
                        </div>
                      </div>
                    )}

                    {parsed.owner && (
                      <div className="flex items-center justify-between py-2">
                        <div className="text-xs text-slate-500">Данс эзэмшэгчийн нэр</div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-maroon-700">{parsed.owner}</span>
                          <button
                            onClick={() => handleCopy(parsed.owner!, "detail-owner")}
                            className="p-1.5 rounded hover:bg-maroon-100"
                          >
                            {copiedField === "detail-owner" ? (
                              <CheckCircle2 className="w-4 h-4 text-green-500" />
                            ) : (
                              <Copy className="w-4 h-4 text-maroon-500" />
                            )}
                          </button>
                        </div>
                      </div>
                    )}

                    {!parsed.bank && !parsed.phone && !parsed.card && !parsed.owner && !parsed.account && (
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-maroon-700 whitespace-pre-line">{item.bank_details}</span>
                        <button
                          onClick={() => handleCopy(item.bank_details!, "detail-raw")}
                          className="p-1.5 rounded hover:bg-maroon-100"
                        >
                          {copiedField === "detail-raw" ? (
                            <CheckCircle2 className="w-4 h-4 text-green-500" />
                          ) : (
                            <Copy className="w-4 h-4 text-maroon-600" />
                          )}
                        </button>
                      </div>
                    )}
                  </div>
                ))}
                {item.admin_bank_name && (
                  <div className="p-2.5 bg-blue-50/50 rounded-lg border border-blue-100 flex items-center justify-between">
                    <span className="text-xs text-blue-600/70 uppercase tracking-wider font-semibold">Хүлээн авсан данс</span>
                    <span className="text-sm font-semibold text-blue-700 bg-blue-100/60 px-2 py-0.5 rounded">{item.admin_bank_name}</span>
                  </div>
                )}

                {/* Actions for Pending - Pre-approve or Reject */}
                {item.status === "pending" && (
                  <div className={`grid grid-cols-1 ${topupRequest ? "sm:grid-cols-2" : "sm:grid-cols-4"} gap-2`}>
                    <button
                      onClick={async () => {
                        try {
                          await adminAction({ 
                            invoice: item.invoice, 
                            status: "approved",
                            processing_mode: "traditional",
                          });
                          setDetailModal(null);
                          await load();
                          } catch (err) {
                            console.error("Traditional approval error:", err);
                            setError(getAdminActionError(err, "Гүйлгээг батлахад алдаа гарлаа"));
                        }
                      }}
                      className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-green-600 text-white py-3 font-semibold hover:bg-green-700"
                    >
                      <ShieldCheck className="w-5 h-5" /> Батлах
                    </button>
                    {item.service_kind === "exchange" && item.currency_from.toUpperCase() === "MNT" && item.currency_to.toUpperCase() === "RUB" && (
                      <button
                        onClick={async () => {
                          try {
                            await adminAction({
                              invoice: item.invoice,
                              status: "approved",
                              processing_mode: "group",
                            });
                            setDetailModal(null);
                            await load();
                          } catch (err) {
                            console.error("Group dispatch error:", err);
                            setError(getAdminActionError(err, "Гүйлгээг Telegram групп рүү илгээхэд алдаа гарлаа"));
                          }
                        }}
                        className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 text-white py-3 font-semibold hover:bg-blue-700"
                      >
                        <Upload className="w-5 h-5" /> Групп рүү илгээх
                      </button>
                    )}
                    {!topupRequest && !item.automation_managed && (
                      <button
                        onClick={() => handleSetWaitingEdit(item.invoice)}
                        className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-amber-100 text-amber-700 py-3 font-semibold hover:bg-amber-200"
                      >
                        <Pause className="w-5 h-5" /> Засвар шаардах
                      </button>
                    )}
                    <button
                      onClick={() => {
                        setRejectModal(item.invoice);
                        setDetailModal(null);
                      }}
                      className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-red-100 text-red-700 py-3 font-semibold hover:bg-red-200"
                    >
                      <XCircle className="w-5 h-5" /> Татгалзах
                    </button>
                  </div>
                )}

                {/* Actions for Approved - Open confirm modal to finalize */}
                {item.status === "approved" && (
                  item.automation_managed ? (
                    <div className="space-y-2">
                      <div className="rounded-lg bg-blue-50 border border-blue-200 px-3 py-3 text-sm font-medium text-blue-700">
                        {getDispatchLabel(item.group_dispatch_status)}
                      </div>
                      {item.group_dispatch_error && (
                        <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-3 text-sm text-red-700">
                          {item.group_dispatch_error}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className={`grid grid-cols-1 ${topupRequest ? "sm:grid-cols-2" : "sm:grid-cols-3"} gap-2`}>
                      <button
                        onClick={() => openConfirmModal(item)}
                        className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-maroon-600 text-white py-3 font-semibold hover:bg-maroon-700"
                      >
                        <Upload className="w-5 h-5" /> Гүйлгээ дуусгах
                      </button>
                      {!topupRequest && (
                        <button
                          onClick={() => handleSetWaitingEdit(item.invoice)}
                          className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-amber-100 text-amber-700 py-3 font-semibold hover:bg-amber-200"
                        >
                          <Pause className="w-5 h-5" /> Засвар шаардах
                        </button>
                      )}
                      <button
                        onClick={() => {
                          setRejectModal(item.invoice);
                          setDetailModal(null);
                        }}
                        className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-red-100 text-red-700 py-3 font-semibold hover:bg-red-200"
                      >
                        <XCircle className="w-5 h-5" /> Татгалзах
                      </button>
                    </div>
                  )
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Photo Modal */}
      {photoModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="relative max-w-2xl max-h-[90vh] bg-white rounded-xl overflow-hidden">
            <button
              onClick={() => setPhotoModal(null)}
              className="absolute top-2 right-2 p-2 bg-white/80 rounded-full hover:bg-white"
            >
              <X className="w-5 h-5" />
            </button>
            <img src={photoModal} alt="Receipt" className="max-w-full max-h-[85vh] object-contain" />
          </div>
        </div>
      )}

      {/* Reject Modal */}
      {rejectModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-5 max-w-md w-full">
            <div className="font-semibold text-maroon-700 mb-3">Гүйлгээг татгалзах</div>
            <div className="text-sm text-slate-600 mb-2">
              Хэрэглэгчид илгээх шалтгаан/тайлбарыг оруулна уу (Telegram чатаар илгээгдэнэ):
            </div>
            <textarea
              value={rejectComment}
              onChange={(e) => setRejectComment(e.target.value)}
              className="w-full border border-maroon-200 rounded-lg p-3 text-sm mb-3"
              rows={3}
              placeholder="Татгалзсан шалтгаан..."
            />

            {/* Photo upload for rejection proof */}
            <div className="mb-3">
              <div className="text-sm text-slate-600 mb-2">Баримт зураг оруулах (заавал биш):</div>
              {rejectBillUrls.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-2">
                  {rejectBillUrls.map((url, idx) => (
                    <div key={idx} className="relative">
                      <img
                        src={url}
                        alt={`Rejection proof ${idx + 1}`}
                        className="w-20 h-20 object-cover rounded-lg border border-red-200 cursor-pointer"
                        onClick={() => setPhotoModal(url)}
                      />
                      <button
                        onClick={() => setRejectBillUrls(prev => prev.filter((_, i) => i !== idx))}
                        className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 text-white rounded-full text-xs flex items-center justify-center hover:bg-red-600"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <label className="flex flex-col items-center justify-center border-2 border-dashed border-red-200 rounded-xl py-3 cursor-pointer bg-white/60 hover:bg-red-50">
                <Upload className="w-4 h-4 text-red-500" />
                <span className="text-xs text-slate-500 mt-1">
                  {rejectUploading ? "Хуулж байна..." : rejectBillUrls.length > 0 ? "Нэмж зураг оруулах" : "Дарж оруулна уу"}
                </span>
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    const files = e.target.files;
                    if (files && files.length > 0) handleRejectBillUpload(files);
                  }}
                  disabled={rejectUploading}
                />
              </label>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => {
                  setRejectModal(null);
                  setRejectComment("");
                  setRejectBillUrls([]);
                }}
                className="flex-1 py-2 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200"
              >
                Цуцлах
              </button>
              <button
                onClick={handleReject}
                disabled={rejectUploading}
                className="flex-1 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
              >
                Татгалзах
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Label Edit Modal */}
      {labelModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-5 max-w-sm w-full">
            <div className="font-semibold text-maroon-700 mb-3">🏷️ Хэрэглэгчийн тэмдэглэл</div>
            <div className="text-xs text-slate-500 mb-3">ID: {labelModal.userId}</div>

            {/* Label selection */}
            <div className="text-sm text-slate-600 mb-2">Тэмдэглэл сонгох:</div>
            <div className="flex flex-wrap gap-2 mb-3">
              {LABEL_PRESETS.map((preset) => (
                <button
                  key={preset.name}
                  onClick={() => { setEditLabel(preset.name); setEditLabelCustom(""); }}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md border transition ${
                    editLabel === preset.name
                      ? `${preset.bg} ${preset.color} ${preset.border} ring-2 ring-offset-1 ring-current`
                      : `bg-white ${preset.color} ${preset.border} hover:${preset.bg}`
                  }`}
                >
                  {preset.name}
                </button>
              ))}
              <button
                onClick={() => setEditLabel("__custom__")}
                className={`px-3 py-1.5 text-xs font-medium rounded-md border transition ${
                  editLabel === "__custom__"
                    ? "bg-yellow-100 text-yellow-700 border-yellow-300 ring-2 ring-offset-1 ring-yellow-400"
                    : "bg-white text-yellow-700 border-yellow-300 hover:bg-yellow-50"
                }`}
              >
                ✏️ Бусад
              </button>
            </div>

            {editLabel === "__custom__" && (
              <div className="mb-3">
                <input
                  type="text"
                  value={editLabelCustom}
                  onChange={(e) => {
                    if (e.target.value.length <= 30) setEditLabelCustom(e.target.value);
                  }}
                  className="w-full border border-yellow-300 rounded-lg p-2 text-sm"
                  placeholder="Тэмдэглэлийн нэр..."
                />
                <div className="text-xs text-slate-400 text-right mt-0.5">{editLabelCustom.length}/30</div>
              </div>
            )}

            {/* Note */}
            <div className="text-sm text-slate-600 mb-2">Нэмэлт тайлбар:</div>
            <textarea
              value={editLabelNote}
              onChange={(e) => setEditLabelNote(e.target.value)}
              className="w-full border border-slate-200 rounded-lg p-2 text-sm mb-3"
              rows={3}
              placeholder="Энд тайлбар бичнэ үү..."
            />

            <div className="flex gap-2">
              <button
                onClick={() => setLabelModal(null)}
                className="flex-1 py-2 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 text-sm"
              >
                Цуцлах
              </button>
              {labelModal.currentLabel && (
                <button
                  onClick={() => {
                    setEditLabel("");
                    setEditLabelNote("");
                    setEditLabelCustom("");
                  }}
                  className="py-2 px-3 rounded-lg bg-red-50 text-red-600 hover:bg-red-100 text-sm"
                >
                  Устгах
                </button>
              )}
              <button
                onClick={handleSaveLabel}
                disabled={labelSaving || (editLabel === "__custom__" && !editLabelCustom.trim())}
                className="flex-1 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 text-sm"
              >
                {labelSaving ? "Хадгалж байна..." : "Хадгалах"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Transaction Modal */}
      {confirmModal && (() => {
        const topupRequest = isPhoneTopup(confirmModal);
        const topup = getTopupDetails(confirmModal);
        const isBuy = confirmModal.direction === "buy" || confirmModal.currency_from.toUpperCase() === "RUB";
        const parsed = parseBankDetails(confirmModal.bank_details || "", isBuy);
        const transferAmount = isBuy 
          ? (Number(confirmModal.amount) * Number(confirmModal.rate)).toFixed(0)
          : (Number(confirmModal.amount) / Number(confirmModal.rate)).toFixed(2);
        const transferCurrency = isBuy ? "₮" : "₽";
        
        return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-5 max-w-md w-full max-h-[90vh] overflow-auto">
            <div className="font-semibold text-maroon-700 mb-3">Гүйлгээг дуусгах</div>

            {/* Invoice ID - Copyable */}
            <div className="mb-4 p-3 bg-slate-50 rounded-lg border border-slate-200">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs text-slate-500">📋 Invoice</div>
                  <span className="font-mono font-medium text-maroon-700">{confirmModal.invoice}</span>
                </div>
                <button
                  onClick={() => handleCopy(confirmModal.invoice, "confirm-invoice")}
                  className="p-2 rounded-lg hover:bg-slate-200 bg-white border border-slate-200"
                  title="Invoice хуулах"
                >
                  {copiedField === "confirm-invoice" ? (
                    <CheckCircle2 className="w-4 h-4 text-green-500" />
                  ) : (
                    <Copy className="w-4 h-4 text-maroon-600" />
                  )}
                </button>
              </div>
            </div>

            {/* Transfer Amount */}
            <div className="mb-4 p-3 bg-gradient-to-r from-maroon-50 to-sky-50 rounded-lg border border-maroon-200">
              <div className="text-xs text-slate-500 mb-1">{topupRequest ? "Цэнэглэх дүн:" : "Шилжүүлэх дүн:"}</div>
              <div className="flex items-center justify-between">
                <span className="text-xl font-bold text-maroon-700">
                  {Number(transferAmount).toLocaleString()} {transferCurrency}
                </span>
                <button
                  onClick={() => handleCopy(transferAmount, "modal-amount")}
                  className="p-1.5 rounded-lg hover:bg-maroon-100 bg-white/50"
                  title="Дүнг хуулбарлах"
                >
                  {copiedField === "modal-amount" ? (
                    <CheckCircle2 className="w-4 h-4 text-green-500" />
                  ) : (
                    <Copy className="w-4 h-4 text-maroon-600" />
                  )}
                </button>
              </div>
            </div>

            {topupRequest ? (
              <div className="mb-4 p-3 bg-white rounded-lg border border-sky-200">
                <div className="text-xs text-slate-500 mb-2">Утас цэнэглэх мэдээлэл:</div>
                <div className="flex items-center justify-between py-1.5 border-b border-slate-100">
                  <div className="text-xs text-slate-500">Утасны дугаар</div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-medium text-sky-800">{topup.phone}</span>
                    <button onClick={() => handleCopy(topup.phone, "modal-topup-phone")} className="p-1 rounded hover:bg-sky-100">
                      {copiedField === "modal-topup-phone" ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
                      ) : (
                        <Copy className="w-3.5 h-3.5 text-sky-600" />
                      )}
                    </button>
                  </div>
                </div>
                <div className="flex items-center justify-between py-1.5">
                  <div className="text-xs text-slate-500">Оператор</div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sky-800">{topup.telecom}</span>
                    <button onClick={() => handleCopy(topup.telecom, "modal-topup-telecom")} className="p-1 rounded hover:bg-sky-100">
                      {copiedField === "modal-topup-telecom" ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
                      ) : (
                        <Copy className="w-3.5 h-3.5 text-sky-600" />
                      )}
                    </button>
                  </div>
                </div>
              </div>
            ) : (
            /* User's Bank Info - Structured */
            <div className="mb-4 p-3 bg-white rounded-lg border border-maroon-200">
              <div className="text-xs text-slate-500 mb-2">Хэрэглэгчийн данс руу шилжүүлэх дүн:</div>
              
              {/* Bank Mismatch Warning */}
              {confirmModal.bank_mismatch && (
                <div className="mb-3 p-2 bg-amber-50 border border-amber-300 rounded-lg">
                  <div className="flex items-center gap-2 text-amber-700 font-medium text-sm">
                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                    <span>⚠️ Өөр данс ашиглав!</span>
                  </div>
                  {confirmModal.saved_bank_info && (
                    <div className="mt-1 text-xs text-amber-600">
                      Хадгалсан данс: {confirmModal.saved_bank_info}
                    </div>
                  )}
                </div>
              )}

              {/* Bank Name */}
              {parsed.bank && (
                <div className="flex items-center justify-between py-1.5 border-b border-slate-100">
                  <div className="text-xs text-slate-500">Банк</div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-maroon-700">{parsed.bank}</span>
                    <button
                      onClick={() => handleCopy(parsed.bank!, "modal-bank")}
                      className="p-1 rounded hover:bg-maroon-100"
                    >
                      {copiedField === "modal-bank" ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
                      ) : (
                        <Copy className="w-3.5 h-3.5 text-maroon-500" />
                      )}
                    </button>
                  </div>
                </div>
              )}

              {/* Account (for MNT) */}
              {parsed.account && (
                <div className="flex items-center justify-between py-1.5 border-b border-slate-100">
                  <div className="text-xs text-slate-500">Дансны дугаар</div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-medium text-maroon-700">{parsed.account}</span>
                    <button
                      onClick={() => handleCopy(parsed.account!, "modal-account")}
                      className="p-1 rounded hover:bg-maroon-100"
                    >
                      {copiedField === "modal-account" ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
                      ) : (
                        <Copy className="w-3.5 h-3.5 text-maroon-500" />
                      )}
                    </button>
                  </div>
                </div>
              )}

              {/* Phone */}
              {parsed.phone && (
                <div className="flex items-center justify-between py-1.5 border-b border-slate-100">
                  <div className="text-xs text-slate-500">Утасны дугаар</div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-medium text-maroon-700">{parsed.phone}</span>
                    <button
                      onClick={() => handleCopy(parsed.phone!, "modal-phone")}
                      className="p-1 rounded hover:bg-maroon-100"
                    >
                      {copiedField === "modal-phone" ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
                      ) : (
                        <Copy className="w-3.5 h-3.5 text-maroon-500" />
                      )}
                    </button>
                  </div>
                </div>
              )}

              {/* Card Number */}
              {parsed.card && (
                <div className="flex items-center justify-between py-1.5 border-b border-slate-100">
                  <div className="text-xs text-slate-500">Картын дугаар</div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-medium text-maroon-700">{parsed.card}</span>
                    <button
                      onClick={() => handleCopy(parsed.card!, "modal-card")}
                      className="p-1 rounded hover:bg-maroon-100"
                    >
                      {copiedField === "modal-card" ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
                      ) : (
                        <Copy className="w-3.5 h-3.5 text-maroon-500" />
                      )}
                    </button>
                  </div>
                </div>
              )}

              {/* Owner Name */}
              {parsed.owner && (
                <div className="flex items-center justify-between py-1.5">
                  <div className="text-xs text-slate-500">Данс эзэмшигчийн нэр</div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-maroon-700">{parsed.owner}</span>
                    <button
                      onClick={() => handleCopy(parsed.owner!, "modal-owner")}
                      className="p-1 rounded hover:bg-maroon-100"
                    >
                      {copiedField === "modal-owner" ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
                      ) : (
                        <Copy className="w-3.5 h-3.5 text-maroon-500" />
                      )}
                    </button>
                  </div>
                </div>
              )}

              {/* Fallback */}
              {!parsed.bank && !parsed.phone && !parsed.card && !parsed.owner && !parsed.account && confirmModal.bank_details && (
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-maroon-700 whitespace-pre-line">{confirmModal.bank_details}</span>
                  <button
                    onClick={() => handleCopy(confirmModal.bank_details || "", "modal-raw")}
                    className="p-1 rounded hover:bg-maroon-100"
                  >
                    {copiedField === "modal-raw" ? (
                      <CheckCircle2 className="w-4 h-4 text-green-500" />
                    ) : (
                      <Copy className="w-4 h-4 text-maroon-600" />
                    )}
                  </button>
                </div>
              )}
            </div>)}

            {/* Upload Admin's Bills - Multiple photos support */}
            <div className="mb-4">
              <div className="text-sm text-slate-600 mb-2">Админы гүйлгээний баримтыг оруулна уу (заавал биш, олон зураг):</div>
              
              {/* Show uploaded photos */}
              {adminBillUrls.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-2">
                  {adminBillUrls.map((url, idx) => (
                    <div key={idx} className="relative">
                      <img 
                        src={url} 
                        alt={`Admin receipt ${idx + 1}`} 
                        className="w-20 h-20 object-cover rounded-lg border border-maroon-200 cursor-pointer"
                        onClick={() => setPhotoModal(url)}
                      />
                      <button
                        onClick={() => removeAdminBillUrl(idx)}
                        className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 text-white rounded-full text-xs flex items-center justify-center hover:bg-red-600"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
              
              <label className="flex flex-col items-center justify-center border-2 border-dashed border-maroon-200 rounded-xl py-4 cursor-pointer bg-white/60 hover:bg-maroon-50">
                <Upload className="w-5 h-5 text-maroon-600" />
                <span className="text-xs text-slate-500 mt-1">
                  {uploading ? "Хуулж байна..." : adminBillUrls.length > 0 ? "Нэмж зураг оруулах" : "Дарж оруулна уу"}
                </span>
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    const files = e.target.files;
                    if (files && files.length > 0) handleAdminBillUpload(files);
                  }}
                  disabled={uploading}
                />
              </label>
            </div>

            <div className="mb-4">
              <div className="text-sm text-slate-600 mb-2">Гүйлгээг дуусгасан админ:</div>
              <select
                value={confirmCompletedByAdminId ?? ""}
                onChange={(e) => setConfirmCompletedByAdminId(e.target.value ? parseInt(e.target.value) : null)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-1 focus:ring-maroon-300"
              >
                <option value="">Админ сонгоно уу</option>
                {adminUsers.map((admin) => (
                  <option key={admin.id} value={admin.id}>
                    {admin.name}{admin.id === currentShift?.current_admin_id ? " (Ээлж дээр)" : ""}
                  </option>
                ))}
              </select>
              <div className="mt-1 text-xs text-slate-500">
                {currentShift?.current_admin_id
                  ? "Анхдагчаар ээлжийн админ сонгогдоно."
                  : "Ээлж идэвхгүй бол гүйлгээг дуусгасан админыг гараар сонгоно."}
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => {
                  setConfirmModal(null);
                  setAdminBillUrls([]);
                  setConfirmCompletedByAdminId(null);
                }}
                className="flex-1 py-2 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200"
              >
                Цуцлах
              </button>
              <button
                onClick={handleConfirmTransaction}
                disabled={uploading || !(confirmCompletedByAdminId ?? currentShift?.current_admin_id)}
                className="flex-1 py-2 rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
              >
                Дуусгах
              </button>
            </div>
          </div>
        </div>
        );
      })()}

      {/* Shift Management Modal */}
      {showShiftModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-5 max-w-md w-full">
            <div className="flex items-center justify-between mb-4">
              <div className="font-semibold text-maroon-700 flex items-center gap-2">
                <UserCheck className="w-5 h-5" />
                {currentShift ? "Ээлж шилжүүлэх" : "Ээлж эхлүүлэх"}
              </div>
              <button
                onClick={() => {
                  setShowShiftModal(false);
                  setSelectedAdminId(null);
                }}
                className="p-1 rounded hover:bg-slate-100"
              >
                <X className="w-5 h-5 text-slate-500" />
              </button>
            </div>

            {currentShift?.is_shift_active ? (
              /* Transfer Shift */
              <div className="space-y-4">
                <div className="p-3 bg-blue-50 rounded-lg border border-blue-200">
                  <div className="text-sm text-blue-700">
                    Одоогийн ээлж: <strong>{currentShift.current_admin_name || `Admin ${currentShift.current_admin_id}`}</strong>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                  Дараагийн админ
                  </label>
                  <select
                    value={selectedAdminId || ""}
                    onChange={(e) => setSelectedAdminId(e.target.value ? parseInt(e.target.value) : null)}
                    className="w-full border border-maroon-200 rounded-lg p-3 text-sm bg-white"
                  >
                    <option value="">-- Админ сонгоно уу --</option>
                    {adminUsers
                      .filter(a => a.id !== currentShift.current_admin_id)
                      .map(admin => (
                        <option key={admin.id} value={admin.id}>
                          {admin.name} ({admin.id})
                        </option>
                      ))}
                  </select>
                </div>
                <button
                  onClick={handleTransferShift}
                  disabled={!selectedAdminId || shiftLoading}
                  className="w-full py-3 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  <RefreshCw className={`w-4 h-4 ${shiftLoading ? 'animate-spin' : ''}`} />
                  Шилжүүлэх
                </button>
              </div>
            ) : (
              /* Open New Shift */
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Админ сонгох
                  </label>
                  <select
                    value={selectedAdminId || ""}
                    onChange={(e) => setSelectedAdminId(e.target.value ? parseInt(e.target.value) : null)}
                    className="w-full border border-maroon-200 rounded-lg p-3 text-sm bg-white"
                  >
                    <option value="">-- Админ сонгоно уу --</option>
                    {adminUsers.map(admin => (
                      <option key={admin.id} value={admin.id}>
                        {admin.name} ({admin.id})
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  onClick={handleOpenShift}
                  disabled={!selectedAdminId || shiftLoading}
                  className="w-full py-3 rounded-lg bg-green-600 text-white font-semibold hover:bg-green-700 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  <Play className={`w-4 h-4 ${shiftLoading ? 'animate-spin' : ''}`} />
                  Ээлж эхлүүлэх
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Working Hours Modal */}
      {showWorkingHoursModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-5 max-w-md w-full">
            <div className="flex items-center justify-between mb-4">
              <div className="font-semibold text-maroon-700 flex items-center gap-2">
                <Clock className="w-5 h-5" />
                Ажлын цаг тохируулах
              </div>
              <button
                onClick={() => setShowWorkingHoursModal(false)}
                className="p-1 rounded hover:bg-slate-100"
              >
                <X className="w-5 h-5 text-slate-500" />
              </button>
            </div>

            <div className="space-y-4">
              {/* Enable/Disable Toggle */}
              <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                <div className="flex items-center gap-2">
                  <Power className={`w-4 h-4 ${editIsEnabled ? 'text-green-600' : 'text-slate-400'}`} />
                  <span className="text-sm font-medium">
                    Үйлчилгээ {editIsEnabled ? 'идэвхтэй' : 'идэвхгүй'}
                  </span>
                </div>
                <button
                  onClick={() => setEditIsEnabled(!editIsEnabled)}
                  className={`relative w-12 h-6 rounded-full transition-colors ${
                    editIsEnabled ? 'bg-green-500' : 'bg-slate-300'
                  }`}
                >
                  <span
                    className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${
                      editIsEnabled ? 'right-1' : 'left-1'
                    }`}
                  />
                </button>
              </div>

              {/* Time Selection */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Эхлэх (Москвагийн цагаар)
                  </label>
                  <select
                    value={editStartHour}
                    onChange={(e) => setEditStartHour(parseInt(e.target.value))}
                    className="w-full border border-maroon-200 rounded-lg p-3 text-sm bg-white"
                    disabled={!editIsEnabled}
                  >
                    {Array.from({ length: 24 }, (_, i) => (
                      <option key={i} value={i}>
                        {i.toString().padStart(2, '0')}:00
                      </option>
                    ))}
                  </select>
                  <div className="text-xs text-slate-500 mt-1">
                    УБ: {((editStartHour + 5) % 24).toString().padStart(2, '0')}:00
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Дуусах (Москвагийн цагаар)
                  </label>
                  <select
                    value={editEndHour}
                    onChange={(e) => setEditEndHour(parseInt(e.target.value))}
                    className="w-full border border-maroon-200 rounded-lg p-3 text-sm bg-white"
                    disabled={!editIsEnabled}
                  >
                    {Array.from({ length: 24 }, (_, i) => (
                      <option key={i} value={i}>
                        {i.toString().padStart(2, '0')}:00
                      </option>
                    ))}
                  </select>
                  <div className="text-xs text-slate-500 mt-1">
                    УБ: {((editEndHour + 5) % 24).toString().padStart(2, '0')}:00
                  </div>
                </div>
              </div>

              {/* Preview */}
              <div className="p-3 bg-blue-50 rounded-lg border border-blue-200">
                <div className="text-sm text-blue-700">
                  <div className="font-medium mb-1">Ажлын цаг:</div>
                  <div>
                    Москва: {editStartHour.toString().padStart(2, '0')}:00 - {editEndHour.toString().padStart(2, '0')}:00
                  </div>
                  <div>
                    Улаанбаатар: {((editStartHour + 5) % 24).toString().padStart(2, '0')}:00 - {((editEndHour + 5) % 24).toString().padStart(2, '0')}:00
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-2">
                <button
                  onClick={() => setShowWorkingHoursModal(false)}
                  className="flex-1 py-2 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200"
                >
                  Цуцлах
                </button>
                <button
                  onClick={handleUpdateWorkingHours}
                  disabled={workingHoursLoading}
                  className="flex-1 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {workingHoursLoading && <RefreshCw className="w-4 h-4 animate-spin" />}
                  Хадгалах
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
