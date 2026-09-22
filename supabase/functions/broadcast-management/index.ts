import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const ADMIN_SECRET = Deno.env.get("BROADCAST_ADMIN_SECRET")!;
const TIME_ZONE = "Asia/Ulaanbaatar";

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("BROADCAST_ALLOWED_ORIGIN") ?? "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-broadcast-admin-secret",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
};

type AudienceType = "all" | "active" | "segment";
type BroadcastAction = "history" | "rules" | "create_manual" | "send_manual" | "upsert_rule" | "archive_rule" | "delete_rule";

class BroadcastError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function restUrl(table: string, query = "") {
  return `${SUPABASE_URL}/rest/v1/${table}${query}`;
}

async function supabaseRequest<T>(table: string, init: RequestInit = {}, query = ""): Promise<T> {
  const response = await fetch(restUrl(table, query), {
    ...init,
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) throw new Error(`${table} request failed (${response.status}): ${await response.text()}`);
  return await response.json() as T;
}

function requireAdmin(request: Request) {
  const provided = request.headers.get("x-broadcast-admin-secret") || request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!ADMIN_SECRET || !provided || provided !== ADMIN_SECRET) throw new BroadcastError("Administrator access required", 401);
}

function validateAudience(value: unknown): AudienceType {
  if (value === "all" || value === "active" || value === "segment") return value;
  throw new BroadcastError("audience_type must be all, active, or segment");
}

function renderTemplate(template: string, user: Record<string, unknown>) {
  return template
    .replaceAll("{first_name}", String(user.first_name || "хэрэглэгч"))
    .replaceAll("{last_name}", String(user.last_name || ""))
    .replaceAll("{username}", String(user.username || ""));
}

function markdownToTelegramHtml(markdown: string) {
  const escaped = markdown.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  return escaped
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/_([^_]+)_/g, "<i>$1</i>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>');
}

async function telegramSend(userId: number, body: string, mediaUrl?: string) {
  const method = mediaUrl ? "sendPhoto" : "sendMessage";
  const payload = mediaUrl
    ? { chat_id: userId, photo: mediaUrl, caption: body, parse_mode: "HTML" }
    : { chat_id: userId, text: body, parse_mode: "HTML" };
  const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(result.description || `Telegram ${method} failed`);
  return result.result?.message_id as number | undefined;
}

async function recipientQuery(audienceType: AudienceType, audienceFilter: Record<string, unknown>) {
  let query = "?select=id,first_name,last_name,username,broadcast_active,broadcast_retry_at";
  if (audienceType === "active") query += "&broadcast_active=eq.true";
  if (audienceType === "segment" && typeof audienceFilter.segment === "string") query += `&admin_label=eq.${encodeURIComponent(audienceFilter.segment)}`;
  const users = await supabaseRequest<Array<Record<string, unknown>>>("users", {}, query);
  const now = Date.now();
  return users.filter((user) => {
    if (user.broadcast_active === false) return false;
    const retryAt = user.broadcast_retry_at ? Date.parse(String(user.broadcast_retry_at)) : 0;
    return !retryAt || retryAt <= now;
  });
}

async function createManual(payload: Record<string, unknown>, adminId: number | null) {
  const body = String(payload.body_markdown || "").trim();
  if (!body || body.length > 4000) throw new BroadcastError("body_markdown is required and must be 4,000 characters or less");
  const audienceType = validateAudience(payload.audience_type);
  const audienceFilter = (payload.audience_filter ?? {}) as Record<string, unknown>;
  const mediaUrl = payload.media_url ? String(payload.media_url) : null;
  const [broadcast] = await supabaseRequest<Array<Record<string, unknown>>>("broadcasts", { method: "POST", body: JSON.stringify({ broadcast_type: "manual", body_markdown: body, media_url: mediaUrl, audience_type: audienceType, audience_filter: audienceFilter, status: "queued", created_by: adminId }) });
  return broadcast;
}

async function sendManual(payload: Record<string, unknown>) {
  const broadcastId = String(payload.broadcast_id || "");
  if (!broadcastId) throw new BroadcastError("broadcast_id is required");
  const [broadcast] = await supabaseRequest<Array<Record<string, unknown>>>("broadcasts", {}, `?id=eq.${broadcastId}&select=*`);
  if (!broadcast) throw new BroadcastError("Broadcast not found", 404);
  const recipients = await recipientQuery(broadcast.audience_type as AudienceType, (broadcast.audience_filter ?? {}) as Record<string, unknown>);
  await supabaseRequest("broadcasts", { method: "PATCH", body: JSON.stringify({ status: "sending", total_recipients: recipients.length }) }, `?id=eq.${broadcastId}`);
  let delivered = 0;
  for (const user of recipients) {
    const userId = Number(user.id);
    let delivery: Record<string, unknown> = { broadcast_id: broadcastId, user_id: userId, status: "failed" };
    try {
      const messageId = await telegramSend(userId, markdownToTelegramHtml(renderTemplate(String(broadcast.body_markdown), user)), broadcast.media_url ? String(broadcast.media_url) : undefined);
      delivered += 1;
      delivery = { ...delivery, status: "delivered", telegram_message_id: messageId, delivered_at: new Date().toISOString() };
    } catch (error) {
      delivery.error_message = error instanceof Error ? error.message.slice(0, 1000) : "Telegram delivery failed";
    }
    await supabaseRequest("broadcast_deliveries", { method: "POST", body: JSON.stringify(delivery) });
  }
  const status = delivered === recipients.length ? "sent" : delivered ? "sent" : "failed";
  return (await supabaseRequest<Array<Record<string, unknown>>>("broadcasts", { method: "PATCH", body: JSON.stringify({ status, sent_at: new Date().toISOString(), delivered_count: delivered }) }, `?id=eq.${broadcastId}`))[0];
}

async function handle(request: Request) {
  requireAdmin(request);
  const url = new URL(request.url);
  const payload = request.method === "GET" ? Object.fromEntries(url.searchParams.entries()) : await request.json() as Record<string, unknown>;
  const action = String(payload.action || (url.pathname.endsWith("/history") ? "history" : url.pathname.endsWith("/rules") ? "rules" : "")) as BroadcastAction;
  if (!action) throw new Error("action is required");

  if (action === "history") {
    const limit = Math.min(Math.max(Number(payload.limit || 25), 1), 100);
    const offset = Math.max(Number(payload.offset || 0), 0);
    const rows = await supabaseRequest<Array<Record<string, unknown>>>("broadcasts", {}, `?select=*&order=created_at.desc&limit=${limit}&offset=${offset}`);
    return { items: rows, page: Math.floor(offset / limit) + 1, page_size: limit };
  }
  if (action === "rules") return { items: await supabaseRequest<Array<Record<string, unknown>>>("broadcast_rules", {}, "?select=*&order=slot.asc.nullslast,created_at.asc") };
  if (action === "create_manual") return await createManual(payload, payload.admin_id ? Number(payload.admin_id) : null);
  if (action === "send_manual") return await sendManual(payload);

  if (action === "upsert_rule") {
    const rule = (payload.rule ?? payload) as Record<string, unknown>;
    const body = { ...rule, audience_type: validateAudience(rule.audience_type), updated_by: rule.updated_by ? Number(rule.updated_by) : null };
    if (body.id === "00000000-0000-0000-0000-000000000001" || body.slot === 1) throw new BroadcastError("Current Rate Broadcast is protected", 409);
    const method = body.id ? "PATCH" : "POST";
    const query = body.id ? `?id=eq.${body.id}` : "";
    return (await supabaseRequest<Array<Record<string, unknown>>>("broadcast_rules", { method, body: JSON.stringify(body) }, query))[0];
  }
  if (action === "archive_rule" || action === "delete_rule") {
    const id = String(payload.id || "");
    if (!id || id === "00000000-0000-0000-0000-000000000001") throw new BroadcastError("Current Rate Broadcast is protected", 409);
    if (action === "archive_rule") return (await supabaseRequest<Array<Record<string, unknown>>>("broadcast_rules", { method: "PATCH", body: JSON.stringify({ status: "archived", archived_at: new Date().toISOString() }) }, `?id=eq.${id}`))[0];
    await supabaseRequest("broadcast_rules", { method: "DELETE" }, `?id=eq.${id}`);
    return { ok: true };
  }
  throw new Error(`Unsupported action: ${action}`);
}

serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    return json(await handle(request));
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : "Broadcast request failed" }, error instanceof BroadcastError ? error.status : 500);
  }
});
