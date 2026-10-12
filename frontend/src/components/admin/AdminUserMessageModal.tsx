import { useEffect, useRef, useState } from "react";
import { CheckCircle2, MessageSquareText, Send, X } from "lucide-react";
import { sendUserMessage, type AdminUserMessageTemplate } from "../../api";

export interface MessageRecipient {
  id: number;
  name: string;
}

type SendState = "idle" | "sending" | "sent";

export function AdminUserMessageModal({
  recipient,
  template,
  onClose,
}: {
  recipient: MessageRecipient;
  template: AdminUserMessageTemplate;
  onClose: () => void;
}) {
  const [state, setState] = useState<SendState>("idle");
  const [error, setError] = useState<string | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sending = state === "sending";

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !sending) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, sending]);

  useEffect(() => () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, []);

  const handleSend = async () => {
    if (sending || state === "sent") return;
    setState("sending");
    setError(null);
    try {
      await sendUserMessage(recipient.id, template.id);
      setState("sent");
      closeTimer.current = setTimeout(onClose, 1400);
    } catch (err) {
      setState("idle");
      setError(err instanceof Error && err.message ? err.message : "Мессеж илгээж чадсангүй. Дахин оролдоно уу.");
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !sending) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-user-message-title"
        className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl dark:bg-dark-800"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 id="admin-user-message-title" className="flex items-center gap-2 text-base font-bold text-maroon-700">
              <MessageSquareText className="size-5 shrink-0" />
              Мессеж илгээх
            </h3>
            <p className="mt-1 truncate text-xs text-slate-500">
              {recipient.name} · ID: {recipient.id}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={sending}
            aria-label="Хаах"
            className="rounded-full p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 disabled:opacity-40"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="mt-4">
          <div className="mb-1.5 text-[0.7rem] font-semibold uppercase tracking-wide text-slate-400">
            Хэрэглэгчид очих мессеж
          </div>
          <div className="rounded-2xl rounded-tl-sm border border-sky-100 bg-sky-50 px-4 py-3 text-sm leading-relaxed text-slate-800 dark:border-dark-600 dark:bg-dark-700 dark:text-ivory-100">
            <p data-testid="message-preview" className="whitespace-pre-line">
              {template.preview}
            </p>
            {template.button_text && (
              <div className="mt-3 rounded-lg bg-sky-100 px-3 py-2 text-center text-xs font-semibold text-sky-700 dark:bg-dark-600 dark:text-sky-300">
                {template.button_text}
              </div>
            )}
          </div>
        </div>

        {error && (
          <div role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </div>
        )}
        {state === "sent" && (
          <div role="status" className="mt-3 flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-xs font-medium text-green-700">
            <CheckCircle2 className="size-4" /> Мессеж амжилттай илгээгдлээ
          </div>
        )}

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={sending}
            className="flex-1 rounded-xl border border-maroon-200 py-2.5 text-sm font-medium text-maroon-700 transition hover:bg-maroon-50 disabled:opacity-50"
          >
            Цуцлах
          </button>
          <button
            type="button"
            onClick={handleSend}
            disabled={sending || state === "sent"}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-maroon-600 py-2.5 text-sm font-bold text-white transition hover:bg-maroon-700 disabled:opacity-60"
          >
            <Send className="size-4" />
            {sending ? "Илгээж байна..." : "Илгээх"}
          </button>
        </div>
      </div>
    </div>
  );
}
