import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Search,
  User,
  Phone,
  Mail,
  CheckCircle2,
  XCircle,
  Copy,
  MessageCircle,
  RefreshCw,
  Send,
  X,
} from "lucide-react";
import {
  fetchUserMessageTemplates,
  searchUsers,
  type AdminUserMessageTemplate,
  type UserSearchItem,
} from "../api";
import { AdminEmptyState, AdminSectionHeader } from "./admin/AdminPanelPrimitives";
import { AdminUserMessageModal } from "./admin/AdminUserMessageModal";

const SEARCH_DEBOUNCE_MS = 350;

function displayName(user: UserSearchItem): string {
  const name = [user.last_name, user.first_name].filter(Boolean).join(" ").trim();
  return name || "Нэргүй";
}

function uniquePhones(user: UserSearchItem): string[] {
  const seen = new Set<string>();
  const phones: string[] = [];
  for (const value of [user.phone_mnt, user.phone_intl, user.phone]) {
    const phone = value?.trim();
    const key = phone?.replace(/\D/g, "");
    if (phone && key && !seen.has(key)) {
      seen.add(key);
      phones.push(phone);
    }
  }
  return phones;
}

export function AdminUserSearch() {
  const [query, setQuery] = useState("");
  const [users, setUsers] = useState<UserSearchItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [templates, setTemplates] = useState<AdminUserMessageTemplate[]>([]);
  const [messageTarget, setMessageTarget] = useState<UserSearchItem | null>(null);
  const inFlight = useRef<AbortController | null>(null);

  const runSearch = useCallback(async (value: string) => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    setLoading(true);
    setError(null);
    try {
      const res = await searchUsers(value.trim(), controller.signal);
      if (controller.signal.aborted) return;
      setUsers(res.users);
    } catch (err) {
      if (controller.signal.aborted) return;
      console.error("Search error:", err);
      setError("Хайлт амжилтгүй боллоо. Дахин оролдоно уу.");
    } finally {
      if (inFlight.current === controller) {
        inFlight.current = null;
        setLoading(false);
      }
    }
  }, []);

  // Search as the admin types (debounced); the first run loads recent users.
  useEffect(() => {
    const timer = setTimeout(() => runSearch(query), query ? SEARCH_DEBOUNCE_MS : 0);
    return () => clearTimeout(timer);
  }, [query, runSearch]);

  useEffect(() => () => inFlight.current?.abort(), []);

  useEffect(() => {
    let cancelled = false;
    fetchUserMessageTemplates()
      .then((items) => {
        if (!cancelled) setTemplates(items);
      })
      .catch((err) => console.error("Message templates error:", err));
    return () => {
      cancelled = true;
    };
  }, []);

  const template = useMemo(() => templates[0] ?? null, [templates]);

  const handleCopy = async (text: string, fieldId: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Fallback for older browsers
      const textArea = document.createElement("textarea");
      textArea.value = text;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand("copy");
      document.body.removeChild(textArea);
    }
    setCopiedField(fieldId);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const chipClass =
    "inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-200 text-slate-700 text-xs font-medium rounded-lg hover:bg-slate-300 transition";

  return (
    <div className="space-y-4">
      {/* Search Bar */}
      <div className="glass-card rounded-2xl border border-white/60 p-4">
        <AdminSectionHeader icon={Search} title="Хэрэглэгч хайх" />
        <div className="mt-2 flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
            <input
              type="text"
              aria-label="Хэрэглэгч хайх"
              placeholder="Хайх: нэр, утас, @username, ID, имэйл..."
              className="h-9 w-full rounded-lg border border-maroon-100 pl-9 pr-8 text-xs focus:border-maroon-500 focus:ring-2 focus:ring-maroon-500"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && runSearch(query)}
            />
            {query && (
              <button
                type="button"
                aria-label="Хайлтыг цэвэрлэх"
                onClick={() => setQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-slate-400 hover:text-slate-600"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>
          <button
            onClick={() => runSearch(query)}
            disabled={loading}
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-maroon-600 px-3 text-xs font-semibold text-white transition hover:bg-maroon-700 disabled:opacity-50"
          >
            {loading ? (
              <RefreshCw className="size-3.5 animate-spin" />
            ) : (
              <Search className="size-3.5" />
            )}
            Хайх
          </button>
        </div>
        {!error && users.length > 0 && (
          <div className="mt-2 text-[0.7rem] text-slate-400">
            {query.trim() ? `${users.length} үр дүн` : `Сүүлийн ${users.length} хэрэглэгч`}
          </div>
        )}
      </div>

      {error && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
          {error}
        </div>
      )}

      {/* Results */}
      <div className="space-y-3">
        {users.length === 0 && !loading && !error && (
          <div className="rounded-xl border border-maroon-100 bg-white/50"><AdminEmptyState icon={User}>Хэрэглэгч олдсонгүй</AdminEmptyState></div>
        )}

        {users.map((user) => {
          const phones = uniquePhones(user);
          return (
            <div
              key={user.id}
              className="glass-card p-4 rounded-xl border border-white/60 space-y-3"
            >
              {/* User Header */}
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="w-10 h-10 shrink-0 rounded-full bg-maroon-100 flex items-center justify-center">
                    <User className="w-5 h-5 text-maroon-600" />
                  </div>
                  <div className="min-w-0">
                    <div className="truncate font-semibold text-slate-800">{displayName(user)}</div>
                    <div className="text-xs text-slate-500 flex flex-wrap items-center gap-x-2">
                      {user.verified ? (
                        <span className="flex items-center gap-1 text-green-600">
                          <CheckCircle2 className="w-3 h-3" /> Баталгаажсан
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-orange-500">
                          <XCircle className="w-3 h-3" /> Баталгаажаагүй
                        </span>
                      )}
                      <span>• {user.total_transactions} гүйлгээ</span>
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setMessageTarget(user)}
                  disabled={!template}
                  title={template ? "Ботоор мессеж илгээх" : "Мессежийн загвар ачаалагдаагүй байна"}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-maroon-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-maroon-700 disabled:opacity-50"
                >
                  <Send className="size-3.5" />
                  Мессеж
                </button>
              </div>

              {/* Contact Options */}
              <div className="p-3 bg-blue-50 rounded-lg border border-blue-200">
                <div className="text-xs text-slate-500 mb-2">👤 Холбогдох:</div>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => handleCopy(String(user.id), `id-${user.id}`)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 transition"
                  >
                    {copiedField === `id-${user.id}` ? (
                      <CheckCircle2 className="w-4 h-4" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                    ID хуулах: {user.id}
                  </button>

                  {user.username && (
                    <a
                      href={`https://t.me/${user.username}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={chipClass}
                    >
                      <MessageCircle className="w-4 h-4" />
                      @{user.username}
                    </a>
                  )}

                  {phones.map((phone) => (
                    <button
                      key={phone}
                      onClick={() => handleCopy(phone, `phone-${user.id}-${phone}`)}
                      className={chipClass}
                    >
                      {copiedField === `phone-${user.id}-${phone}` ? (
                        <CheckCircle2 className="w-4 h-4 text-green-500" />
                      ) : (
                        <Phone className="w-4 h-4" />
                      )}
                      {phone}
                    </button>
                  ))}

                  {user.email && (
                    <button
                      onClick={() => handleCopy(user.email!, `email-${user.id}`)}
                      className={chipClass}
                    >
                      {copiedField === `email-${user.id}` ? (
                        <CheckCircle2 className="w-4 h-4 text-green-500" />
                      ) : (
                        <Mail className="w-4 h-4" />
                      )}
                      {user.email}
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {messageTarget && template && (
        <AdminUserMessageModal
          recipient={{ id: messageTarget.id, name: displayName(messageTarget) }}
          template={template}
          onClose={() => setMessageTarget(null)}
        />
      )}
    </div>
  );
}
