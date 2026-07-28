import { createClient } from "npm:@supabase/supabase-js@2";

const TELEGRAM_API = "https://api.telegram.org";
const RATE_IMAGE_URL =
  "https://ldolpsylyatkxqsgxhkn.supabase.co/storage/v1/object/public/Oyuns%20Finance/RATE_BOT.png";
const USERS_PAGE_SIZE = 1_000;
const TELEGRAM_BATCH_SIZE = 25;

type RateRecord = {
  id?: number;
  buy_rate: string | number;
  sell_rate: string | number;
};

const sleep = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

function formatRate(value: string | number): string {
  return Number(value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function datePart(timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function timePart(timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
}

function greeting(): string {
  const hour = Number(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Ulaanbaatar",
    hour: "2-digit",
    hour12: false,
  }).format(new Date()));
  if (hour >= 6 && hour < 12) return "Өглөөний мэнд";
  if (hour >= 12 && hour < 18) return "Өдрийн мэнд";
  return "Оройн мэнд";
}

function buildCaption(rate: RateRecord): string {
  return [
    `💸 <b>${greeting()}!</b>`,
    "",
    `📊 <b>ХАНШИЙН МЭДЭЭЛЭЛ. ${datePart("Asia/Ulaanbaatar")}, УБ: ${timePart("Asia/Ulaanbaatar")} | МСК: ${timePart("Europe/Moscow")}</b>`,
    "",
    `🔹 <b>Рубль авах</b>(РУБ-МНТ): <b>${formatRate(rate.buy_rate)}</b>`,
    `🔹 <b>Рубль зарах</b>(МНТ-РУБ): <b>${formatRate(rate.sell_rate)}</b>`,
    "",
    "💬  Хэрэв танд апп-тай холбоотой ямар нэгэн асуудал гарвал @oyuns_finance хаягаар холбогдоно уу.",
    "",
    "⚡️<b>OYUNS ALL-IN-ONE</b> – Илүү хялбар, илүү найдвартай, илүү хурдан",
    "",
    "Өдрийг сайхан өнгөрүүлээрэй ☀️",
  ].join("\n");
}

async function sendPhoto(chatId: number, caption: string, token: string): Promise<boolean> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(`${TELEGRAM_API}/bot${token}/sendPhoto`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, photo: RATE_IMAGE_URL, caption, parse_mode: "HTML" }),
    });
    if (response.ok) return true;

    const body = await response.json().catch(() => ({}));
    const retryAfter = Number(body?.parameters?.retry_after);
    if (response.status === 429 && Number.isFinite(retryAfter) && attempt < 3) {
      await sleep((retryAfter + 1) * 1_000);
      continue;
    }
    console.warn("Telegram delivery failed", { chatId, status: response.status, body });
    return false;
  }
  return false;
}

Deno.serve(async (request) => {
  const webhookSecret = Deno.env.get("RATE_BROADCAST_WEBHOOK_SECRET");
  if (!webhookSecret || request.headers.get("x-webhook-secret") !== webhookSecret) {
    return new Response("Unauthorized", { status: 401 });
  }

  const payload = await request.json().catch(() => null);
  const rate = payload?.record as RateRecord | undefined;
  if (!rate || !Number.isFinite(Number(rate.buy_rate)) || !Number.isFinite(Number(rate.sell_rate))) {
    return Response.json({ error: "Missing valid bot_rates record" }, { status: 400 });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const legacyServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}") as Record<string, string>;
  const serviceRoleKey = legacyServiceRoleKey ?? secretKeys.default;
  const telegramToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
  if (!supabaseUrl || !serviceRoleKey || !telegramToken) {
    console.error("Required Edge Function secrets are missing");
    return new Response("Server configuration error", { status: 500 });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const caption = buildCaption(rate);
  let offset = 0;
  let sent = 0;
  let failed = 0;

  while (true) {
    const { data: users, error } = await supabase
      .from("users")
      .select("id")
      .range(offset, offset + USERS_PAGE_SIZE - 1);
    if (error) {
      console.error("Unable to load broadcast recipients", error);
      return Response.json({ error: "Unable to load users", sent, failed }, { status: 500 });
    }
    if (!users?.length) break;

    for (let index = 0; index < users.length; index += TELEGRAM_BATCH_SIZE) {
      const results = await Promise.all(
        users.slice(index, index + TELEGRAM_BATCH_SIZE).map((user) =>
          sendPhoto(Number(user.id), caption, telegramToken)
        ),
      );
      sent += results.filter(Boolean).length;
      failed += results.filter((result) => !result).length;
      if (index + TELEGRAM_BATCH_SIZE < users.length) await sleep(1_000);
    }

    if (users.length < USERS_PAGE_SIZE) break;
    offset += USERS_PAGE_SIZE;
  }

  console.log("Rate broadcast completed", { rateId: rate.id, sent, failed });
  return Response.json({ sent, failed });
});
