import { useState, useEffect, useRef } from "react";
import { Send, Image, Loader2 } from "lucide-react";
import {
  fetchFuelChat,
  sendFuelChatMessage,
  fetchFuelAdminChat,
  sendFuelAdminChatMessage,
  requestPresign,
  requestPresignAdmin,
  FuelChatMessage,
} from "../api";

interface Props {
  orderId: string;
  isAdmin: boolean;
}

export function FuelChat({ orderId, isAdmin }: Props) {
  const [messages, setMessages] = useState<FuelChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [imageUploading, setImageUploading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const fetchMessages = async () => {
    try {
      const res = isAdmin
        ? await fetchFuelAdminChat(orderId)
        : await fetchFuelChat(orderId);
      setMessages(res.messages || []);
    } catch { /* ignore */ }
  };

  // Initial load + polling every 5 seconds
  useEffect(() => {
    fetchMessages();
    const interval = setInterval(fetchMessages, 5000);
    return () => clearInterval(interval);
  }, [orderId, isAdmin]);

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      if (isAdmin) {
        await sendFuelAdminChatMessage(orderId, text);
      } else {
        await sendFuelChatMessage(orderId, text);
      }
      setInput("");
      await fetchMessages();
    } catch { /* ignore */ }
    setSending(false);
  };

  const handleImageUpload = async (file: File) => {
    setImageUploading(true);
    try {
      const ext = file.name.split(".").pop() || "jpg";
      const path = `fuel/chat/${orderId}_${Date.now()}.${ext}`;
      const presigned = isAdmin
        ? await requestPresignAdmin({ bucket: "bills", path })
        : await requestPresign({ bucket: "bills", path });
      await fetch(presigned.upload_url, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type },
      });

      if (isAdmin) {
        await sendFuelAdminChatMessage(orderId, undefined, presigned.public_url);
      } else {
        await sendFuelChatMessage(orderId, undefined, presigned.public_url);
      }
      await fetchMessages();
    } catch { /* ignore */ }
    setImageUploading(false);
  };

  return (
    <div className="bg-white dark:bg-dark-800 rounded-2xl border border-silver/60 dark:border-dark-600 overflow-hidden">
      <div className="px-4 py-3 border-b border-silver/40 dark:border-dark-600">
        <div className="text-xs font-semibold text-dark-800 dark:text-ivory-200">
          💬 Чат
        </div>
      </div>

      {/* Messages */}
      <div className="h-48 overflow-y-auto p-3 space-y-2">
        {messages.length === 0 && (
          <div className="text-center text-xs text-dark-400 dark:text-ivory-500 py-8">
            Мессеж байхгүй
          </div>
        )}
        {messages.map((m) => {
          const isMe =
            (isAdmin && m.sender_type === "admin") ||
            (!isAdmin && m.sender_type === "user");
          return (
            <div
              key={m.id}
              className={`flex ${isMe ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[75%] px-3 py-2 rounded-2xl text-xs ${
                  isMe
                    ? "bg-amber-500 text-white rounded-br-md"
                    : "bg-surface-100 dark:bg-dark-700 text-dark-800 dark:text-ivory-200 rounded-bl-md"
                }`}
              >
                {m.image_url && (
                  <img
                    src={m.image_url}
                    alt="chat"
                    className="max-h-32 rounded-lg mb-1 cursor-pointer"
                    onClick={() => window.open(m.image_url!, "_blank")}
                  />
                )}
                {m.message && <div>{m.message}</div>}
                <div
                  className={`text-[10px] mt-0.5 ${
                    isMe ? "text-white/60" : "text-dark-400 dark:text-ivory-500"
                  }`}
                >
                  {new Date(m.created_at).toLocaleTimeString("mn-MN", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="border-t border-silver/40 dark:border-dark-600 p-2 flex items-center gap-2">
        <label className="cursor-pointer p-2 hover:bg-surface-100 dark:hover:bg-dark-700 rounded-lg transition">
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleImageUpload(file);
            }}
          />
          {imageUploading ? (
            <Loader2 className="w-4 h-4 text-amber-500 animate-spin" />
          ) : (
            <Image className="w-4 h-4 text-dark-400 dark:text-ivory-500" />
          )}
        </label>

        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSend()}
          placeholder="Мессеж бичих..."
          className="flex-1 px-3 py-2 text-xs bg-surface-50 dark:bg-dark-700 rounded-xl border border-silver/40 dark:border-dark-600 text-dark-800 dark:text-ivory-200 focus:outline-none focus:ring-1 focus:ring-amber-400"
        />

        <button
          onClick={handleSend}
          disabled={!input.trim() || sending}
          className="p-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition disabled:opacity-30"
        >
          {sending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Send className="w-4 h-4" />
          )}
        </button>
      </div>
    </div>
  );
}
