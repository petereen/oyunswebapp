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
} from "lucide-react";
import { 
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
  ShiftResponse,
  AdminUser,
  WorkingHoursConfig,
} from "../api";

interface Props {
  adminKey?: string;
  initData?: string;
}

interface InboxItem {
  invoice: string;
  user_id: number;
  amount: number;
  currency_from: string;
  currency_to: string;
  status: string;
  timestamp: string;
  rate: number;
  bank_details?: string;
  receipt_id?: string;
  bill_url?: string;
  admin_bill_url?: string;
  rejection_comment?: string;
  direction?: string;
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

function getTimeAgo(dateStr: string): string {
  // Parse the timestamp as UTC
  let then: Date;
  if (dateStr.endsWith('Z') || dateStr.includes('+')) {
    then = new Date(dateStr);
  } else {
    // Assume UTC if no timezone specified
    then = new Date(dateStr + 'Z');
  }
  
  // Get current time in UTC
  const now = Date.now();
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

export function AdminInbox({ adminKey, initData }: Props) {
  const [items, setItems] = useState<InboxItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // UI state - Changed from expandedInvoice to detailModal for popup
  const [detailModal, setDetailModal] = useState<InboxItem | null>(null);
  const [photoModal, setPhotoModal] = useState<string | null>(null);
  const [rejectModal, setRejectModal] = useState<string | null>(null);
  const [rejectComment, setRejectComment] = useState("");
  const [confirmModal, setConfirmModal] = useState<InboxItem | null>(null);
  const [adminBillUrl, setAdminBillUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [copied, setCopied] = useState(false);

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
      const res = await fetchInbox(adminKey);
      console.log("Loaded items:", res.items);
      setItems(res.items || []);
    } catch {
      setError("Ирсэн хүсэлтүүдийг ачаалж чадсангүй");
    } finally {
      setLoading(false);
    }
  };

  const loadShift = async () => {
    if (!adminKey) return;
    try {
      setShiftLoading(true);
      const [shiftRes, usersRes] = await Promise.all([
        fetchCurrentShift(adminKey),
        fetchAdminUsers(adminKey),
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
    if (!adminKey) return;
    try {
      setWorkingHoursLoading(true);
      const config = await fetchWorkingHours(adminKey);
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
    if (!adminKey) return;
    try {
      setWorkingHoursLoading(true);
      await updateWorkingHours(adminKey, {
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
    if (!adminKey || !selectedAdminId) return;
    const selectedAdmin = adminUsers.find(a => a.id === selectedAdminId);
    try {
      setShiftLoading(true);
      await openShift(adminKey, selectedAdminId, selectedAdmin?.name);
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
    if (!adminKey || !currentShift?.current_admin_id) return;
    if (!confirm("Ээлж хаахдаа итгэлтэй байна уу?")) return;
    try {
      setShiftLoading(true);
      await closeShift(adminKey, currentShift.current_admin_id);
      setCurrentShift(null);
    } catch (err) {
      console.error("Failed to close shift:", err);
      alert("Ээлж хаахад алдаа гарлаа");
    } finally {
      setShiftLoading(false);
    }
  };

  const handleTransferShift = async () => {
    if (!adminKey || !currentShift?.current_admin_id || !selectedAdminId) return;
    const selectedAdmin = adminUsers.find(a => a.id === selectedAdminId);
    try {
      setShiftLoading(true);
      await transferShift(adminKey, currentShift.current_admin_id, selectedAdminId, selectedAdmin?.name);
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
  }, [adminKey]);

  // Sort and filter items
  const displayItems = useMemo(() => {
    let filtered = [...items];

    // Filter
    if (filterBy === "buy") {
      filtered = filtered.filter((i) => i.direction === "buy" || i.currency_from === "RUB");
    } else if (filterBy === "sell") {
      filtered = filtered.filter((i) => i.direction === "sell" || i.currency_from === "MNT");
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
    if (!adminKey) return;
    try {
      console.log("Approving invoice:", invoice);
      const result = await adminAction(adminKey, { invoice, status: "approved" });
      console.log("Approval result:", result);
      setDetailModal(null);
      await load();
      console.log("Items after reload:", items);
    } catch (err) {
      console.error("Approval error:", err);
    }
  };

  const handleReject = async () => {
    if (!adminKey || !rejectModal) return;
    try {
      await adminAction(adminKey, {
        invoice: rejectModal,
        status: "rejected",
        rejection_comment: rejectComment,
      });
      setRejectModal(null);
      setRejectComment("");
      await load();
    } catch (err) {
      console.error("Rejection error:", err);
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

  const handleAdminBillUpload = async (file: File) => {
    if (!confirmModal) return;
    setUploading(true);
    try {
      const path = `admin/${Date.now()}-${file.name}`;
      if (!initData) {
        throw new Error("Missing Telegram init data for presign");
      }
      const presigned = await requestPresign(initData, { bucket: "bills", path });
      await fetch(presigned.upload_url, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type },
      });
      setAdminBillUrl(presigned.public_url);
    } catch {
      alert("Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const handleConfirmTransaction = async () => {
    if (!adminKey || !confirmModal) return;
    await adminAction(adminKey, {
      invoice: confirmModal.invoice,
      status: "completed",
      admin_bill_url: adminBillUrl,
      completed_by_admin: currentShift?.current_admin_id ?? undefined,
    });
    setConfirmModal(null);
    setAdminBillUrl("");
    await load();
  };

  const getDirectionLabel = (item: InboxItem) => {
    if (item.direction === "buy" || item.currency_from === "RUB") {
      return { label: "BUY", color: "bg-green-100 text-green-700" };
    }
    return { label: "SELL", color: "bg-orange-100 text-orange-700" };
  };

  return (
    <div className="glass-card p-5 rounded-2xl border border-white/60 flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between text-ocean-700 font-semibold">
        <span>Ирсэн гүйлгээний хүсэлтүүд</span>
        <button
          className="text-xs px-3 py-1 rounded-full bg-ocean-600 text-white"
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
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-ocean-50 text-ocean-700 hover:bg-ocean-100"
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
                  className={`block w-full text-left px-3 py-2 hover:bg-ocean-50 ${
                    sortBy === opt.value ? "bg-ocean-100 font-medium" : ""
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
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-ocean-50 text-ocean-700 hover:bg-ocean-100"
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
                  className={`block w-full text-left px-3 py-2 hover:bg-ocean-50 ${
                    filterBy === opt.value ? "bg-ocean-100 font-medium" : ""
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
            return (
              <div
                key={item.invoice}
                onClick={() => setDetailModal(item)}
                className="border border-amber-200 rounded-xl bg-white p-3 cursor-pointer hover:bg-amber-50 transition"
              >
                <div className="flex items-center gap-3">
                  <span className={`text-xs font-bold px-2 py-1 rounded ${dirInfo.color}`}>
                    {dirInfo.label}
                  </span>
                  <div className="flex-1">
                    <span className="font-semibold text-ocean-700">
                      {Number(item.amount).toLocaleString()} {item.currency_from}
                    </span>
                    <span className="text-slate-400 mx-1">→</span>
                    <span className="text-slate-600">{item.currency_to}</span>
                  </div>
                  <div className="flex items-center gap-1 text-xs text-slate-500">
                    <Clock className="w-3 h-3" />
                    {getTimeAgo(item.timestamp)}
                  </div>
                  {item.bill_url && (
                    <span className="p-1.5 rounded-lg bg-blue-50 text-blue-600">
                      <Image className="w-4 h-4" />
                    </span>
                  )}
                </div>
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
            const isBuy = item.direction === "buy" || item.currency_from === "RUB";
            const transferAmt = isBuy 
              ? (Number(item.amount) * Number(item.rate)).toFixed(0)
              : (Number(item.amount) / Number(item.rate)).toFixed(2);
            const transferCur = isBuy ? "₮" : "₽";
            
            return (
              <div
                key={item.invoice}
                onClick={() => {
                  setConfirmModal(item);
                  setAdminBillUrl(item.admin_bill_url || "");
                }}
                className="border border-green-200 rounded-xl bg-white p-3 cursor-pointer hover:bg-green-50 transition"
              >
                <div className="flex items-center gap-3">
                  <span className={`text-xs font-bold px-2 py-1 rounded ${dirInfo.color}`}>
                    {dirInfo.label}
                  </span>
                  <div className="flex-1">
                    <span className="font-semibold text-ocean-700">
                      {Number(item.amount).toLocaleString()} {item.currency_from}
                    </span>
                    <span className="text-slate-400 mx-1">→</span>
                    <span className="text-slate-600">{item.currency_to}</span>
                  </div>
                  <div className="flex items-center gap-1 text-xs text-slate-500">
                    <Clock className="w-3 h-3" />
                    {getTimeAgo(item.timestamp)}
                  </div>
                </div>
                <div className="mt-2 p-2 bg-green-100 rounded-lg flex items-center justify-between">
                  <span className="text-sm text-green-700">Шилжүүлэх дүн:</span>
                  <span className="font-bold text-green-800">{Number(transferAmt).toLocaleString()} {transferCur}</span>
                </div>
                <div className="mt-1 text-xs text-slate-400 font-mono truncate">#{item.invoice}</div>
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
        const isBuy = item.direction === "buy" || item.currency_from === "RUB";
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
              <div className="sticky top-0 bg-white border-b border-ocean-100 p-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-bold px-2 py-1 rounded ${dirInfo.color}`}>
                    {dirInfo.label}
                  </span>
                  <span className="font-semibold text-ocean-700">
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
                    <a
                      href={`tg://user?id=${item.user_id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 transition"
                    >
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.562 8.161c-.18 1.897-.962 6.502-1.359 8.627-.168.9-.5 1.201-.82 1.23-.697.064-1.226-.461-1.901-.903-1.056-.692-1.653-1.123-2.678-1.799-1.185-.781-.417-1.21.258-1.911.177-.184 3.247-2.977 3.307-3.23.007-.032.015-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.139-5.062 3.345-.479.329-.913.489-1.302.481-.428-.009-1.252-.242-1.865-.442-.751-.244-1.349-.374-1.297-.789.027-.216.324-.437.893-.663 3.498-1.524 5.831-2.529 6.998-3.015 3.333-1.386 4.025-1.627 4.477-1.635.099-.002.321.023.465.141.121.1.154.234.169.328.016.093.035.3.02.463z"/>
                      </svg>
                      Telegram чат
                    </a>
                    <button
                      onClick={() => handleCopy(String(item.user_id), "user-id")}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-200 text-slate-700 text-xs font-medium rounded-lg hover:bg-slate-300 transition"
                    >
                      {copiedField === "user-id" ? (
                        <CheckCircle2 className="w-4 h-4 text-green-500" />
                      ) : (
                        <Copy className="w-4 h-4" />
                      )}
                      ID: {item.user_id}
                    </button>
                    <a
                      href={`https://t.me/${item.user_id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-200 text-slate-700 text-xs font-medium rounded-lg hover:bg-slate-300 transition"
                    >
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.562 8.161c-.18 1.897-.962 6.502-1.359 8.627-.168.9-.5 1.201-.82 1.23-.697.064-1.226-.461-1.901-.903-1.056-.692-1.653-1.123-2.678-1.799-1.185-.781-.417-1.21.258-1.911.177-.184 3.247-2.977 3.307-3.23.007-.032.015-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.139-5.062 3.345-.479.329-.913.489-1.302.481-.428-.009-1.252-.242-1.865-.442-.751-.244-1.349-.374-1.297-.789.027-.216.324-.437.893-.663 3.498-1.524 5.831-2.529 6.998-3.015 3.333-1.386 4.025-1.627 4.477-1.635.099-.002.321.023.465.141.121.1.154.234.169.328.016.093.035.3.02.463z"/>
                      </svg>
                      Web link
                    </a>
                  </div>
                </div>

                {/* Timestamps */}
                <div className="text-xs text-slate-500 space-y-1 p-2 bg-slate-50 rounded-lg">
                  <div>УБ: {formatToTimezone(item.timestamp, "Asia/Ulaanbaatar")}</div>
                  <div>МСК: {formatToTimezone(item.timestamp, "Europe/Moscow")}</div>
                  <div className="text-slate-400">{getTimeAgo(item.timestamp)}</div>
                </div>

                {/* User's Receipt Photo - Full display */}
                {item.bill_url && (
                  <div>
                    <div className="text-xs text-slate-500 mb-2">📸 Хэрэглэгчийн баримт:</div>
                    <div 
                      className="relative rounded-lg overflow-hidden cursor-pointer border border-ocean-200"
                      onClick={() => setPhotoModal(item.bill_url!)}
                    >
                      <img 
                        src={item.bill_url} 
                        alt="Receipt" 
                        className="w-full max-h-64 object-contain bg-slate-50"
                      />
                    </div>
                  </div>
                )}

                {/* Transfer Amount - What admin needs to send */}
                <div className="p-3 bg-gradient-to-r from-ocean-50 to-sky-50 rounded-lg border border-ocean-200">
                  <div className="text-xs text-slate-500 mb-1">Шилжүүлэх дүн:</div>
                  <div className="flex items-center justify-between">
                    <span className="text-xl font-bold text-ocean-700">
                      {Number(transferAmount).toLocaleString()} {transferCurrency}
                    </span>
                    <button
                      onClick={() => handleCopy(transferAmount, "detail-amount")}
                      className="p-1.5 rounded-lg hover:bg-ocean-100 bg-white/50"
                      title="Дүнг хуулбарлах"
                    >
                      {copiedField === "detail-amount" ? (
                        <CheckCircle2 className="w-4 h-4 text-green-500" />
                      ) : (
                        <Copy className="w-4 h-4 text-ocean-600" />
                      )}
                    </button>
                  </div>
                  <div className="text-xs text-slate-500 mt-1">
                    Ханш: {Number(item.rate).toFixed(2)} | Хэрэглэгчийн илгээсэн дүн: {Number(item.amount).toLocaleString()} {item.currency_from}
                  </div>
                </div>

                {/* Bank Details */}
                {item.bank_details && (
                  <div className="p-3 bg-white rounded-lg border border-ocean-200">
                    <div className="text-xs text-slate-500 mb-2">Хэрэглэгчийн банкны мэдээлэл:</div>
                    
                    {parsed.bank && (
                      <div className="flex items-center justify-between py-2 border-b border-slate-100">
                        <div className="text-xs text-slate-500">Банк</div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-ocean-700">{parsed.bank}</span>
                          <button
                            onClick={() => handleCopy(parsed.bank!, "detail-bank")}
                            className="p-1.5 rounded hover:bg-ocean-100"
                          >
                            {copiedField === "detail-bank" ? (
                              <CheckCircle2 className="w-4 h-4 text-green-500" />
                            ) : (
                              <Copy className="w-4 h-4 text-ocean-500" />
                            )}
                          </button>
                        </div>
                      </div>
                    )}

                    {parsed.account && (
                      <div className="flex items-center justify-between py-2 border-b border-slate-100">
                        <div className="text-xs text-slate-500">Данс</div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-medium text-ocean-700">{parsed.account}</span>
                          <button
                            onClick={() => handleCopy(parsed.account!, "detail-account")}
                            className="p-1.5 rounded hover:bg-ocean-100"
                          >
                            {copiedField === "detail-account" ? (
                              <CheckCircle2 className="w-4 h-4 text-green-500" />
                            ) : (
                              <Copy className="w-4 h-4 text-ocean-500" />
                            )}
                          </button>
                        </div>
                      </div>
                    )}

                    {parsed.phone && (
                      <div className="flex items-center justify-between py-2 border-b border-slate-100">
                        <div className="text-xs text-slate-500">Утасны дугаар</div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-medium text-ocean-700">{parsed.phone}</span>
                          <button
                            onClick={() => handleCopy(parsed.phone!, "detail-phone")}
                            className="p-1.5 rounded hover:bg-ocean-100"
                          >
                            {copiedField === "detail-phone" ? (
                              <CheckCircle2 className="w-4 h-4 text-green-500" />
                            ) : (
                              <Copy className="w-4 h-4 text-ocean-500" />
                            )}
                          </button>
                        </div>
                      </div>
                    )}

                    {parsed.card && (
                      <div className="flex items-center justify-between py-2 border-b border-slate-100">
                        <div className="text-xs text-slate-500">Картын дугаар</div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-medium text-ocean-700">{parsed.card}</span>
                          <button
                            onClick={() => handleCopy(parsed.card!, "detail-card")}
                            className="p-1.5 rounded hover:bg-ocean-100"
                          >
                            {copiedField === "detail-card" ? (
                              <CheckCircle2 className="w-4 h-4 text-green-500" />
                            ) : (
                              <Copy className="w-4 h-4 text-ocean-500" />
                            )}
                          </button>
                        </div>
                      </div>
                    )}

                    {parsed.owner && (
                      <div className="flex items-center justify-between py-2">
                        <div className="text-xs text-slate-500">Данс эзэмшэгчийн нэр</div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-ocean-700">{parsed.owner}</span>
                          <button
                            onClick={() => handleCopy(parsed.owner!, "detail-owner")}
                            className="p-1.5 rounded hover:bg-ocean-100"
                          >
                            {copiedField === "detail-owner" ? (
                              <CheckCircle2 className="w-4 h-4 text-green-500" />
                            ) : (
                              <Copy className="w-4 h-4 text-ocean-500" />
                            )}
                          </button>
                        </div>
                      </div>
                    )}

                    {!parsed.bank && !parsed.phone && !parsed.card && !parsed.owner && !parsed.account && (
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-ocean-700 whitespace-pre-line">{item.bank_details}</span>
                        <button
                          onClick={() => handleCopy(item.bank_details!, "detail-raw")}
                          className="p-1.5 rounded hover:bg-ocean-100"
                        >
                          {copiedField === "detail-raw" ? (
                            <CheckCircle2 className="w-4 h-4 text-green-500" />
                          ) : (
                            <Copy className="w-4 h-4 text-ocean-600" />
                          )}
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* Actions for Pending - Pre-approve or Reject */}
                {item.status === "pending" && (
                  <div className="flex gap-2">
                    <button
                      onClick={async () => {
                        if (!adminKey) return;
                        try {
                          // Pre-approve: move to "approved" status
                          await adminAction(adminKey, { 
                            invoice: item.invoice, 
                            status: "approved"
                          });
                          setDetailModal(null);
                          await load();
                        } catch (err) {
                          console.error("Pre-approval error:", err);
                        }
                      }}
                      className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-green-600 text-white py-3 font-semibold hover:bg-green-700 disabled:opacity-50"
                      disabled={!adminKey}
                    >
                      <ShieldCheck className="w-5 h-5" /> Урьдчилан батлах
                    </button>
                    <button
                      onClick={() => {
                        setRejectModal(item.invoice);
                        setDetailModal(null);
                      }}
                      className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-red-100 text-red-700 py-3 font-semibold hover:bg-red-200"
                      disabled={!adminKey}
                    >
                      <XCircle className="w-5 h-5" /> Татгалзах
                    </button>
                  </div>
                )}

                {/* Actions for Approved - Open confirm modal to finalize */}
                {item.status === "approved" && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        setConfirmModal(item);
                        setDetailModal(null);
                        setAdminBillUrl("");
                      }}
                      className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-ocean-600 text-white py-3 font-semibold hover:bg-ocean-700"
                    >
                      <Upload className="w-5 h-5" /> Гүйлгээ дуусгах
                    </button>
                    <button
                      onClick={() => {
                        setRejectModal(item.invoice);
                        setDetailModal(null);
                      }}
                      className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-red-100 text-red-700 py-3 font-semibold hover:bg-red-200"
                      disabled={!adminKey}
                    >
                      <XCircle className="w-5 h-5" /> Татгалзах
                    </button>
                  </div>
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
            <div className="font-semibold text-ocean-700 mb-3">Гүйлгээг татгалзах</div>
            <div className="text-sm text-slate-600 mb-2">
              Хэрэглэгчид илгээх шалтгаан/тайлбарыг оруулна уу (Telegram чатаар илгээгдэнэ):
            </div>
            <textarea
              value={rejectComment}
              onChange={(e) => setRejectComment(e.target.value)}
              className="w-full border border-ocean-200 rounded-lg p-3 text-sm mb-3"
              rows={3}
              placeholder="Татгалзсан шалтгаан..."
            />
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setRejectModal(null);
                  setRejectComment("");
                }}
                className="flex-1 py-2 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200"
              >
                Цуцлах
              </button>
              <button
                onClick={handleReject}
                className="flex-1 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700"
              >
                Татгалзах
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Transaction Modal */}
      {confirmModal && (() => {
        const isBuy = confirmModal.direction === "buy" || confirmModal.currency_from === "RUB";
        const parsed = parseBankDetails(confirmModal.bank_details || "", isBuy);
        const transferAmount = isBuy 
          ? (Number(confirmModal.amount) * Number(confirmModal.rate)).toFixed(0)
          : (Number(confirmModal.amount) / Number(confirmModal.rate)).toFixed(2);
        const transferCurrency = isBuy ? "₮" : "₽";
        
        return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-5 max-w-md w-full max-h-[90vh] overflow-auto">
            <div className="font-semibold text-ocean-700 mb-3">Гүйлгээг дуусгах</div>

            {/* Transfer Amount */}
            <div className="mb-4 p-3 bg-gradient-to-r from-ocean-50 to-sky-50 rounded-lg border border-ocean-200">
              <div className="text-xs text-slate-500 mb-1">Шилжүүлэх дүн:</div>
              <div className="flex items-center justify-between">
                <span className="text-xl font-bold text-ocean-700">
                  {Number(transferAmount).toLocaleString()} {transferCurrency}
                </span>
                <button
                  onClick={() => handleCopy(transferAmount, "modal-amount")}
                  className="p-1.5 rounded-lg hover:bg-ocean-100 bg-white/50"
                  title="Дүнг хуулбарлах"
                >
                  {copiedField === "modal-amount" ? (
                    <CheckCircle2 className="w-4 h-4 text-green-500" />
                  ) : (
                    <Copy className="w-4 h-4 text-ocean-600" />
                  )}
                </button>
              </div>
            </div>

            {/* User's Bank Info - Structured */}
            <div className="mb-4 p-3 bg-white rounded-lg border border-ocean-200">
              <div className="text-xs text-slate-500 mb-2">Хэрэглэгчийн данс руу шилжүүлэх дүн:</div>
              
              {/* Bank Name */}
              {parsed.bank && (
                <div className="flex items-center justify-between py-1.5 border-b border-slate-100">
                  <div className="text-xs text-slate-500">Банк</div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-ocean-700">{parsed.bank}</span>
                    <button
                      onClick={() => handleCopy(parsed.bank!, "modal-bank")}
                      className="p-1 rounded hover:bg-ocean-100"
                    >
                      {copiedField === "modal-bank" ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
                      ) : (
                        <Copy className="w-3.5 h-3.5 text-ocean-500" />
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
                    <span className="font-mono font-medium text-ocean-700">{parsed.account}</span>
                    <button
                      onClick={() => handleCopy(parsed.account!, "modal-account")}
                      className="p-1 rounded hover:bg-ocean-100"
                    >
                      {copiedField === "modal-account" ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
                      ) : (
                        <Copy className="w-3.5 h-3.5 text-ocean-500" />
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
                    <span className="font-mono font-medium text-ocean-700">{parsed.phone}</span>
                    <button
                      onClick={() => handleCopy(parsed.phone!, "modal-phone")}
                      className="p-1 rounded hover:bg-ocean-100"
                    >
                      {copiedField === "modal-phone" ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
                      ) : (
                        <Copy className="w-3.5 h-3.5 text-ocean-500" />
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
                    <span className="font-mono font-medium text-ocean-700">{parsed.card}</span>
                    <button
                      onClick={() => handleCopy(parsed.card!, "modal-card")}
                      className="p-1 rounded hover:bg-ocean-100"
                    >
                      {copiedField === "modal-card" ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
                      ) : (
                        <Copy className="w-3.5 h-3.5 text-ocean-500" />
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
                    <span className="font-medium text-ocean-700">{parsed.owner}</span>
                    <button
                      onClick={() => handleCopy(parsed.owner!, "modal-owner")}
                      className="p-1 rounded hover:bg-ocean-100"
                    >
                      {copiedField === "modal-owner" ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
                      ) : (
                        <Copy className="w-3.5 h-3.5 text-ocean-500" />
                      )}
                    </button>
                  </div>
                </div>
              )}

              {/* Fallback */}
              {!parsed.bank && !parsed.phone && !parsed.card && !parsed.owner && !parsed.account && confirmModal.bank_details && (
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-ocean-700 whitespace-pre-line">{confirmModal.bank_details}</span>
                  <button
                    onClick={() => handleCopy(confirmModal.bank_details || "", "modal-raw")}
                    className="p-1 rounded hover:bg-ocean-100"
                  >
                    {copiedField === "modal-raw" ? (
                      <CheckCircle2 className="w-4 h-4 text-green-500" />
                    ) : (
                      <Copy className="w-4 h-4 text-ocean-600" />
                    )}
                  </button>
                </div>
              )}
            </div>

            {/* Upload Admin's Bill */}
            <div className="mb-4">
              <div className="text-sm text-slate-600 mb-2">Админы гүйлгээний баримтыг оруулна уу:</div>
              {adminBillUrl ? (
                <div className="flex items-center gap-2 p-2 bg-green-50 rounded-lg">
                  <CheckCircle2 className="w-5 h-5 text-green-500" />
                  <span className="text-sm text-green-700">Баримт хавсаргасан</span>
                  <button
                    onClick={() => setPhotoModal(adminBillUrl)}
                    className="ml-auto text-xs text-ocean-600 underline"
                  >
                    Харах
                  </button>
                </div>
              ) : (
                <label className="flex flex-col items-center justify-center border-2 border-dashed border-ocean-200 rounded-xl py-4 cursor-pointer bg-white/60 hover:bg-ocean-50">
                  <Upload className="w-5 h-5 text-ocean-600" />
                  <span className="text-xs text-slate-500 mt-1">
                    {uploading ? "Хуулж байна..." : "Дарж оруулна уу"}
                  </span>
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleAdminBillUpload(file);
                    }}
                    disabled={uploading}
                  />
                </label>
              )}
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => {
                  setConfirmModal(null);
                  setAdminBillUrl("");
                }}
                className="flex-1 py-2 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200"
              >
                Цуцлах
              </button>
              <button
                onClick={handleConfirmTransaction}
                disabled={!adminBillUrl}
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
              <div className="font-semibold text-ocean-700 flex items-center gap-2">
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
                    className="w-full border border-ocean-200 rounded-lg p-3 text-sm bg-white"
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
                    className="w-full border border-ocean-200 rounded-lg p-3 text-sm bg-white"
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
              <div className="font-semibold text-ocean-700 flex items-center gap-2">
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
                    className="w-full border border-ocean-200 rounded-lg p-3 text-sm bg-white"
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
                    className="w-full border border-ocean-200 rounded-lg p-3 text-sm bg-white"
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
