import { useState, useEffect } from "react";
import {
  Search,
  User,
  Phone,
  CheckCircle2,
  XCircle,
  Copy,
  MessageCircle,
  RefreshCw,
} from "lucide-react";
import { searchUsers, UserSearchItem } from "../api";
import { AdminEmptyState, AdminSectionHeader } from "./admin/AdminPanelPrimitives";

export function AdminUserSearch() {
  const [query, setQuery] = useState("");
  const [users, setUsers] = useState<UserSearchItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const handleSearch = async () => {
    setLoading(true);
    try {
      const res = await searchUsers(query);
      setUsers(res.users);
    } catch (err) {
      console.error("Search error:", err);
    } finally {
      setLoading(false);
    }
  };

  // Load all users on mount
  useEffect(() => {
    handleSearch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
              placeholder="Хайх: ID, нэр, утас, username..."
              className="h-9 w-full rounded-lg border border-maroon-100 pl-9 pr-3 text-xs focus:border-maroon-500 focus:ring-2 focus:ring-maroon-500"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            />
          </div>
          <button
            onClick={handleSearch}
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
      </div>

      {/* Results */}
      <div className="space-y-3">
        {users.length === 0 && !loading && (
          <div className="rounded-xl border border-maroon-100 bg-white/50"><AdminEmptyState icon={User}>Хэрэглэгч олдсонгүй</AdminEmptyState></div>
        )}

        {users.map((user) => (
          <div
            key={user.id}
            className="glass-card p-4 rounded-xl border border-white/60 space-y-3"
          >
            {/* User Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-maroon-100 flex items-center justify-center">
                  <User className="w-5 h-5 text-maroon-600" />
                </div>
                <div>
                  <div className="font-semibold text-slate-800">
                    {user.last_name || ""} {user.first_name || "Нэргүй"}
                  </div>
                  <div className="text-xs text-slate-500 flex items-center gap-2">
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
            </div>

            {/* Contact Options */}
            <div className="p-3 bg-blue-50 rounded-lg border border-blue-200">
              <div className="text-xs text-slate-500 mb-2">👤 Холбогдох:</div>
              <div className="flex flex-wrap gap-2">
                {/* Copy User ID - Primary action */}
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

                {/* Username link if available */}
                {user.username && (
                  <a
                    href={`https://t.me/${user.username}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-200 text-slate-700 text-xs font-medium rounded-lg hover:bg-slate-300 transition"
                  >
                    <MessageCircle className="w-4 h-4" />
                    @{user.username}
                  </a>
                )}

                {/* Phone if available */}
                {user.phone && (
                  <button
                    onClick={() => handleCopy(user.phone!, `phone-${user.id}`)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-200 text-slate-700 text-xs font-medium rounded-lg hover:bg-slate-300 transition"
                  >
                    {copiedField === `phone-${user.id}` ? (
                      <CheckCircle2 className="w-4 h-4 text-green-500" />
                    ) : (
                      <Phone className="w-4 h-4" />
                    )}
                    {user.phone}
                  </button>
                )}
              </div>

              {/* Instruction for contacting */}
              <div className="mt-2 pt-2 border-t border-blue-200 text-xs text-slate-500">
                💡 Telegram бот дотор ID-г хайж хэрэглэгч рүү мессеж илгээх боломжтой
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
