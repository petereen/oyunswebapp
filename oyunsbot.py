import telebot
import telebot.apihelper
import datetime
import requests
import tempfile
import threading
import time as time_module
import os
import io
import string
import random
from datetime import date
from datetime import datetime, timedelta, time
from telebot.types import InlineKeyboardMarkup, InlineKeyboardButton, WebAppInfo
from supabase import create_client, Client
import os
import re

from zoneinfo import ZoneInfo
from math import ceil
from telebot.types import InputMediaPhoto
from typing import Dict, List, Set

from bot_translations import t

_admin_media_buffers: Dict[str, List[str]] = {}
_admin_media_flush_scheduled: Set[str] = set()

MOSCOW_TZ = ZoneInfo("Europe/Moscow")
MIN_RUB = 2000
MIN_RUB_TO_MNT = 100
UB_TZ = ZoneInfo("Asia/Ulaanbaatar")
MIN_VOLUME_RUB      = 50_000    # threshold in 
MIN_VOLUME_RUB_2      = 100_000
VOLUME_DISCOUNT_MNT = 0.2       # in MNT
VOLUME_DISCOUNT_MNT_2 = 0.3
FESTIVE_GIF_URL = "https://media1.giphy.com/media/v1.Y2lkPTc5MGI3NjExNjJtemZkN3RvcXk0YWdmOHd4YWEybGk4YjZrd28xNmYxZnZuaXZ4aiZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/4qJYOwVeMFKPpXLu8f/giphy.gif"


def sanitize_markdown(text: str) -> str:
    if not text:
        return ""
    # Escape Markdown (v1) specials that commonly break captions
    return re.sub(r'([_*`\[\]\(\)])', r'\\\1', str(text))
    
def is_within_ub_business_hours():
    now_ub = datetime.now(MOSCOW_TZ).time()
    start = time(4, 0)           # not time(04, 00)
    end   = time(22, 59)     # up until 22:59:59
    return start <= now_ub <= end

# Replace with your bot token
BOT_TOKEN = os.getenv("BOT_TOKEN", "").strip().replace('"', '').replace("'", "")
WEBAPP_URL = os.getenv("WEBAPP_URL", "https://app.oyuns.mn")
bot = telebot.TeleBot(BOT_TOKEN)


SUPABASE_URL = "https://ldolpsylyatkxqsgxhkn.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxkb2xwc3lseWF0a3hxc2d4aGtuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0Mjc1OTg4MSwiZXhwIjoyMDU4MzM1ODgxfQ.LgsjFKhMoLc5mDeb_3jg9b745JaEavdBBBOjPXlds7o"
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)


# Replace with the Operator's Telegram User ID
#OPERATOR_CHAT_ID = 1932946217 # Change to real operator ID
#ADMIN_IDS = 1932946217
HIGH_VALUE_OPERATOR_CHAT_ID = 1447446407
ALWAYS_NOTIFY_OPERATOR_ID = [1932946217, 1447446407]
ALLOWED_ADMINS = {1932946217, 1447446407, 5564298862, 1409343588, 6351681039}  #pending_users
MODERATOR_ID = 1920453419  # Moderator for referral confirmations
#1447446407 Surnee ah
#1932946217 Temuulen Ochirbat
#BANK_DETAILS_MNT = "🏦 ХААН БАНК\n Дансны нэр: СҮРЭНЖАВ\nДансны IBAN дугаар: IBAN MN750005005313286273\nДансны дугаар: `5313286273`\n"
#BANK_DETAILS_RUB = "🏦 СБЕРБАНК\n Дансны нэр: XXX\nДансны дугаар: 500XXXXXX"

# Global variables for operator and bank details (set dynamically from config)
OPERATOR_CHAT_ID = None
BANK_DETAILS_RUB = None
BANK_DETAILS_MNT = None
CONTACT_SUPPORT = "📞 Холбоо барих: +976 7230 3060\n +7 (977) 801-91-43\n [https://t.me/oyuns_finance]"
REFERRAL_REQUIRED_COUNT = 5  # Number of friends needed to invite

# Target referral destination (channel / group)
REFERRAL_TARGET_CHAT_ID = -1001239835606

# Hardcoded referral channels (kept for legacy username-based checks)
REFERRAL_CHANNELS = [
    "@oyuns_alo",        # https://t.me/oyuns_alo
    REFERRAL_TARGET_CHAT_ID,
]

# In-memory caches for invite link ↔ referrer mapping
invite_link_to_referrer: Dict[str, int] = {}
referrer_to_invite_link: Dict[int, str] = {}

# ── Language helpers ──
_lang_cache: Dict[int, str] = {}

def get_user_lang(user_id: int) -> str:
    """Return the user's preferred language ('mn' or 'ru'). Cached in memory."""
    if user_id in _lang_cache:
        return _lang_cache[user_id]
    try:
        resp = supabase.table("users").select("lang").eq("id", user_id).execute()
        lang = (resp.data[0].get("lang") or "mn") if resp.data else "mn"
    except Exception:
        lang = "mn"
    _lang_cache[user_id] = lang
    return lang

def set_user_lang(user_id: int, lang: str) -> None:
    """Persist language choice and update cache."""
    lang = lang if lang in ("mn", "ru") else "mn"
    _lang_cache[user_id] = lang
    try:
        supabase.table("users").upsert({"id": user_id, "lang": lang}).execute()
    except Exception as e:
        print(f"⚠️ Failed to save lang for {user_id}: {e}")

def check_user_is_member(username_or_id) -> bool:
    """Check if a user is a member of any referral channel.
    Args:
        username_or_id: Can be username string, user_id int, or user object
    """
    try:
        # Extract user_id if username_or_id is a string, int, or user object
        user_id = None
        username = None
        
        if isinstance(username_or_id, int):
            user_id = username_or_id
        elif isinstance(username_or_id, str):
            # Try to parse as integer first (user ID)
            username_clean = username_or_id.replace('@', '').strip()
            try:
                user_id = int(username_clean)
            except ValueError:
                # It's a username, need to resolve it to user_id
                username = username_clean
                try:
                    chat_info = bot.get_chat(f"@{username_clean}")
                    user_id = chat_info.id
                except Exception as e:
                    print(f"⚠️ Could not resolve username {username_clean} to user_id: {e}")
        else:
            # Assume it's a user object
            try:
                user_id = username_or_id.id
                username = username_or_id.username if hasattr(username_or_id, 'username') else None
            except:
                pass
        
        # Check membership in all referral channels
        for channel in REFERRAL_CHANNELS:
            try:
                # Prefer user_id for checking (works for both channels and groups)
                if user_id:
                    try:
                        member_info = bot.get_chat_member(channel, user_id)
                        status = member_info.status
                        if status in ['member', 'administrator', 'creator']:
                            print(f"✅ User {user_id} is a member of {channel}")
                            return True
                    except telebot.apihelper.ApiTelegramException as e:
                        if e.error_code == 400:  # User not found or not a member
                            continue
                        print(f"❌ API Error checking membership for user_id {user_id} in {channel}: {e}")
                        continue
                    except Exception as e:
                        print(f"❌ Error checking membership for user_id {user_id} in {channel}: {e}")
                        continue

                # Fallback to username-based lookup if user_id check failed and we have a username
                if username:
                    try:
                        member_info = bot.get_chat_member(channel, username)
                        status = member_info.status
                        if status in ['member', 'administrator', 'creator']:
                            print(f"✅ User @{username} is a member of {channel}")
                            return True
                    except telebot.apihelper.ApiTelegramException as e:
                        if e.error_code == 400:  # User not found or not a member
                            continue
                        print(f"❌ API Error checking membership for @{username} in {channel}: {e}")
                        continue
                    except Exception as e:
                        print(f"❌ Error checking membership for @{username} in {channel}: {e}")
                        continue
            except Exception as e:
                print(f"❌ Unexpected error checking membership in {channel}: {e}")
                continue
        
        # User is not a member of any channel
        print(f"⚠️ User {user_id or username} is not a member of any referral channel")
        return False
    except Exception as e:
        print(f"❌ Error in check_user_is_member: {e}")
        return False

def ensure_admin_available(chat_id: int) -> bool:
    admin_id = get_current_admin_id()
    if not admin_id:
        lang = get_user_lang(chat_id)
        bot.send_message(chat_id, t(lang, "not_working"))
        return False
    return True
def ensure_exchange_available(chat_id: int) -> bool:
    if not ensure_admin_available(chat_id):
        clear_state(chat_id)
        return False
    return True
    
# Admin reminder: prompt to log bank remainder
def prompt_admin_bank_remainder(admin_id: int, context: str = "shift") -> None:
    """Send the admin a reminder to log their bank account remainder with link."""
    try:
        lang = get_user_lang(admin_id)
        text = t(lang, "admin_shift_bank_reminder")
        markup = InlineKeyboardMarkup()
        markup.add(InlineKeyboardButton(
            t(lang, "admin_shift_bank_btn"),
            url="https://oyunsadmin.pages.dev/"
        ))
        bot.send_message(admin_id, text, reply_markup=markup)
    except Exception as e:
        print(f"❌ Failed to send bank remainder prompt to admin {admin_id} ({context}): {e}")
    
def update_user_session(user_id, data: dict):
    existing = get_user_session(user_id)
    existing.update(data)
    existing["user_id"] = user_id
    existing["last_updated"] = datetime.utcnow().isoformat()
    supabase.table("user_sessions").upsert(existing).execute()

def get_user_session(user_id):
    try:
        result = supabase.table("user_sessions").select("*").eq("user_id", user_id).limit(1).execute()
        return result.data[0] if result.data else {}
    except Exception as e:
        print(f"Error getting user session for {user_id}: {e}")
        return {}


def get_state(user_id):
    session = get_user_session(user_id)
    return session.get("state") or ""

def clear_state(user_id):
    supabase.table("user_sessions").update({"state": None}).eq("user_id", user_id).execute()


EXCHANGE_FLOW_TOKEN_LENGTH = 8


def _generate_exchange_flow_token() -> str:
    chars = string.ascii_lowercase + string.digits
    return "".join(random.choices(chars, k=EXCHANGE_FLOW_TOKEN_LENGTH))


def _begin_exchange_amount_selection(user_id: int, currency: str) -> str:
    flow_token = _generate_exchange_flow_token()
    update_user_session(user_id, {
        "state": f"awaiting_exchange_amount_{currency}",
        "exchange_flow_token": flow_token,
    })
    return flow_token


def _answer_stale_exchange_button(call) -> None:
    lang = get_user_lang(call.message.chat.id)
    bot.answer_callback_query(call.id, t(lang, "exchange_button_expired"), show_alert=True)


def _validate_exchange_button(call, expected_states, flow_token):
    if isinstance(expected_states, str):
        expected_states = {expected_states}
    else:
        expected_states = set(expected_states)

    session = get_user_session(call.message.chat.id)
    current_state = session.get("state")
    current_token = session.get("exchange_flow_token")
    if current_state not in expected_states or not flow_token or current_token != flow_token:
        _answer_stale_exchange_button(call)
        return None
    return session


def _build_rub_bank_markup(user_id: int, flow_token: str):
    config = get_current_shift_config() or {}
    rub_bank_options = config.get("rub_bank_options", {})
    if not rub_bank_options:
        return None

    markup = InlineKeyboardMarkup()
    bank_map = {}
    for idx, (bank_label, bank_details) in enumerate(rub_bank_options.items()):
        key = f"b{idx}"
        bank_map[key] = bank_details
        markup.add(InlineKeyboardButton(bank_label, callback_data=f"rubmnt_bank_{key}_{flow_token}"))

    update_user_session(user_id, {"rub_bank_map": bank_map})
    return markup


def has_active_webapp_requests(user_id: int) -> bool:
    """Check whether user has active requests in exchange/gift/fuel flows."""
    tx_statuses = ["pending", "approved", "waiting_edit"]
    gift_statuses = ["pending_recipient", "pending_admin", "approved", "preapproved"]
    fuel_statuses = ["pending_payment", "pending", "paid", "approved", "in_progress", "fueling_complete"]

    try:
        tx_res = (
            supabase
            .table("transactions")
            .select("id")
            .eq("user_id", user_id)
            .in_("status", tx_statuses)
            .limit(1)
            .execute()
        )
        if tx_res.data:
            return True
    except Exception as e:
        print(f"⚠️ Failed to check active transactions for {user_id}: {e}")

    try:
        sender_gifts = (
            supabase
            .table("gifts")
            .select("id")
            .eq("sender_user_id", user_id)
            .in_("status", gift_statuses)
            .limit(1)
            .execute()
        )
        if sender_gifts.data:
            return True
    except Exception as e:
        print(f"⚠️ Failed to check sender gifts for {user_id}: {e}")

    try:
        recipient_gifts = (
            supabase
            .table("gifts")
            .select("id")
            .eq("recipient_user_id", user_id)
            .in_("status", gift_statuses)
            .limit(1)
            .execute()
        )
        if recipient_gifts.data:
            return True
    except Exception as e:
        print(f"⚠️ Failed to check recipient gifts for {user_id}: {e}")

    try:
        fuel_res = (
            supabase
            .table("fuel_orders")
            .select("id")
            .eq("user_id", user_id)
            .in_("status", fuel_statuses)
            .limit(1)
            .execute()
        )
        if fuel_res.data:
            return True
    except Exception as e:
        print(f"⚠️ Failed to check fuel orders for {user_id}: {e}")

    return False

#HEREGLEGCHIIN GEREE

def ask_terms_agreement(chat_id):
    lang = get_user_lang(chat_id)
    markup = InlineKeyboardMarkup()
    markup.add(InlineKeyboardButton(t(lang, "btn_terms_link"), url="https://oyuns.mn/user-agreement"))
    markup.add(InlineKeyboardButton(t(lang, "btn_terms_accept"), callback_data="accept_terms"))
    bot.send_message(chat_id, t(lang, "terms_prompt"), parse_mode="Markdown", reply_markup=markup)
def has_agreed_terms(user_id):
    response = supabase.table("users").select("agreed_terms").eq("id", user_id).execute()
    return response.data and response.data[0]['agreed_terms'] == True
    
def set_agreed_terms(user_id):
    # Ensure user row exists before update
    response = supabase.table("users").select("id").eq("id", user_id).execute()
    if not response.data:
        supabase.table("users").insert({"id": user_id}).execute()

    supabase.table("users").update({"agreed_terms": True}).eq("id", user_id).execute()



@bot.callback_query_handler(func=lambda call: call.data == "accept_terms")
def handle_terms_accept(call):
    user_id = call.from_user.id
    set_agreed_terms(user_id)
    lang = get_user_lang(user_id)
    bot.answer_callback_query(call.id, t(lang, "terms_accepted_alert"))
    bot.send_message(call.message.chat.id, t(lang, "terms_accepted_msg"))
    def delayed_start():
        time_module.sleep(1.0)  # Let Supabase commit finish
        handle_start(call.message)

    threading.Thread(target=delayed_start).start()

@bot.message_handler(commands=['geree'])
def terms_handler(message):
  lang = get_user_lang(message.chat.id)
  markup = InlineKeyboardMarkup()
  markup.add(InlineKeyboardButton(t(lang, "btn_terms_link"), url="https://oyuns.mn/user-agreement"))
  bot.send_message(message.chat.id, t(lang, "terms_view"), reply_markup=markup)
    
#-------------------GUILGEENII TUUH----------------------
PAGE_SIZE = 5  # items per page

def format_ub(dt_str: str) -> str:
    # your transactions.timestamp is UTC ISO without TZ
    try:
        dt = datetime.fromisoformat(dt_str)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=ZoneInfo("UTC"))
        return dt.astimezone(UB_TZ).strftime("%Y-%m-%d %H:%M")
    except Exception:
        return dt_str[:16] if dt_str else "-"

def compute_converted(txn) -> tuple[float, str]:
    amt  = float(txn["amount"])
    rate = float(txn["rate"])
    cf   = txn["currency_from"].upper()
    if cf == "RUB":
        return round(amt * rate, 2), "MNT"
    else:
        return round(amt / rate, 2), "RUB"




@bot.message_handler(commands=["shift_status"])
def show_current_shift_admin(message):
    if message.from_user.id not in ALLOWED_ADMINS:
        return

    lang_a = get_user_lang(message.from_user.id)
    current_admin_id = get_current_admin_id()
    if current_admin_id:
        bot.send_message(
            message.chat.id,
            t(lang_a, "admin_shift_status_current", admin_id=current_admin_id),
            parse_mode="Markdown"
        )
    else:
        bot.send_message(message.chat.id, t(lang_a, "admin_shift_not_assigned"))



def _format_bank_account(row):
    """Format a bank account row from admin_bank_accounts into Telegram Markdown."""
    bank_name = row.get("bank_name", "")
    owner_name = row.get("owner_name", "")
    card_number = row.get("card_number", "")
    phone = row.get("phone", "")
    account_number = row.get("account_number", "")
    currency = row.get("currency", "")

    lines = [f"🏦 *{bank_name}*\n"]
    if currency == "RUB":
        if card_number:
            lines.append(f"Картын дугаар: `{card_number}`")
        if phone:
            lines.append(f"Утасны дугаар: `{phone}`")
        if owner_name:
            lines.append(f"Дансны нэр: *{owner_name}*")
    else:  # MNT
        if owner_name:
            lines.append(f"Дансны нэр: *{owner_name}*")
        if account_number:
            lines.append(f"Данс: `{account_number}`")
    return "\n".join(lines)


def get_current_shift_config():
    admin_id = get_current_admin_id()
    if not admin_id:
        return None

    # Fetch active bank accounts from admin_bank_accounts table, filtered by current admin
    try:
        # First try to get accounts assigned to this specific admin
        res = (
            supabase
            .table("admin_bank_accounts")
            .select("*")
            .eq("is_active", True)
            .eq("admin_id", admin_id)
            .order("display_order", desc=False)
            .order("created_at", desc=False)
            .execute()
        )
        accounts = res.data or []
        
        # Fallback: if no accounts assigned to this admin, get accounts with no admin_id (shared accounts)
        if not accounts:
            res = (
                supabase
                .table("admin_bank_accounts")
                .select("*")
                .eq("is_active", True)
                .is_("admin_id", "null")
                .order("display_order", desc=False)
                .order("created_at", desc=False)
                .execute()
            )
            accounts = res.data or []
    except Exception as e:
        print(f"❌ Failed to fetch admin bank accounts: {e}")
        return None

    if not accounts:
        return None

    # Separate by currency
    rub_accounts = [a for a in accounts if a.get("currency") == "RUB"]
    mnt_accounts = [a for a in accounts if a.get("currency") == "MNT"]

    # Build RUB bank options dict (bank_name -> formatted Markdown)
    rub_options = {}
    for row in rub_accounts:
        label = row.get("bank_name", "Банк")
        # Ensure unique labels by appending owner name if duplicate
        if label in rub_options:
            label = f"{label} ({row.get('owner_name', '')})"
        rub_options[label] = _format_bank_account(row)

    # First RUB account as default
    bank_rub = _format_bank_account(rub_accounts[0]) if rub_accounts else None

    # Combine all MNT accounts into one display string
    if mnt_accounts:
        bank_mnt = "\n\n".join(_format_bank_account(a) for a in mnt_accounts)
    else:
        bank_mnt = None

    return {
        "operator_id": admin_id,
        "bank_rub": bank_rub,
        "bank_mnt": bank_mnt,
        "rub_bank_options": rub_options
    }


# This handler is removed - using direct handlers for BUY_RATE and SELL_RATE instead
# @bot.callback_query_handler(func=lambda call: call.data in ["BUY_RATE", "SELL_RATE"])
# def handle_exchange_direction(call):
#     ... (removed to avoid conflict with specific handlers)


# Store user states, profiles, and transactions
user_amounts = {}  # Stores the entered amount
user_profiles = {}  # {user_id: {"bank_details": "..."}}
pending_transactions = {}  # {user_id: {"invoice": "...", "bank_details": "...", "receipt_id": ...}}
pending_referral_confirmations = {}  # {mod_message_id: {"user_id": int, "expected_awards": int}}
user_transaction_session = {}
user_invoice = {}
transaction_counter = 1  # Tracks daily transactions
exchange_rates = {}  # To store rates dynamically
invoice_user_map = {}
user_feedback_state = {}
pending_morning_alerts = []




#Function to Get/Set Current Shift Admin
def get_current_admin_id():
    try:
        response = supabase.table("admin_shifts").select("current_admin_id").limit(1).execute()
        if response.data:
            return response.data[0]["current_admin_id"]
    except Exception as e:
        print(f"❌ Failed to fetch current admin: {e}")
    return None

def log_admin_activity(action_type: str, performed_by_admin_id: int, target_admin_id=None, previous_admin_id=None, is_automatic=False):
    """
    Log admin shift activity to Supabase.
    
    Args:
        action_type: "opened", "closed", or "transferred"
        performed_by_admin_id: ID of admin who performed the action
        target_admin_id: ID of admin who received the shift (for transfers/opens)
        previous_admin_id: ID of previous admin (for transfers)
        is_automatic: Whether the action was automatic (scheduled) or manual
    """
    try:
        log_data = {
            "action_type": action_type,
            "performed_by_admin_id": performed_by_admin_id,
            "is_automatic": is_automatic,
            "timestamp": datetime.utcnow().isoformat()
        }
        
        if target_admin_id is not None:
            log_data["target_admin_id"] = target_admin_id
        if previous_admin_id is not None:
            log_data["previous_admin_id"] = previous_admin_id
            
        supabase.table("admin_activity_logs").insert(log_data).execute()
        print(f"✅ Admin activity logged: {action_type} by {performed_by_admin_id}")
    except Exception as e:
        print(f"❌ Failed to log admin activity: {e}")

def notify_pending_transaction_users_about_shift_change(message_text: str) -> int:
    try:
        response = supabase.table("transactions").select("user_id").eq("status", "pending").execute()
    except Exception as e:
        print(f"❌ Failed to fetch pending transactions for shift notification: {e}")
        return 0

    notified_user_ids = set()
    for row in response.data or []:
        user_id = row.get("user_id")
        if user_id is None:
            continue
        try:
            user_id_int = int(user_id)
        except (TypeError, ValueError):
            continue
        if user_id_int in notified_user_ids:
            continue

        notified_user_ids.add(user_id_int)
        try:
            bot.send_message(user_id_int, message_text, parse_mode="HTML")
        except Exception as e:
            print(f"❌ Failed to notify pending transaction user {user_id_int}: {e}")

    return len(notified_user_ids)


def set_current_admin_id(new_admin_id, performed_by_admin_id=None, is_automatic=False):
    try:
        # Get previous admin before updating
        previous_admin_id = get_current_admin_id()
        
        supabase.table("admin_shifts").update({
            "current_admin_id": new_admin_id,
            "last_updated": datetime.utcnow().isoformat()
        }).eq("id", 1).execute()  # 👈 "id" нь 1 гэж шууд зааж байна

        # Log the activity
        if new_admin_id is not None:
            # Determine action type
            if previous_admin_id is None:
                action_type = "opened"
            else:
                action_type = "transferred"
            
            # Use provided performed_by_admin_id or default to new_admin_id
            log_performed_by = performed_by_admin_id if performed_by_admin_id is not None else new_admin_id
            
            log_admin_activity(
                action_type=action_type,
                performed_by_admin_id=log_performed_by,
                target_admin_id=new_admin_id,
                previous_admin_id=previous_admin_id,
                is_automatic=is_automatic
            )

        shift_change_message = (
            "Уучлаарай, ээлж солигдож буй тул та түр хүлээнэ үү. "
            "Таны гүйлгээг удахгүй хийх болно."
        )
        notify_pending_transaction_users_about_shift_change(shift_change_message)

        print(f"✅ Admin shift transferred to {new_admin_id}")
        return True
    except Exception as e:
        print(f"❌ Failed to set current admin: {e}")
        return False


@bot.message_handler(commands=["eelj"])
def shift_control(message):
    if message.from_user.id not in ALLOWED_ADMINS:
        return

    current_admin_id = get_current_admin_id()

    try:
        if current_admin_id:
            current_admin_chat = bot.get_chat(current_admin_id)
            current_admin_name = current_admin_chat.first_name
            if current_admin_chat.last_name:
                current_admin_name += f" {current_admin_chat.last_name}"
            current_admin_display = f"[{current_admin_name}](tg://user?id={current_admin_id})"
        else:
            lang = get_user_lang(message.from_user.id)
            current_admin_display = t(lang, "admin_shift_closed")
    except Exception as e:
        print(f"❌ Couldn't fetch chat info: {e}")
        current_admin_display = "❓"

    # Inline buttons
    markup = InlineKeyboardMarkup()

    lang = get_user_lang(message.from_user.id)
    for admin_id in ALLOWED_ADMINS:
        if admin_id != current_admin_id:
            try:
                admin_chat = bot.get_chat(admin_id)
                name = admin_chat.first_name
                if admin_chat.last_name:
                    name += f" {admin_chat.last_name}"
            except:
                name = str(admin_id)
            markup.add(InlineKeyboardButton(t(lang, "admin_shift_transfer_btn", name=name), callback_data=f"shift_to_{admin_id}"))

    if current_admin_id:
        markup.add(InlineKeyboardButton(t(lang, "admin_shift_close_btn"), callback_data="shift_close"))
    else:
        markup.add(InlineKeyboardButton(t(lang, "admin_shift_open_btn"), callback_data=f"shift_to_{message.from_user.id}"))

    bot.send_message(
        message.chat.id,
        t(lang, "admin_shift_current", admin=current_admin_display),
        parse_mode="Markdown",
        reply_markup=markup
    )

@bot.callback_query_handler(func=lambda call: call.data.startswith("shift_to_"))
def transfer_shift(call):
    if call.from_user.id not in ALLOWED_ADMINS:
        return bot.answer_callback_query(call.id, t(get_user_lang(call.from_user.id), "admin_shift_unauthorized"), show_alert=True)

    # Capture current (previous) admin before transfer
    previous_admin_id = get_current_admin_id()
    new_admin_id = int(call.data.replace("shift_to_", ""))
    success = set_current_admin_id(new_admin_id, performed_by_admin_id=call.from_user.id, is_automatic=False)
    if success:
        lang = get_user_lang(call.from_user.id)
        bot.edit_message_text(
            t(lang, "admin_shift_transferred", id=new_admin_id),
            call.message.chat.id,
            call.message.message_id,
            parse_mode="Markdown"
        )
        # Prompt the previous admin to log their bank remainder
        if previous_admin_id:
            prompt_admin_bank_remainder(previous_admin_id, context="transfer")
    else:
        bot.answer_callback_query(call.id, "❌ Алдаа гарлаа.")


@bot.callback_query_handler(func=lambda call: call.data == "shift_close")
def close_shift_callback(call):
    if call.from_user.id not in ALLOWED_ADMINS:
        return bot.answer_callback_query(call.id, t(get_user_lang(call.from_user.id), "admin_shift_unauthorized"), show_alert=True)

    try:
        previous_admin_id = get_current_admin_id()
        supabase.table("admin_shifts").update({
            "current_admin_id": None,
            "last_updated": datetime.utcnow().isoformat()
        }).eq("id", 1).execute()
        
        log_admin_activity(
            action_type="closed",
            performed_by_admin_id=call.from_user.id,
            previous_admin_id=previous_admin_id,
            is_automatic=False
        )
        
        lang = get_user_lang(call.from_user.id)
        bot.edit_message_text(
            t(lang, "admin_shift_closed_msg"),
            call.message.chat.id,
            call.message.message_id
        )

        shift_change_message = (
            "Уучлаарай, ээлж солигдож буй тул та түр хүлээнэ үү. "
            "Таны гүйлгээг удахгүй хийх болно."
        )
        notify_pending_transaction_users_about_shift_change(shift_change_message)
        # Prompt the closing admin to log their bank remainder
        if previous_admin_id:
            prompt_admin_bank_remainder(previous_admin_id, context="close")
    except Exception as e:
        print(f"❌ Failed to close shift: {e}")
        bot.answer_callback_query(call.id, t(get_user_lang(call.from_user.id), "admin_shift_close_error"))


def get_current_shift_operator_id():
    return get_current_admin_id() or ALWAYS_NOTIFY_OPERATOR_ID[0]  # Fallback


# ✅ Fetch Exchange Rates from Supabase
def fetch_exchange_rates():
    try:
        response = supabase.table("bot_rates").select("buy_rate, sell_rate").order("updated_at", desc=True).limit(1).execute()
        rates = response.data[0]  # Get latest exchange rate

        exchange_rates["BUY_RATE"] = float(rates["buy_rate"])
        exchange_rates["SELL_RATE"] = float(rates["sell_rate"])
        print(f"✅ Ханш амжилттай шинэчлэгдлээ: BUY_RATE = {exchange_rates['BUY_RATE']}, SELL_RATE = {exchange_rates['SELL_RATE']}")
    except Exception as e:
        print(f"❌ Failed to fetch exchange rates: {e}")

# ✅ Fetch the Latest Invoice Number from Supabase
def get_latest_invoice_number():
    try:
        response = supabase.table("transactions").select("invoice").order("timestamp", desc=True).limit(1).execute()
        if response.data:
            latest_invoice = response.data[0]["invoice"]
            match = re.search(r"_(\d+)$", latest_invoice)  # Extract the last number
            if match:
                return int(match.group(1))  # Return the extracted number
        return 0  # If no transactions exist, start from 0
    except Exception as e:
        print(f"❌ Failed to fetch latest invoice: {e}")
        return 0

#FETCH PROMO CODES
def get_promo_discount_from_db(user_input: str):
    user_input = user_input.lower().strip()

    try:
        # Fetch all active promo codes (case-insensitive matching)
        response = supabase.table("promo_codes").select("code, aliases, discount, active").eq("active", True).execute()
        for promo in response.data:
            # Case-insensitive matching: compare lowercase versions
            valid_keys = [promo["code"].lower()] + [alias.lower() for alias in promo.get("aliases") or []]
            if user_input in valid_keys:
                discount = float(promo["discount"]) if promo["discount"] is not None else 0.0
                # Update promo code status to FALSE when used (one-time use)
                # One-time use promo codes have discount = 0.2
                if promo["discount"] == 0.2:
                    try:
                        # Update using the original case of the code
                        supabase.table("promo_codes").update({"active": False}).eq("code", promo["code"]).execute()
                        print(f"✅ Promo code {promo['code']} marked as used (inactive)")
                    except Exception as e:
                        print(f"❌ Failed to update promo code status: {e}")
                return discount
    except Exception as e:
        print(f"❌ Failed to fetch promo codes: {e}")

    return 0.0

def generate_promo_code():
    """Generate a random 10-character promo code (letters and numbers, case insensitive)"""
    characters = string.ascii_letters + string.digits
    return ''.join(random.choice(characters) for _ in range(10))

def create_promo_code_in_db(code: str, user_id: int, discount: float = 0.2, source: str = None):
    """Create a one-time use promo code in the database with user_id.

    Args:
        code: Promotion code string
        user_id: Telegram user id who receives the code
        discount: discount amount
        source: optional string to mark the origin of the promo (e.g., 'referral', 'system', 'admin')
    """
    try:
        now = datetime.now(MOSCOW_TZ).isoformat()
        data = {
            "code": code.upper(),  # Store in uppercase for consistency
            "aliases": [],
            "discount": discount,
            "active": True,
            "user_id": user_id,  # Store user telegram id
            "created_at": now,
            "expires_at": None  # One-time use codes don't expire by date
        }
        if source:
            data["source"] = source
        supabase.table("promo_codes").insert(data).execute()
        return True
    except Exception as e:
        print(f"❌ Failed to create promo code: {e}")
        return False


def choose_gift_outcome() -> str:
    """Pick a gift outcome using weighted probabilities that sum to 100%."""
    roll = random.random() * 100
    weighted_outcomes = [
        ("cash_prize_1000", 0.5),
        ("promo_0_5", 10.0),
        ("spin_again", 30.0),
        ("promo_0_3", 20.0),
        ("promo_0_2", 30.0),
        ("no_prize", 9.5),
    ]

    cumulative = 0.0
    for outcome, weight in weighted_outcomes:
        cumulative += weight
        if roll <= cumulative:
            return outcome
    return weighted_outcomes[-1][0]


# ✅ Generate Unique Invoice ID With Random Digits
def generate_invoice():
    import random
    # Москвагийн цаг = UTC + 3
    moscow_time = datetime.utcnow() + timedelta(hours=3)
    # Новый формат: YYYYMMDD-HHMMSS-XX где XX - случайное число от 00 до 99
    random_suffix = random.randint(0, 99)
    invoice = moscow_time.strftime("%Y%m%d-%H%M%S") + f"-{random_suffix:02d}"  # Жишээ: 20250421-194532-42
    return invoice

# ✅ Функция для проверки формата инвойса (поддерживает оба формата)
def is_valid_invoice_format(invoice_id):
    """
    Проверяет, является ли строка валидным номером инвойса.
    Поддерживает оба формата:
    - Старый: YYYYMMDD_HHMMSS
    - Новый: YYYYMMDD-HHMMSS-XX
    """
    if not invoice_id:
        return False
    
    # Проверяем новый формат: YYYYMMDD-HHMMSS-XX
    if re.fullmatch(r"\d{8}-\d{6}-\d{2}", invoice_id):
        return True
    
    # Проверяем старый формат: YYYYMMDD_HHMMSS
    if re.fullmatch(r"\d{8}_\d{6}", invoice_id):
        return True
    
    return False

# ✅ Функция для нормализации формата инвойса
def normalize_invoice_format(invoice_id):
    """
    Конвертирует старый формат в новый, если необходимо.
    Старый: YYYYMMDD_HHMMSS -> YYYYMMDD-HHMMSS-00
    Новый: YYYYMMDD-HHMMSS-XX -> остается без изменений
    """
    if not invoice_id:
        return None
    
    # Если это старый формат, конвертируем в новый
    if re.fullmatch(r"\d{8}_\d{6}", invoice_id):
        return invoice_id.replace("_", "-") + "-00"
    
    # Если это новый формат, возвращаем как есть
    if re.fullmatch(r"\d{8}-\d{6}-\d{2}", invoice_id):
        return invoice_id
    
    return None

# 🎁 Award gift for qualifying transactions (disabled)
def award_gift_for_transaction(user_id: int, amount: float, currency_from: str, currency_to: str, rate: float):
    return False


# ✅ Function to Record Transactions in Supabase
def record_transaction(user_id, invoice_id, amount, currency_from, currency_to, rate, bank_details, status="pending", promo_code=None):

    try:
        if not exchange_rates.get("BUY_RATE") or not exchange_rates.get("SELL_RATE"):
            fetch_exchange_rates()
    except Exception as _:
        pass  # fail-soft; will still insert without crashing

    current_buy = float(exchange_rates.get("BUY_RATE") or 0)
    current_sell = float(exchange_rates.get("SELL_RATE") or 0)
    
    # If there's a pending receipt timestamp for this user (user uploaded receipt earlier), include it
    pending = pending_transactions.get(user_id, {})
    receipt_ts = pending.get("receipt_submitted_at")

    data = {
        "user_id":        user_id,
        "invoice":        invoice_id,
        "amount":         amount,
        "currency_from":  currency_from,
        "currency_to":    currency_to,
        "rate":           rate,            # your FINAL applied rate (after promo/volume)
        "buy_rate":       current_buy,     # base RUB→MNT rate at the moment of logging
        "sell_rate":      current_sell,    # base MNT→RUB rate at the moment of logging
        "bank_details":   bank_details,
        "status":         status,
        "timestamp":      datetime.utcnow().isoformat()
    }
    if receipt_ts:
        data["receipt_submitted_at"] = receipt_ts
    
    # Add promo_code if provided
    if promo_code:
        data["promo_code"] = promo_code
    
    print("📦 Data to insert:", data)
    try:
        response = supabase.table("transactions").insert(data).execute()
        print("✅ Insert successful:", response)
        return response
    except Exception as e:
        print("❌ Supabase insert error:", e)
        raise

def get_user_transactions(user_id):
    response = supabase.table("transactions").select("*").eq("user_id", user_id).execute()
    return response.data

     # ✅ **Update Transaction Status in Supabase**
def update_transaction_status(user_id, status):
    try:
        # Find the user's latest transaction (matching user_id)
        invoice = pending_transactions[user_id]["invoice"]
        response = supabase.table("transactions").update({"status": status}).eq("invoice", invoice).execute()
        print(f"✅ Transaction `{invoice}` updated to `{status}` in Supabase")
    except Exception as e:
        print(f"❌ Failed to update transaction status: {e}")


# 🏠 Main Menu
def main_menu(lang=None):
    if lang is None:
        lang = "mn"
    markup = InlineKeyboardMarkup()
    # Add Web App button at the top
    markup.add(InlineKeyboardButton(t(lang, "btn_open_app"), web_app=WebAppInfo(url=WEBAPP_URL)))
    
    markup.row_width = 2
    markup.add(
        InlineKeyboardButton(t(lang, "btn_exchange_rate"), callback_data="exchange_rate"),
        InlineKeyboardButton(t(lang, "btn_instructions"), callback_data="instructions_menu")
    )
    return markup

@bot.callback_query_handler(func=lambda call: call.data == "contact_support")
def contact_support_handler(call):
    lang = get_user_lang(call.from_user.id)
    bot.send_message(
        call.message.chat.id,
        t(lang, "contact_support_msg"),
        parse_mode="Markdown"
    )

    

# ✅ Start Command

@bot.message_handler(commands=['start'])
def handle_start(message):
    user_id = message.chat.id

    # Check for deep link referral parameter
    command_parts = message.text.split()
    referrer_id = None
    if len(command_parts) > 1:
        try:
            referrer_id = int(command_parts[1])
            print(f"🔗 Deep link referral detected: User {user_id} referred by {referrer_id}")
            # Store the referral relationship temporarily (pending verification)
            update_user_session(user_id, {"pending_referrer_id": referrer_id})
        except ValueError:
            print(f"⚠️ Invalid referrer ID in deep link: {command_parts[1]}")

    # ⛑ Ensure user row exists
    response = supabase.table("users").select("id, lang").eq("id", user_id).execute()
    if not response.data:
        supabase.table("users").insert({"id": user_id}).execute()

    # 🌐 First-time language selection
    user_data = response.data[0] if response.data else {}
    if not user_data.get("lang"):
        tg_lang = getattr(message.from_user, 'language_code', '') or ''
        if tg_lang.startswith('ru'):
            prompt = "🌐 Выберите язык / Хэлээ сонгоно уу:"
        else:
            prompt = "🌐 Хэлээ сонгоно уу / Выберите язык:"
        markup = InlineKeyboardMarkup()
        markup.add(
            InlineKeyboardButton("🇲🇳 Монгол", callback_data="set_lang_mn"),
            InlineKeyboardButton("🇷🇺 Русский", callback_data="set_lang_ru"),
        )
        bot.send_message(user_id, prompt, reply_markup=markup)
        return

    lang = get_user_lang(user_id)

    # 🧾 Now check if they've agreed
    if not has_agreed_terms(user_id):
        ask_terms_agreement(user_id)
        return
    
    # Check for pending referrer (either from command or from session)
    if not referrer_id:
        session = get_user_session(user_id)
        referrer_id = session.get("pending_referrer_id")
    
    # If there's a pending referrer, prompt them to join the channel
    if referrer_id:
        prompt_channel_join(user_id, referrer_id)
        return
    
    update_user_session(user_id, {"state": ""})
    bot.send_message(
        message.chat.id,
        t(lang, "welcome"),
        reply_markup=main_menu(lang)
    )


# 🌐 Language selection callback
@bot.callback_query_handler(func=lambda call: call.data.startswith("set_lang_"))
def handle_lang_selection(call):
    user_id = call.from_user.id
    lang = call.data.replace("set_lang_", "")
    set_user_lang(user_id, lang)
    bot.answer_callback_query(call.id)
    bot.send_message(call.message.chat.id, t(lang, "lang_changed"))
    # Continue the /start flow
    if not has_agreed_terms(user_id):
        ask_terms_agreement(user_id)
        return
    session = get_user_session(user_id)
    referrer_id = session.get("pending_referrer_id") if session else None
    if referrer_id:
        prompt_channel_join(user_id, referrer_id)
        return
    update_user_session(user_id, {"state": ""})
    bot.send_message(call.message.chat.id, t(lang, "welcome"), reply_markup=main_menu(lang))


@bot.callback_query_handler(func=lambda call: call.data == "instructions_menu")
def instructions_menu(call):
    lang = get_user_lang(call.from_user.id)
    markup = InlineKeyboardMarkup()
    markup.add(InlineKeyboardButton(t(lang, "btn_instruction_register"), callback_data="instruction_register"))
    markup.add(InlineKeyboardButton(t(lang, "btn_instruction_exchange"), callback_data="instruction_exchange"))
    markup.add(InlineKeyboardButton(t(lang, "btn_instruction_other_services"), callback_data="instruction_other_services"))
    markup.add(InlineKeyboardButton(t(lang, "btn_back"), callback_data="back_main"))

    bot.answer_callback_query(call.id)
    bot.send_message(
        call.message.chat.id,
        t(lang, "instructions_title"),
        parse_mode="Markdown",
        reply_markup=markup,
    )


@bot.callback_query_handler(func=lambda call: call.data == "instruction_register")
def instruction_register(call):
    lang = get_user_lang(call.from_user.id)
    markup = InlineKeyboardMarkup()
    markup.add(InlineKeyboardButton(t(lang, "btn_open_app"), web_app=WebAppInfo(url=WEBAPP_URL)))
    markup.add(InlineKeyboardButton(t(lang, "btn_back"), callback_data="instructions_menu"))

    bot.answer_callback_query(call.id)
    bot.send_message(
        call.message.chat.id,
        t(lang, "instruction_register_text"),
        parse_mode="Markdown",
        reply_markup=markup,
    )


@bot.callback_query_handler(func=lambda call: call.data == "instruction_exchange")
def instruction_exchange(call):
    lang = get_user_lang(call.from_user.id)
    markup = InlineKeyboardMarkup()
    markup.add(InlineKeyboardButton(t(lang, "btn_open_app"), web_app=WebAppInfo(url=WEBAPP_URL)))
    markup.add(InlineKeyboardButton(t(lang, "btn_back"), callback_data="instructions_menu"))

    bot.answer_callback_query(call.id)
    bot.send_message(
        call.message.chat.id,
        t(lang, "instruction_exchange_text"),
        parse_mode="Markdown",
        reply_markup=markup,
    )


@bot.callback_query_handler(func=lambda call: call.data == "instruction_other_services")
def instruction_other_services(call):
    lang = get_user_lang(call.from_user.id)
    markup = InlineKeyboardMarkup()
    markup.add(InlineKeyboardButton(t(lang, "btn_instruction_phone"), callback_data="instruction_phone"))
    markup.add(InlineKeyboardButton(t(lang, "btn_instruction_fuel"), callback_data="instruction_fuel"))
    markup.add(InlineKeyboardButton(t(lang, "btn_instruction_gift"), callback_data="instruction_gift"))
    markup.add(InlineKeyboardButton(t(lang, "btn_instruction_flight"), callback_data="instruction_flight"))
    markup.add(InlineKeyboardButton(t(lang, "btn_back"), callback_data="instructions_menu"))

    bot.answer_callback_query(call.id)
    bot.send_message(
        call.message.chat.id,
        t(lang, "instruction_other_services_title"),
        parse_mode="Markdown",
        reply_markup=markup,
    )


@bot.callback_query_handler(func=lambda call: call.data == "instruction_phone")
def instruction_phone(call):
    lang = get_user_lang(call.from_user.id)
    markup = InlineKeyboardMarkup()
    markup.add(InlineKeyboardButton(t(lang, "btn_open_app"), web_app=WebAppInfo(url=WEBAPP_URL)))
    markup.add(InlineKeyboardButton(t(lang, "btn_back"), callback_data="instruction_other_services"))

    bot.answer_callback_query(call.id)
    bot.send_message(
        call.message.chat.id,
        t(lang, "instruction_phone_text"),
        parse_mode="Markdown",
        reply_markup=markup,
    )


@bot.callback_query_handler(func=lambda call: call.data == "instruction_fuel")
def instruction_fuel(call):
    lang = get_user_lang(call.from_user.id)
    markup = InlineKeyboardMarkup()
    markup.add(InlineKeyboardButton(t(lang, "btn_open_app"), web_app=WebAppInfo(url=WEBAPP_URL)))
    markup.add(InlineKeyboardButton(t(lang, "btn_back"), callback_data="instruction_other_services"))

    bot.answer_callback_query(call.id)
    bot.send_message(
        call.message.chat.id,
        t(lang, "instruction_fuel_text"),
        parse_mode="Markdown",
        reply_markup=markup,
    )


@bot.callback_query_handler(func=lambda call: call.data == "instruction_gift")
def instruction_gift(call):
    lang = get_user_lang(call.from_user.id)
    markup = InlineKeyboardMarkup()
    markup.add(InlineKeyboardButton(t(lang, "btn_open_app"), web_app=WebAppInfo(url=WEBAPP_URL)))
    markup.add(InlineKeyboardButton(t(lang, "btn_back"), callback_data="instruction_other_services"))

    bot.answer_callback_query(call.id)
    bot.send_message(
        call.message.chat.id,
        t(lang, "instruction_gift_text"),
        parse_mode="Markdown",
        reply_markup=markup,
    )


@bot.callback_query_handler(func=lambda call: call.data == "instruction_flight")
def instruction_flight(call):
    lang = get_user_lang(call.from_user.id)
    markup = InlineKeyboardMarkup()
    markup.add(InlineKeyboardButton(t(lang, "btn_open_operator_chat"), url=f"https://t.me/{FLIGHT_BOOKING_TG}"))
    markup.add(InlineKeyboardButton(t(lang, "btn_back"), callback_data="instruction_other_services"))

    bot.answer_callback_query(call.id)
    bot.send_message(
        call.message.chat.id,
        t(lang, "instruction_flight_text"),
        parse_mode="Markdown",
        reply_markup=markup,
        disable_web_page_preview=True,
    )


#----------------------OTHER SERVICES-----------------------------
FLIGHT_BOOKING_TG = "OYUNS_Finance"

# Other Services Menu
@bot.callback_query_handler(func=lambda call: call.data == "other_services")
def other_services_menu(call):
    instruction_other_services(call)

@bot.callback_query_handler(func=lambda call: call.data == "flight_booking")
def flight_booking_info(call):
    lang = get_user_lang(call.from_user.id)
    kb = InlineKeyboardMarkup()
    kb.add(InlineKeyboardButton("📨 OYUNS ALL-IN-ONE", url=f"https://t.me/{FLIGHT_BOOKING_TG}"))
    kb.add(InlineKeyboardButton(t(lang, "btn_back"), callback_data="other_services"))

    bot.send_message(
        call.message.chat.id,
        t(lang, "flight_booking_info", tg=FLIGHT_BOOKING_TG),
        parse_mode="Markdown",
        reply_markup=kb,
        disable_web_page_preview=True
    )

#----------------------PHONE TOP-UP-----------------------------
# Telecom companies available for top-up
TELECOM_COMPANIES = {
    "МТС": "МТС",
    "Билайн": "Билайн",
    "Мегафон": "Мегафон",
    "Теле2": "Теле2",
    "Yota": "Yota"
}

@bot.callback_query_handler(func=lambda call: call.data == "phone_topup")
def phone_topup_start(call):
    instruction_phone(call)

@bot.message_handler(func=lambda message: get_state(message.chat.id) == "phone_topup_amount")
def receive_topup_amount(message):
    user_id = message.chat.id
    lang = get_user_lang(user_id)
    
    try:
        if not message.text:
            bot.send_message(user_id, t(lang, "topup_empty_message"))
            return
        
        raw = re.sub(r"\D", "", message.text)
        
        if not raw or not raw.isdigit():
            bot.send_message(
                user_id,
                t(lang, "topup_number_only"),
                parse_mode="Markdown"
            )
            return
        
        amount = int(raw)
        
        if amount <= 0:
            bot.send_message(user_id, t(lang, "topup_amount_zero"))
            return
        
        # Calculate MNT equivalent
        base_rate = exchange_rates.get("SELL_RATE")
        
        if not base_rate:
            # Try to fetch rates
            fetch_exchange_rates()
            base_rate = exchange_rates.get("BUY_RATE")
            
            if not base_rate:
                bot.send_message(user_id, t(lang, "topup_rate_error"))
                return
        
        mnt_amount = amount * base_rate
        
        # Save session (store as MNT→RUB flow using current SELL rate)
        update_user_session(user_id, {
            "state": "phone_topup_phone_number",
            "amount": amount,       # RUB amount user wants to top up
            "rate": base_rate,      # SELL_RATE: RUB→MNT (used to compute MNT to pay)
            "currency_from": "mnt",
            "currency_to": "rub"
        })
        
        bot.send_message(
            user_id,
            t(lang, "topup_amount_confirm", amount=f"{amount:,}", mnt=f"{int(mnt_amount):,}"),
            parse_mode="Markdown"
        )
        
    except Exception as e:
        print(f"❌ Error in receive_topup_amount: {e}")
        import traceback
        traceback.print_exc()
        bot.send_message(user_id, t(lang, "error_generic"))
        return

@bot.message_handler(func=lambda message: get_state(message.chat.id) == "phone_topup_phone_number")
def receive_topup_phone_number(message):
    user_id = message.chat.id
    if not ensure_exchange_available(user_id):
        return
    lang = get_user_lang(user_id)
    
    phone_number = message.text.strip()
    
    # Validate phone number format (basic validation)
    cleaned_phone = re.sub(r"[^\d+]", "", phone_number)
    if not cleaned_phone or len(cleaned_phone) < 10:
        bot.send_message(
            user_id,
            t(lang, "topup_phone_invalid"),
            parse_mode="Markdown"
        )
        return
    
    # Save phone number in selected_rub_bank field
    update_user_session(user_id, {
        "state": "phone_topup_telecom",
        "selected_rub_bank": cleaned_phone
    })
    
    # Show telecom company selection
    markup = InlineKeyboardMarkup()
    for key, name in TELECOM_COMPANIES.items():
        markup.add(InlineKeyboardButton(name, callback_data=f"topup_telecom_{key}"))
    markup.add(InlineKeyboardButton(t(lang, "btn_other_telecom"), callback_data="topup_telecom_custom"))
    markup.add(InlineKeyboardButton(t(lang, "btn_back"), callback_data="other_services"))
    
    bot.send_message(
        user_id,
        t(lang, "topup_select_operator", phone=cleaned_phone),
        reply_markup=markup,
        parse_mode="Markdown"
    )

@bot.callback_query_handler(func=lambda call: call.data.startswith("topup_telecom_"))
def receive_topup_telecom(call):
    user_id = call.message.chat.id
    if not ensure_exchange_available(user_id):
        bot.answer_callback_query(call.id)
        return
    lang = get_user_lang(user_id)
    
    telecom_key = call.data.replace("topup_telecom_", "")
    
    # Handle custom telecom input request
    if telecom_key == "custom":
        bot.answer_callback_query(call.id)
        update_user_session(user_id, {"state": "phone_topup_custom_telecom"})
        bot.send_message(
            user_id,
            t(lang, "topup_custom_telecom_prompt"),
            parse_mode="Markdown"
        )
        return
    
    telecom_name = TELECOM_COMPANIES.get(telecom_key, telecom_key)
    
    session = get_user_session(user_id)
    if not session:
        bot.send_message(user_id, t(lang, "error_session_not_found"))
        return
    
    invoice = generate_invoice()
    amount_rub = session.get("amount")  # RUB amount
    rate = session.get("rate", 1)
    amount_mnt = amount_rub * rate  # Calculate MNT
    phone_number = session.get("selected_rub_bank")  # Phone number
    
    # Save telecom in direction field and invoice
    update_user_session(user_id, {
        "state": "phone_topup_waiting_receipt",
        "direction": telecom_name,
        "invoice": invoice
    })
    
    bot.answer_callback_query(call.id)
    bot.send_message(
        user_id,
        t(lang, "topup_receipt_summary", amount_rub=f"{amount_rub:,}", phone=phone_number, telecom=telecom_name, amount_mnt=f"{int(amount_mnt):,}", bank=BANK_DETAILS_MNT, invoice=invoice),
        parse_mode="Markdown"
    )

@bot.message_handler(func=lambda message: get_state(message.chat.id) == "phone_topup_custom_telecom")
def receive_custom_telecom(message):
    user_id = message.chat.id
    if not ensure_exchange_available(user_id):
        return
    lang = get_user_lang(user_id)
    
    custom_telecom = message.text.strip()
    
    # Validate input (not empty and reasonable length)
    if not custom_telecom or len(custom_telecom) > 50:
        bot.send_message(
            user_id,
            t(lang, "topup_custom_telecom_error"),
            parse_mode="Markdown"
        )
        return
    
    session = get_user_session(user_id)
    if not session:
        bot.send_message(user_id, t(lang, "error_session_not_found"))
        return
    
    invoice = generate_invoice()
    amount_rub = session.get("amount")  # RUB amount
    rate = session.get("rate", 1)
    amount_mnt = amount_rub * rate  # Calculate MNT
    phone_number = session.get("selected_rub_bank")  # Phone number
    
    # Save telecom in direction field and invoice
    update_user_session(user_id, {
        "state": "phone_topup_waiting_receipt",
        "direction": custom_telecom,
        "invoice": invoice
    })
    
    bot.send_message(
        user_id,
        t(lang, "topup_receipt_summary", amount_rub=f"{amount_rub:,}", phone=phone_number, telecom=custom_telecom, amount_mnt=f"{int(amount_mnt):,}", bank=BANK_DETAILS_MNT, invoice=invoice),
        parse_mode="Markdown"
    )

def notify_phone_topup_operator(user_id, invoice, receipt_id, amount_rub, amount_mnt, phone_number, telecom):
    try:
        user_info = bot.get_chat(user_id)
        user_display = user_info.first_name
        if user_info.last_name:
            user_display += f" {user_info.last_name}"
        
        user_link = f"[{user_display}](tg://user?id={user_id})"
        
        if user_info.username:
            username_link = f"[@{user_info.username}](https://t.me/{user_info.username})"
        else:
            username_link = "`NoUsername`"
        
        id_link = f"[`{user_id}`](tg://user?id={user_id})"
        
        user_line = f"{user_link} — {username_link} — {id_link}"
    except:
        user_line = f"[`{user_id}`](tg://user?id={user_id})"
    
    lang = get_user_lang(get_current_shift_operator_id())
    caption = t(lang, "admin_topup_request_caption", invoice=invoice, user_line=user_line, amount_rub=f"{amount_rub:,}", amount_mnt=f"{int(amount_mnt):,}", phone_number=phone_number, telecom=telecom)
    
    markup = InlineKeyboardMarkup()
    markup.add(
        InlineKeyboardButton(t(lang, "admin_btn_confirm"), callback_data=f"confirm_{user_id}"),
        InlineKeyboardButton(t(lang, "admin_btn_reject"), callback_data=f"reject_{user_id}")
    )
    markup.add(
        InlineKeyboardButton(t(lang, "admin_btn_waiting_edit"), callback_data=f"waitedit_{user_id}")
    )
    
    operator_id = get_current_shift_operator_id()
    # ➤ Always send to current shift operator
    bot.send_photo(operator_id, receipt_id, caption=caption, parse_mode="Markdown", reply_markup=markup)
    
    # ➤ Also notify always-notify operator if it's different
    for always_id in ALWAYS_NOTIFY_OPERATOR_ID:
        if always_id != operator_id:
            bot.send_photo(
                always_id,
                receipt_id,
                caption=caption,
                parse_mode="Markdown",
                reply_markup=markup
            )




# 📊 Exchange Rate Button Handler (with Calculator)
@bot.callback_query_handler(func=lambda call: call.data == "exchange_rate")
def exchange_rate(call):
    fetch_exchange_rates()  # Refresh rates before displaying
    lang = get_user_lang(call.from_user.id)
    DATETODAY = date.today().isoformat()
    markup = InlineKeyboardMarkup()
    markup.add(
        InlineKeyboardButton(t(lang, "btn_calculator"), callback_data="open_calculator"),
        InlineKeyboardButton(t(lang, "btn_back"), callback_data="back_main")
    )
    bot.send_message(
        call.message.chat.id,
        t(lang, "exchange_rate_title", date=DATETODAY, buy=exchange_rates['BUY_RATE'], sell=exchange_rates['SELL_RATE']),
        reply_markup=markup,
        parse_mode="Markdown"
    )

@bot.callback_query_handler(func=lambda call: call.data == "open_calculator")
def start_calculator(call):
    lang = get_user_lang(call.from_user.id)
    update_user_session(call.from_user.id, {"state": "calc_direction"})
    markup = InlineKeyboardMarkup()
    markup.add(
        InlineKeyboardButton("🇷🇺 RUB ➝ MNT", callback_data="calc_rub_mnt"),
        InlineKeyboardButton("🇲🇳 MNT ➝ RUB", callback_data="calc_mnt_rub"),
        InlineKeyboardButton(t(lang, "btn_back"), callback_data="back_main")
    )
    bot.send_message(call.message.chat.id, t(lang, "calc_direction"), reply_markup=markup)

@bot.callback_query_handler(func=lambda call: call.data.startswith("calc_"))
def ask_amount(call):
    direction = call.data
    user_id = call.from_user.id

    lang = get_user_lang(user_id)
    if direction == "calc_rub_mnt":
        update_user_session(user_id, {"state": "calc_rub_mnt_amount"})
        bot.send_message(user_id, t(lang, "calc_enter_rub"), parse_mode="Markdown")
    elif direction == "calc_mnt_rub":
        update_user_session(user_id, {"state": "calc_mnt_rub_amount"})
        bot.send_message(user_id, t(lang, "calc_enter_mnt"), parse_mode="Markdown")

@bot.message_handler(func=lambda m: get_state(m.chat.id) in ["calc_rub_mnt_amount", "calc_mnt_rub_amount"])
def perform_calculation(message):
    fetch_exchange_rates()
    user_id = message.chat.id
    session = get_user_session(user_id)
    state = session["state"] if session else None
    raw     = message.text.replace(",", "").strip()
    lang = get_user_lang(user_id)
    try:
        amount = float(raw)
    except ValueError:
        bot.send_message(
            user_id,
            t(lang, "error_number_only"),
            parse_mode="Markdown"
        )
        # leave them in the same state so they can retry
        return
    # 2) Do the conversion
    if state == "calc_rub_mnt_amount":
        rate      = exchange_rates["BUY_RATE"]
        converted = round(amount * rate, 2)
        bot.send_message(
            user_id,
            t(lang, "calc_result_rub_mnt", amount=amount, converted=converted, rate=rate),
            parse_mode="Markdown"
        )

    else:  # calc_mnt_rub_amount
        rate      = exchange_rates["SELL_RATE"]
        converted = round(amount / rate, 2)
        bot.send_message(
            user_id,
            t(lang, "calc_result_mnt_rub", amount=amount, converted=converted, rate=rate),
            parse_mode="Markdown"
        )

    # 3) Only now clear the state so they don’t get stuck
    clear_state(user_id)


# --------------------------------HEREGLEGCHIIN TOHIRGOO-----------------------
@bot.callback_query_handler(func=lambda call: call.data == "user_profile")
def profile_menu(call):
    instruction_register(call)
    return

    user_id = call.message.chat.id
    lang = get_user_lang(user_id)
    response = supabase.table("users").select("*").eq("id", user_id).execute()

    if not response.data:
        bot.send_message(user_id, t(lang, "register_not_agreed"))
        return

    user = response.data[0]
    is_verified = user.get("verified", False)

    # Fetch user's active promo codes
    promo_codes_response = supabase.table("promo_codes").select("code, discount, created_at").eq("user_id", user_id).eq("active", True).execute()
    promo_codes = promo_codes_response.data if promo_codes_response.data else []
    
    # 📋 User Summary Text
    passport_status = t(lang, "profile_passport_yes") if user.get('passport_file_id') else t(lang, "profile_passport_no")
    verification_sent = t(lang, "profile_verification_sent") if user.get('ready_for_verification') else t(lang, "profile_verification_not_sent")
    verified_label = t(lang, "profile_verified_yes") if is_verified else t(lang, "profile_verified_no")

    text = (
        t(lang, "profile_title")
        + f"{t(lang, 'profile_last_name')}: {user.get('last_name', '-')}\n"
        + f"{t(lang, 'profile_first_name')}: {user.get('first_name', '-')}\n"
        + f"{t(lang, 'profile_email')}: {user.get('email', '-')}\n"
        + f"{t(lang, 'profile_phone_mn')}: {user.get('phone_mnt', '-')}\n"
        + f"{t(lang, 'profile_phone_ru')}: {user.get('phone', '-')}\n"
        + f"{t(lang, 'profile_passport')}: {user.get('registration_number', '-')}\n"
        + f"{t(lang, 'profile_bank_mn')}: {user.get('bank_mnt', '-')}\n"
        + f"{t(lang, 'profile_bank_ru')}: {user.get('bank_rub', '-')}\n"
        + f"{t(lang, 'profile_passport_photo')}: {passport_status}\n"
        + f"\n{t(lang, 'profile_verification_request')}: {verification_sent}\n"
        + f"{t(lang, 'profile_verified_label')}: {verified_label}\n"
        + f"\nℹ️ Bot version: v2.0.0"
    )
    
    # Add promo codes section (collect buttons so user can copy codes easily)
    promo_buttons = []
    if promo_codes:
        text += f"\n\n{t(lang, 'profile_promo_codes')}\n"
        for promo in promo_codes:
            discount = promo.get('discount', 0)
            created_at = promo.get('created_at', '')
            if created_at:
                try:
                    promo_date = datetime.fromisoformat(created_at.replace('Z', '+00:00')).strftime('%Y-%m-%d')
                except:
                    promo_date = created_at[:10] if len(created_at) >= 10 else created_at
            else:
                promo_date = 'N/A'
            code_escaped = sanitize_markdown(promo.get('code', ''))
            text += t(lang, "profile_promo_item", code=code_escaped, discount=discount, date=promo_date) + "\n"
            promo_buttons.append(InlineKeyboardButton(t(lang, "btn_copy_promo", code=promo.get('code')), callback_data=f"copy_promo_{promo.get('code')}") )
    else:
        text += f"\n\n{t(lang, 'profile_promo_none')}"
    
    # Add referral status section
    referral_status = get_user_referral_status(user_id)
    accepted_count = referral_status["accepted"]
    pending_count = referral_status["pending"]
    total_count = referral_status["total"]
    
    if total_count == 0:
        referral_status_text = t(lang, "profile_referral_none")
    elif pending_count > 0:
        referral_status_text = t(lang, "profile_referral_pending", count=pending_count)
    elif accepted_count >= REFERRAL_REQUIRED_COUNT:
        referral_status_text = t(lang, "profile_referral_success", accepted=accepted_count, required=REFERRAL_REQUIRED_COUNT)
    else:
        referral_status_text = t(lang, "profile_referral_in_progress", accepted=accepted_count, required=REFERRAL_REQUIRED_COUNT)
    
    text += f"\n\n{t(lang, 'profile_referral_status')}: {referral_status_text}"

    # 📌 Markup (Edit / Continue Registration)
    markup = InlineKeyboardMarkup()

    markup.add(
        InlineKeyboardButton(t(lang, "btn_edit_last_name"), callback_data="edit_last_name"),
        InlineKeyboardButton(t(lang, "btn_edit_first_name"), callback_data="edit_first_name"),
        InlineKeyboardButton(t(lang, "btn_edit_phone"), callback_data="edit_phone")
    )

    if not is_verified:
        markup.add(
            InlineKeyboardButton(t(lang, "btn_edit_passport_num"), callback_data="edit_registration_number"),
            InlineKeyboardButton(t(lang, "btn_upload_passport"), callback_data="upload_passport")
        )

    markup.add(
        InlineKeyboardButton(t(lang, "btn_edit_bank_mn"), callback_data="edit_bank_mnt"),
        InlineKeyboardButton(t(lang, "btn_edit_bank_ru"), callback_data="edit_bank_rub"),
        InlineKeyboardButton(t(lang, "btn_submit_verification"), callback_data="submit_verification"),
        InlineKeyboardButton(t(lang, "btn_txn_history"), callback_data="txn_history_1"),
        InlineKeyboardButton(t(lang, "btn_change_lang"), callback_data="profile_change_lang"),
        InlineKeyboardButton(t(lang, "btn_back"), callback_data="back_main")
    )

    # add promo copy buttons if any (each on its own row)
    for b in promo_buttons:
        markup.add(b)

    bot.send_message(user_id, text, reply_markup=markup, parse_mode="Markdown")


@bot.callback_query_handler(func=lambda call: call.data == "profile_change_lang")
def profile_change_lang(call):
    user_id = call.from_user.id
    lang = get_user_lang(user_id)
    markup = InlineKeyboardMarkup()
    markup.add(
        InlineKeyboardButton("🇲🇳 Монгол", callback_data="set_profile_lang_mn"),
        InlineKeyboardButton("🇷🇺 Русский", callback_data="set_profile_lang_ru")
    )
    bot.send_message(call.message.chat.id, t(lang, "choose_lang_mn") if lang == "mn" else t(lang, "choose_lang_ru"), reply_markup=markup)

@bot.callback_query_handler(func=lambda call: call.data.startswith("set_profile_lang_"))
def set_profile_lang(call):
    user_id = call.from_user.id
    new_lang = call.data.replace("set_profile_lang_", "")
    if new_lang not in ("mn", "ru"):
        new_lang = "mn"
    set_user_lang(user_id, new_lang)
    bot.answer_callback_query(call.id, t(new_lang, "lang_changed"))
    bot.send_message(call.message.chat.id, t(new_lang, "lang_changed"), reply_markup=main_menu(new_lang))

@bot.callback_query_handler(func=lambda call: call.data.startswith("txn_history_"))
def txn_history_page(call):
    user_id = call.message.chat.id

    # page number from callback_data like txn_history_1
    try:
        page = int(call.data.split("_")[2])
    except Exception:
        page = 1
    page = max(1, page)

    offset = (page - 1) * PAGE_SIZE

    # Pull PAGE_SIZE + 1 rows to detect "has_next"
    fields = "invoice,amount,currency_from,currency_to,rate,status,timestamp,bill_url"
    resp = supabase.table("transactions") \
        .select(fields) \
        .eq("user_id", user_id) \
        .order("timestamp", desc=True) \
        .range(offset, offset + PAGE_SIZE) \
        .execute()

    rows = resp.data or []
    has_next = len(rows) > PAGE_SIZE
    if has_next:
        rows = rows[:PAGE_SIZE]

    if not rows and page == 1:
        kb = InlineKeyboardMarkup()
        kb.add(InlineKeyboardButton("🔙 Буцах", callback_data="user_profile"))
        return bot.edit_message_text(
            "📭 Таны гүйлгээний түүх хоосон байна.",
            call.message.chat.id, call.message.message_id,
            reply_markup=kb
        )

    # Build page text
    status_icon = {"pending": "🕒", "successful": "✅", "rejected": "❌", "waiting_edit": "❌"}
    lines = ["📜 *Гүйлгээний түүх*"]
    for tx in rows:
        conv, tocur = compute_converted(tx)
        icon = status_icon.get((tx.get("status") or "").lower(), "❔")
        ts   = format_ub(tx.get("timestamp") or "")
        inv  = tx.get("invoice")
        amt  = float(tx["amount"])
        cf   = tx["currency_from"].upper()
        rate = float(tx["rate"])
        line = (
            f"{icon} `{inv}` • {ts}\n"
            f"   {amt:,.2f} {cf} → {conv:,.2f} {tocur} @ {rate}₮\n"
        )
        if tx.get("bill_url"):
            line += f"   [Баримт]({tx['bill_url']})\n"
        lines.append(line)

    text = "\n".join(lines)

    # Navigation
    kb = InlineKeyboardMarkup()
    nav = []
    if page > 1:
        nav.append(InlineKeyboardButton("⬅️ Өмнөх", callback_data=f"txn_history_{page-1}"))
    if has_next:
        nav.append(InlineKeyboardButton("Дараах ➡️", callback_data=f"txn_history_{page+1}"))
    if nav:
        kb.row(*nav)
    kb.add(InlineKeyboardButton("🔙 Буцах", callback_data="user_profile"))

    bot.edit_message_text(
        text,
        call.message.chat.id, call.message.message_id,
        parse_mode="Markdown",
        reply_markup=kb,
        disable_web_page_preview=True
    )



@bot.callback_query_handler(func=lambda call: call.data == "upload_passport")
def handle_upload_passport(call):
    user_id = call.message.chat.id

    # 🛡️ Block verified users
    response = supabase.table("users").select("verified").eq("id", user_id).execute()
    if response.data and response.data[0].get("verified"):
        bot.send_message(user_id, f"⚠️ Баталгаажсан хэрэглэгч паспортын зургаа өөрчлөх боломжгүй.\n ✉️ Админтай холбогдоно уу: {CONTACT_SUPPORT}")
        return

    update_user_session(user_id, {"state": "waiting_for_passport"})
    bot.send_message(user_id, "📸 Паспортын зургаа илгээнэ үү:")

def schedule_morning_alert(user_id):
    if user_id not in pending_morning_alerts:
        pending_morning_alerts.append(user_id)
        print(f"🕓 Queued alert for user {user_id} in the morning.")




def send_verification_alert_to_operator(user_id, user):
    # who’s on shift right now?
    primary = get_current_shift_operator_id()
    # build a set of everyone to notify
    to_notify = {primary} if primary else set()
    to_notify.update(ALWAYS_NOTIFY_OPERATOR_ID)
    try:
        passport_file_id = user.get("passport_file_id")

        lang = get_user_lang(primary if primary else (ALWAYS_NOTIFY_OPERATOR_ID[0] if ALWAYS_NOTIFY_OPERATOR_ID else 0))
        caption = t(lang, "admin_verification_caption", user_id=user_id, last_name=user.get('last_name'), first_name=user.get('first_name'), phone=user.get('phone'), reg_num=user.get('registration_number'), bank_mnt=user.get('bank_mnt'), bank_rub=user.get('bank_rub'))

        markup = InlineKeyboardMarkup()
        markup.add(
            InlineKeyboardButton(t(lang, "admin_btn_verify"), callback_data=f"verify_{user_id}"),
            InlineKeyboardButton(t(lang, "admin_btn_cancel"), callback_data=f"rejectuser_{user_id}")
        )
        # send each person in the set
        for op_id in to_notify:
            try:
                if passport_file_id:
                    bot.send_photo(
                        op_id,
                        passport_file_id,
                        caption=caption,
                        parse_mode="Markdown",
                        reply_markup=markup
                    )
                else:
                    bot.send_message(
                        op_id,
                        caption + t(lang, "admin_no_passport_warning"),
                        parse_mode="Markdown",
                        reply_markup=markup
                    )
            except Exception as e:
                print(f"❌ Failed to notify operator {op_id}: {e}")
        if passport_file_id:
            bot.send_photo(operator_id, passport_file_id, caption=caption, parse_mode="Markdown", reply_markup=markup)
        else:
            bot.send_message(operator_id, caption + t(lang, "admin_no_passport_warning"), parse_mode="Markdown", reply_markup=markup)

    except Exception as e:
        print(f"❌ Failed to send verification alert: {e}")


@bot.callback_query_handler(func=lambda call: call.data == "start_registration")
def start_registration_from_menu(call):
    instruction_register(call)

@bot.message_handler(func=lambda m: get_state(m.chat.id) == "awaiting_bank")
def get_bank(message):
    user_profiles[message.chat.id]["bank"] = message.text
    update_user_session(message.chat.id, {"state": "waiting_for_bank"})
    bot.send_message(message.chat.id, "🪪 Паспортын зургаа илгээнэ үү:")


# ℹ️ How to Use Button Handler
@bot.callback_query_handler(func=lambda call: call.data == "how_to_use")
def how_to_use(call):
    lang = get_user_lang(call.from_user.id)
    markup = InlineKeyboardMarkup()
    markup.add(InlineKeyboardButton(t(lang, "btn_back"), callback_data="back_main"))

    bot.send_message(
        call.message.chat.id, t(lang, "how_to_use_text"),
                              parse_mode="Markdown",
                              reply_markup=markup
    )


@bot.callback_query_handler(func=lambda call: call.data == "exchange_menu")
def exchange_menu(call):
    instruction_exchange(call)
    return




def show_common_rub_amounts(user_id):
    try:
        lang = get_user_lang(user_id)
        flow_token = _begin_exchange_amount_selection(user_id, "rub")
        markup = InlineKeyboardMarkup()
        # Add buttons in rows of 2 or 3 for better UX and to avoid Telegram issues
        markup.row(
            InlineKeyboardButton("1,000 РУБ", callback_data=f"amount_rub_1000_{flow_token}"),
            InlineKeyboardButton("5,000 РУБ", callback_data=f"amount_rub_5000_{flow_token}"),
        )
        markup.row(
            InlineKeyboardButton("10,000 РУБ", callback_data=f"amount_rub_10000_{flow_token}"),
            InlineKeyboardButton("20,000 РУБ", callback_data=f"amount_rub_20000_{flow_token}"),
        )
        markup.row(
            InlineKeyboardButton("30,000 РУБ", callback_data=f"amount_rub_30000_{flow_token}"),
        )
        markup.row(
            InlineKeyboardButton(t(lang, "btn_custom_amount"), callback_data=f"custom_rub_{flow_token}"),
            InlineKeyboardButton(t(lang, "btn_back"), callback_data="exchange_menu"),
        )
        bot.send_message(user_id, t(lang, "exchange_choose_rub_amount"), reply_markup=markup)
    except Exception as e:
        print(f"❌ Error in show_common_rub_amounts: {e}")
        import traceback
        traceback.print_exc()
        bot.send_message(user_id, "❌ Алдаа гарлаа. Дахин оролдоно уу.")


def show_common_mnt_amounts(user_id):
    lang = get_user_lang(user_id)
    flow_token = _begin_exchange_amount_selection(user_id, "mnt")
    markup = InlineKeyboardMarkup()
    markup.add(
        InlineKeyboardButton("250,000 MNT", callback_data=f"amount_mnt_250000_{flow_token}"),
        InlineKeyboardButton("500,000 MNT", callback_data=f"amount_mnt_500000_{flow_token}"),
        InlineKeyboardButton("1,000,000 MNT", callback_data=f"amount_mnt_1000000_{flow_token}"),
        InlineKeyboardButton("3,000,000 MNT", callback_data=f"amount_mnt_3000000_{flow_token}"),
        InlineKeyboardButton("5,000,000 MNT", callback_data=f"amount_mnt_5000000_{flow_token}"),
        InlineKeyboardButton(t(lang, "btn_custom_amount"), callback_data=f"custom_mnt_{flow_token}"),
        InlineKeyboardButton(t(lang, "btn_back"), callback_data="exchange_menu")
    )
    bot.send_message(user_id, t(lang, "exchange_choose_mnt_amount"), reply_markup=markup)



def auto_update_rates():
    while True:
        fetch_exchange_rates()
        time_module.sleep(1800)  # Update every 30 minutes

rate_update_thread = threading.Thread(target=auto_update_rates)
rate_update_thread.daemon = True
rate_update_thread.start()

# 🇷🇺 RUB → MNT Exchange: Show Common Amounts
@bot.callback_query_handler(func=lambda call: call.data == "BUY_RATE")
def BUY_RATE(call):
    user_id = call.message.chat.id
    
    # Check business hours and admin availability
    if not is_within_ub_business_hours():
        bot.answer_callback_query(call.id)
        bot.send_message(
            user_id,
            t(get_user_lang(user_id), "business_hours_msg"),
        )
        return
    
    if not ensure_admin_available(user_id):
        bot.answer_callback_query(call.id)
        return
    
    config = get_current_shift_config()
    if config:
        # Set globals dynamically
        global OPERATOR_CHAT_ID, BANK_DETAILS_RUB, BANK_DETAILS_MNT
        OPERATOR_CHAT_ID = config["operator_id"]
        BANK_DETAILS_RUB = config["bank_rub"]
        BANK_DETAILS_MNT = config["bank_mnt"]

    # Clear any previous promo discount and go directly to amount selection (removed promo code step from bot)
    update_user_session(user_id, {
        "promo_discount": 0.0,
        "promo_code": None
    })
    
    bot.answer_callback_query(call.id)
    show_common_rub_amounts(user_id)


# 🇲🇳 MNT → RUB Exchange: Show Common Amounts
@bot.callback_query_handler(func=lambda call: call.data == "SELL_RATE")
def SELL_RATE(call):
    user_id = call.message.chat.id
    
    # Check business hours and admin availability
    if not is_within_ub_business_hours():
        bot.answer_callback_query(call.id)
        bot.send_message(
            user_id,
            t(get_user_lang(user_id), "business_hours_msg"),
        )
        return
    
    if not ensure_admin_available(user_id):
        bot.answer_callback_query(call.id)
        return
    
    config = get_current_shift_config()
    if config:
        # Set globals dynamically
        global OPERATOR_CHAT_ID, BANK_DETAILS_RUB, BANK_DETAILS_MNT
        OPERATOR_CHAT_ID = config["operator_id"]
        BANK_DETAILS_RUB = config["bank_rub"]
        BANK_DETAILS_MNT = config["bank_mnt"]

    # Clear any previous promo discount and go directly to amount selection (removed promo code step from bot)
    update_user_session(user_id, {
        "promo_discount": 0.0,
        "promo_code": None
    })
    
    bot.answer_callback_query(call.id)
    show_common_mnt_amounts(user_id)

@bot.callback_query_handler(func=lambda call: call.data.startswith("promo_enter_"))
def promo_code_request(call):
    user_id = call.message.chat.id
    try:
        if not ensure_exchange_available(user_id):
            bot.answer_callback_query(call.id)
            return
        direction = call.data.replace("promo_enter_", "")
        update_user_session(call.message.chat.id, {"state": f"awaiting_promo_code_{direction}"})
        bot.answer_callback_query(call.id)
        lang = get_user_lang(user_id)
        bot.send_message(call.message.chat.id, t(lang, "promo_enter"))
    except Exception as e:
        print(f"❌ Error in promo_code_request: {e}")
        import traceback
        traceback.print_exc()
        bot.answer_callback_query(call.id)
        bot.send_message(user_id, "❌ Алдаа гарлаа. Дахин оролдоно уу.")

@bot.message_handler(func=lambda m: get_state(m.chat.id).startswith("awaiting_promo_code_"))
def promo_code_input_handler(message):
    user_id = message.chat.id
    if not ensure_exchange_available(message.chat.id):
        return
    session = get_user_session(user_id)
    state = session.get("state", "")
    direction = state.split("_")[-1]
    promo_code = message.text.strip()

    discount = get_promo_discount_from_db(promo_code)

    if discount <= 0:
        bot.send_message(user_id, t(get_user_lang(user_id), "promo_invalid"))
        return

    # Save discount and promo code in session
    update_user_session(user_id, {
        "promo_discount": discount,
        "promo_code": promo_code
    })


    clear_state(user_id)
    bot.send_message(user_id, t(get_user_lang(user_id), "promo_success", discount=discount))

    if direction == "buy":
        show_common_rub_amounts(user_id)
    else:
        show_common_mnt_amounts(user_id)

@bot.callback_query_handler(func=lambda call: call.data.startswith("promo_skip_"))
def promo_skip_handler(call):
    user_id = call.message.chat.id
    try:
        if not ensure_exchange_available(user_id):
            bot.answer_callback_query(call.id)
            return
        
        direction = call.data.replace("promo_skip_", "")
        
        update_user_session(user_id, {
            "promo_discount": 0.0,
            "promo_code": None
        })
        
        bot.answer_callback_query(call.id)
        
        if direction == "buy":
            show_common_rub_amounts(user_id)
        else:
            show_common_mnt_amounts(user_id)
    except Exception as e:
        print(f"❌ Error in promo_skip_handler: {e}")
        import traceback
        traceback.print_exc()
        bot.answer_callback_query(call.id)
        bot.send_message(user_id, "❌ Алдаа гарлаа. Дахин оролдоно уу.")


# Callback to send promo code as a separate message so user can copy it easily
@bot.callback_query_handler(func=lambda call: call.data.startswith("copy_promo_"))
def copy_promo_callback(call):
    try:
        code = call.data.replace("copy_promo_", "")
        bot.answer_callback_query(call.id, "Промокод илгээлээ.", show_alert=False)
        bot.send_message(call.from_user.id, f"🎟️ Таны промокод: `{sanitize_markdown(code)}`", parse_mode="Markdown")
    except Exception as e:
        print(f"❌ copy_promo error: {e}")

@bot.callback_query_handler(func=lambda call: call.data == "open_gift")
def handle_open_gift(call):
    bot.answer_callback_query(call.id)


@bot.callback_query_handler(func=lambda call: call.data.startswith("confirm_referral:"))
def confirm_referral_callback(call):
    # Only the moderator should confirm
    try:
        lang_mod = get_user_lang(call.from_user.id)
        if call.from_user.id != MODERATOR_ID:
            bot.answer_callback_query(call.id, t(lang_mod, "admin_referral_no_permission"), show_alert=True)
            return

        parts = call.data.split(":")
        if len(parts) < 2:
            bot.answer_callback_query(call.id, t(lang_mod, "admin_referral_bad_data"), show_alert=True)
            return

        user_id = int(parts[1])
        pending = pending_referral_confirmations.get(call.message.message_id)
        if not pending or pending.get("user_id") != user_id:
            bot.answer_callback_query(call.id, t(lang_mod, "admin_referral_not_found"), show_alert=True)
            return

        # Ensure this message is mapped to a pending request
        pending = pending_referral_confirmations.get(call.message.message_id)
        if not pending or pending.get("user_id") != user_id:
            bot.answer_callback_query(call.id, t(lang_mod, "admin_referral_not_found"), show_alert=True)
            return

        # Recompute how many to award at confirmation time, using unawarded accepted referrals
        try:
            ua_resp = supabase.table("referrals").select("id").eq("referrer_id", user_id).eq("status", "accepted").eq("awarded", False).execute()
            accepted_unawarded_count = len(ua_resp.data) if ua_resp.data else 0
        except Exception:
            # fallback to counting all accepted referrals
            resp = supabase.table("referrals").select("id").eq("referrer_id", user_id).eq("status", "accepted").execute()
            accepted_unawarded_count = len(resp.data) if resp.data else 0
        to_award = accepted_unawarded_count // REFERRAL_REQUIRED_COUNT

        # Allow moderator to manually award even when computed `to_award` == 0
        awards_to_create = to_award
        manual_award = False
        if awards_to_create <= 0:
            manual_award = True
            awards_to_create = 1

        created_codes = []
        for _ in range(awards_to_create):
            code = generate_promo_code()
            if create_promo_code_in_db(code, user_id=user_id, discount=0.3, source="referral"):
                created_codes.append(code)

        # Notify the user about awarded codes
        if created_codes:
            codes_text = "\n".join([f"  • `{c}`" for c in created_codes])
            bot.send_message(user_id, f"🎉 Таны найзууд манай телеграм сувагт нэгдсэн тул танд {len(created_codes)} ширхэг промокод олгогдлоо!\n\n{codes_text}\n\n💰 Хөнгөлөлт: 0.3 MNT\n\n📌Та энэхүү промокодыг валют солиулах үедээ промокод ашиглах товчийг дарж гүйлгээндээ хөнгөлөлт эдлээрэй.", parse_mode="Markdown")

        # Delete moderator message and cleanup mapping
        try:
            bot.delete_message(call.message.chat.id, call.message.message_id)
        except Exception as e:
            print(f"❌ Failed to delete moderator confirmation message: {e}")
        try:
            # Mark the used referrals as awarded so the cycle can be restarted later
            # Only mark up to the number of actually unawarded accepted referrals
            try:
                count_to_mark = min(REFERRAL_REQUIRED_COUNT * len(created_codes), accepted_unawarded_count)
            except Exception:
                count_to_mark = REFERRAL_REQUIRED_COUNT * len(created_codes)
            if count_to_mark:
                mark_referrals_awarded(user_id, count_to_mark)
            pending_referral_confirmations.pop(call.message.message_id, None)
        except Exception:
            pass

        bot.answer_callback_query(call.id, t(lang_mod, "admin_referral_confirmed"))
    except Exception as e:
        print(f"❌ confirm_referral error: {e}")
        bot.answer_callback_query(call.id, t(get_user_lang(call.from_user.id), "admin_referral_confirm_error"), show_alert=True)


@bot.callback_query_handler(func=lambda call: call.data.startswith("request_promocode:"))
def request_promocode_callback(call):
    """User-triggered: sends a moderator confirmation request.
    Only the user who owns the referrer id may press the button.
    """
    try:
        parts = call.data.split(":")
        if len(parts) < 2:
            bot.answer_callback_query(call.id, "❌ Буруу callback data.", show_alert=True)
            return
        user_id = int(parts[1])
        # Ensure only the user who requested can press the button
        if call.from_user.id != user_id:
            bot.answer_callback_query(call.id, "❌ Та промокод авах нөхцлийг биелүүлээгүй байна.", show_alert=True)
            return

        if has_pending_referral_confirmation(user_id):
            bot.answer_callback_query(call.id, "🔔 Таны явуулсан урилгад админы баталгаажуулалт аль хэдийн хийгдэж байна.", show_alert=False)
            return

        # Recompute counts
        try:
            ua_resp = supabase.table("referrals").select("id").eq("referrer_id", user_id).eq("status", "accepted").eq("awarded", False).execute()
            accepted_unawarded_count = len(ua_resp.data) if ua_resp.data else 0
        except Exception:
            resp = supabase.table("referrals").select("id").eq("referrer_id", user_id).eq("status", "accepted").execute()
            accepted_unawarded_count = len(resp.data) if resp.data else 0
        # Also compute total accepted referrals (for moderator visibility)
        try:
            total_resp = supabase.table("referrals").select("id").eq("referrer_id", user_id).eq("status", "accepted").execute()
            accepted_count = len(total_resp.data) if total_resp.data else 0
        except Exception:
            accepted_count = 0
        to_award = accepted_unawarded_count // REFERRAL_REQUIRED_COUNT

        # Do not auto-create promo codes here. Always request moderator confirmation.
        # The moderator can manually award a promo via the confirmation dialog.

        # Send to moderator
        # Send total accepted count for moderator visibility, and to_award to show potential unawarded awards
        admin_msg = send_referral_confirmation_request(user_id, accepted_count, to_award)
        if admin_msg:
            bot.answer_callback_query(call.id, "✅ Хүсэлтийг админ руу илгээлээ.")
            bot.send_message(call.from_user.id, f"🔔 Таны хүсэлтийг админ руу илгээлээ. Хэрэв таны найзууд урилгыг хүлээн авсан бол танд промокод олгогдох болно. Та тэр болтол түр хүлээгээрэй.")
        else:
            bot.answer_callback_query(call.id, "❌ Хүсэлт илгээхэд алдаа гарлаа. Дахин оролдоно уу.", show_alert=True)
    except Exception as e:
        print(f"❌ request_promocode error: {e}")
        bot.answer_callback_query(call.id, "❌ Хүсэлт илгээхэд алдаа гарлаа.", show_alert=True)


@bot.callback_query_handler(func=lambda call: call.data.startswith("reject_referral:"))
def reject_referral_callback(call):
    try:
        lang_mod = get_user_lang(call.from_user.id)
        if call.from_user.id != MODERATOR_ID:
            bot.answer_callback_query(call.id, t(lang_mod, "admin_referral_no_permission"), show_alert=True)
            return

        parts = call.data.split(":")
        if len(parts) < 2:
            bot.answer_callback_query(call.id, t(lang_mod, "admin_referral_bad_data"), show_alert=True)
            return

        user_id = int(parts[1])
        # Notify user about rejection
        try:
            bot.send_message(user_id, t(get_user_lang(user_id), "user_referral_rejected"))
        except Exception:
            pass

        # Delete moderator message and cleanup mapping
        try:
            bot.delete_message(call.message.chat.id, call.message.message_id)
        except Exception as e:
            print(f"❌ Failed to delete moderator rejection message: {e}")
        try:
            pending_referral_confirmations.pop(call.message.message_id, None)
        except Exception:
            pass

        bot.answer_callback_query(call.id, t(lang_mod, "admin_referral_rejected"))
    except Exception as e:
        print(f"❌ reject_referral error: {e}")
        bot.answer_callback_query(call.id, t(get_user_lang(call.from_user.id), "admin_referral_reject_error"), show_alert=True)


# 💰 Handle Common Amount Selection
# 💰 Handle Common Amount Selection
@bot.callback_query_handler(func=lambda call: call.data.startswith("amount_"))
def selected_common_amount(call):
    print(f"[DEBUG] selected_common_amount callback data: {call.data}")
    user_id = call.message.chat.id
    if not ensure_exchange_available(user_id):
        bot.answer_callback_query(call.id)
        return
    try:
        callback_payload, flow_token = call.data.rsplit("_", 1)
        parts = callback_payload.split("_")
        currency, amount = parts[1], int(parts[2])
    except Exception as e:
        print(f"[ERROR] Invalid callback_data for selected_common_amount: {call.data} ({e})")
        bot.answer_callback_query(call.id, "❌ Invalid button data.", show_alert=True)
        return

    session = _validate_exchange_button(call, f"awaiting_exchange_amount_{currency}", flow_token)
    if not session:
        return

    bot.answer_callback_query(call.id)

    invoice = generate_invoice()
    # Get base rate and promo discount
    base_rate = exchange_rates["BUY_RATE"] if currency == "rub" else exchange_rates["SELL_RATE"]
    promo = session.get("promo_discount", 0.0)

    # compute volume discount
    vol_disc = 0.0
    if currency == "rub":
        if amount >= MIN_VOLUME_RUB_2:
            vol_disc = VOLUME_DISCOUNT_MNT_2
        elif amount >= MIN_VOLUME_RUB:
            vol_disc = VOLUME_DISCOUNT_MNT
    elif currency == "mnt":
        rub_equiv = amount / base_rate
        if rub_equiv >= MIN_VOLUME_RUB_2:
            vol_disc = VOLUME_DISCOUNT_MNT_2
        elif rub_equiv >= MIN_VOLUME_RUB:
            vol_disc = VOLUME_DISCOUNT_MNT
    # pick the higher discount
    best_disc = max(promo, vol_disc)

    # apply it
    if currency == "rub":
        final_rate = base_rate + best_disc
    else:  # mnt -> rub
        final_rate = base_rate - best_disc

    final_rate = round(max(final_rate, 0.01), 2)

    if currency == "rub" and amount < MIN_RUB_TO_MNT:
        lang = get_user_lang(user_id)
        return bot.send_message(
            user_id,
            t(lang, "exchange_min_rub_to_mnt", min_rub=MIN_RUB_TO_MNT),
            parse_mode="Markdown"
        )

    # enforce 1 000 RUB-min on MNT→RUB
    if currency == "mnt":
        # final_rate is MNT per 1 RUB, so to get MIN_RUB you need MIN_RUB * final_rate MNT
        min_mnt = ceil(MIN_RUB * final_rate)
        if amount < min_mnt:
            lang = get_user_lang(user_id)
            return bot.send_message(
                user_id,
                t(lang, "exchange_min_amount", min_rub=MIN_RUB, min_mnt=min_mnt),
                parse_mode="Markdown"
            )

    lang = get_user_lang(user_id)
    bank_markup = None
    next_state = "waiting_for_receipt"
    if currency == "rub":
        bank_markup = _build_rub_bank_markup(user_id, flow_token)
        if not bank_markup:
            bot.send_message(user_id, t(lang, "exchange_no_banks"))
            return
        next_state = "awaiting_rub_bank_selection"

    # save to session
    update_user_session(user_id, {
        "amount":        amount,
        "currency_from": currency,
        "currency_to":   "mnt" if currency=="rub" else "rub",
        "invoice":       invoice,
        "rate":          final_rate,
        "state":         next_state,
    })

    if currency == "rub":
        bot.send_message(
            user_id,
            t(lang, "exchange_choose_rub_bank"),
            reply_markup=bank_markup
        )
    else:
        # MNT → RUB flow
        exchanged = amount / final_rate
        message_text = f"💱 {amount:,} MNT → {round(exchanged, 2):,} RUB"

        bot.send_message(
            user_id,
            t(lang, "exchange_send_receipt_mnt", msg=message_text, bank=BANK_DETAILS_MNT, amount=amount, invoice=invoice),
            parse_mode="Markdown"
        )




# ✏️ Handle Custom Amount Entry
@bot.callback_query_handler(func=lambda call: call.data.startswith("custom_"))
def custom_amount(call):
    print(f"[DEBUG] custom_amount callback data: {call.data}")
    user_id = call.message.chat.id
    if not ensure_exchange_available(user_id):
        bot.answer_callback_query(call.id)
        return
    try:
        callback_payload, flow_token = call.data.rsplit("_", 1)
        currency = callback_payload.split("_")[1]
    except Exception as e:
        print(f"[ERROR] Invalid callback_data for custom_amount: {call.data} ({e})")
        bot.answer_callback_query(call.id, "❌ Invalid button data.", show_alert=True)
        return

    session = _validate_exchange_button(call, f"awaiting_exchange_amount_{currency}", flow_token)
    if not session:
        return

    bot.answer_callback_query(call.id)

    update_user_session(call.message.chat.id, {"state": f"custom_amount_{currency}"})

    lang = get_user_lang(call.from_user.id)
    bot.send_message(call.message.chat.id, t(lang, "exchange_enter_amount"))

# 🏦 Receive Custom Amount
@bot.message_handler(func=lambda message: isinstance(get_state(message.chat.id), str) and get_state(message.chat.id).startswith("custom_amount_"))
def receive_custom_amount(message):
    user_id = message.chat.id
    if not ensure_exchange_available(user_id):
        return    
    session = get_user_session(user_id)
    state = session.get("state", "")
    currency = state.split("_")[2] if state else None
    invoice = generate_invoice()
    lang = get_user_lang(user_id)
    raw = re.sub(r"\D", "", message.text)
    if not raw.isdigit():
        bot.send_message(
            user_id,
            t(lang, "error_number_only"),
            parse_mode="Markdown"
        )
        # Make sure they stay in the same state
        update_user_session(user_id, {"state": state})
        return

    try:
        amount = int(raw)
        if amount <= 0:
            raise ValueError
        # 1) Pick the right base rate
        if currency == "rub":
            base_rate = exchange_rates["BUY_RATE"]    # MNT per RUB
        else:
            base_rate = exchange_rates["SELL_RATE"]   # RUB per MNT

        # 2) Compute volume discount
        vol_disc = 0.0
        if currency == "rub":
            if amount >= MIN_VOLUME_RUB_2:
                vol_disc = VOLUME_DISCOUNT_MNT_2
            elif amount >= MIN_VOLUME_RUB:
                vol_disc = VOLUME_DISCOUNT_MNT
        elif currency == "mnt":
            rub_equiv = amount / base_rate
            if rub_equiv >= MIN_VOLUME_RUB_2:
                vol_disc = VOLUME_DISCOUNT_MNT_2
            elif rub_equiv >= MIN_VOLUME_RUB:
                vol_disc = VOLUME_DISCOUNT_MNT

        # 3) Grab any promo code discount
        promo_disc = session.get("promo_discount", 0.0)

        # 4) Apply only the higher of the two
        best_disc = max(promo_disc, vol_disc)

        # 5) Compute final rate
        if currency == "rub":
            final_rate = base_rate + best_disc
        else:
            final_rate = base_rate - best_disc
        final_rate = round(max(final_rate, 0.01), 2)

        if currency == "rub" and amount < MIN_RUB_TO_MNT:
            return bot.send_message(
                user_id,
                t(lang, "exchange_min_rub_to_mnt", min_rub=MIN_RUB_TO_MNT),
                parse_mode="Markdown"
            )


        currency_from = currency
        currency_to = "mnt" if currency == "rub" else "rub"

        if currency=="mnt":
            min_mnt = ceil(MIN_RUB * final_rate)
            if amount < min_mnt:
                return bot.send_message(
                    user_id,
                    t(lang, "exchange_min_amount", min_rub=MIN_RUB, min_mnt=min_mnt),
                    parse_mode="Markdown"
                )

        flow_token = session.get("exchange_flow_token") or _generate_exchange_flow_token()
        if not session.get("exchange_flow_token"):
            update_user_session(user_id, {"exchange_flow_token": flow_token})

        bank_markup = None
        next_state = "waiting_for_receipt"
        if currency == "rub":
            bank_markup = _build_rub_bank_markup(user_id, flow_token)
            if not bank_markup:
                bot.send_message(user_id, t(lang, "exchange_no_banks"))
                return
            next_state = "awaiting_rub_bank_selection"

        # Save session
        update_user_session(user_id, {
            "state": next_state,
            "amount": amount,
            "currency_from": currency_from,
            "currency_to": currency_to,
            "rate": final_rate,
            "invoice": invoice,
            "promo_discount": best_disc,
        })


        # Respond to user
        if currency == "rub":
            exchanged = amount * final_rate
            message_text = f"💱 {amount:,} RUB → {int(exchanged):,} MNT"

            bot.send_message(
                user_id,
                t(lang, "exchange_choose_rub_bank_custom", msg=message_text),
                parse_mode="Markdown",
                reply_markup=bank_markup
            )
        else:
            exchanged = amount / final_rate
            message_text = f"💱 {amount:,} MNT → {round(exchanged, 2):,} RUB"

            bot.send_message(
                user_id,
                t(lang, "exchange_send_receipt_mnt", msg=message_text, bank=BANK_DETAILS_MNT, amount=amount, invoice=invoice),
                parse_mode="Markdown"
            )
    except ValueError:
        # This will catch both non-positive numbers (raised above)
        # and any int(…) failures (though digits-only check handles most)
        bot.send_message(user_id, t(lang, "error_number_input"))
        update_user_session(user_id, {"state": state})
        return



@bot.callback_query_handler(func=lambda call: call.data.startswith("rubmnt_bank_"))
def handle_rub_mnt_bank_selection(call):
    user_id = call.message.chat.id
    if not ensure_exchange_available(user_id):
        bot.answer_callback_query(call.id)
        return
    lang = get_user_lang(user_id)

    try:
        callback_payload, flow_token = call.data.rsplit("_", 1)
        key = callback_payload.replace("rubmnt_bank_", "")
    except Exception as e:
        print(f"[ERROR] Invalid callback_data for RUB bank selection: {call.data} ({e})")
        bot.answer_callback_query(call.id, "❌ Invalid button data.", show_alert=True)
        return

    session = _validate_exchange_button(call, "awaiting_rub_bank_selection", flow_token)
    if not session:
        return

    bot.answer_callback_query(call.id)

    bank_map = session.get("rub_bank_map", {})
    bank_details = bank_map.get(key)
    if not bank_details:
        bot.send_message(user_id, t(lang, "exchange_bank_not_found"))
        return
    
    amount = session.get("amount")
    invoice = session.get("invoice")
    final_rate = session.get("rate")

    exchanged = amount * final_rate
    message_text = f"💱 {amount:,} RUB → {int(exchanged):,} MNT"

    bot.send_message(
        user_id,
        t(lang, "exchange_send_receipt_rub", msg=message_text, bank=bank_details, amount=amount, invoice=invoice),
        parse_mode="Markdown"
    )

    # ✅ Switch to receipt upload step
    update_user_session(user_id, {"state": "waiting_for_receipt"})


# 💾 Хадгалсан дансны мэдээллээ ашиглах
@bot.callback_query_handler(func=lambda call: call.data == "use_saved_bank")
def use_saved_bank(call):
    user_id = call.message.chat.id
    if not ensure_exchange_available(user_id):
        bot.answer_callback_query(call.id)
        return
    lang = get_user_lang(user_id)
    if get_state(user_id) != "waiting_for_bank":
        bot.send_message(user_id, t(lang, "saved_bank_not_in_mode"))
        return

    try:
        response = supabase.table("users").select("bank_mnt, bank_rub").eq("id", user_id).execute()
        user = response.data[0] if response.data else None

        if not user:
            bot.send_message(user_id, t(lang, "error_registration_not_found"))
            return
        session = get_user_session(user_id)
        if not session:
            bot.send_message(user_id, t(lang, "error_session_not_found"))
            return



        currency_from = session["currency_from"]

        if currency_from == "rub":
            bank_info = user.get("bank_mnt", "").strip()
            expected_fields = (3, 4)  # 3 (legacy) or 4 (with phone)
            format_note = t(lang, "saved_bank_format_note_mnt")
        else:
            bank_info = user.get("bank_rub", "").strip()
            expected_fields = (4,)
            format_note = t(lang, "saved_bank_format_note_rub")

        if not bank_info:
            bot.send_message(user_id, t(lang, "saved_bank_not_found"))
            return

        parts = [p.strip() for p in bank_info.split(",")]
        # For MNT: require at least first 3 fields non-empty; phone (4th) can be empty
        required_parts = parts[:3] if currency_from == "rub" else parts
        if len(parts) not in expected_fields or any(not p for p in required_parts):
            bot.send_message(user_id, t(lang, "saved_bank_format_error", note=format_note))
            return

        # ✅ Show Preview and ask for confirmation
        markup = InlineKeyboardMarkup()
        markup.add(
            InlineKeyboardButton(t(lang, "btn_confirm"), callback_data=f"confirm_saved_bank"),
            InlineKeyboardButton(t(lang, "btn_cancel"), callback_data="cancel_saved_bank")
        )

        bot.send_message(user_id,
                         t(lang, "saved_bank_preview", bank=bank_info),
                         reply_markup=markup,
                         parse_mode="Markdown")
        update_user_session(user_id, {"state": "previewing_saved_bank"})
        user_profiles[user_id] = {"preview_bank_info": bank_info}

    except Exception as e:
        print(f"❌ Error using saved bank: {e}")
        bot.send_message(user_id, t(lang, "saved_bank_error"))


@bot.callback_query_handler(func=lambda call: call.data in ["confirm_saved_bank", "cancel_saved_bank"])
def handle_preview_decision(call):
    user_id = call.message.chat.id
    if not ensure_exchange_available(user_id):
        bot.answer_callback_query(call.id)
        return
    lang = get_user_lang(user_id)
    if call.data == "cancel_saved_bank":
        update_user_session(user_id, {"state": "waiting_for_bank"})

        bot.send_message(user_id, t(lang, "saved_bank_cancelled"))
        return

    # If confirmed
    bank_info = user_profiles.get(user_id, {}).get("preview_bank_info")
    if not bank_info:
        bot.send_message(user_id, t(lang, "saved_bank_info_not_found"))
        return

    # Fake message to trigger the receive_bank_details function
    fake_msg = type('FakeMessage', (object,), {
        "chat": type('Chat', (), {"id": user_id}),
        "text": bank_info
    })

    receive_bank_details(fake_msg)


# ✅ **Step 2: User Sends Banking Details → Notify Operator**
@bot.message_handler(func=lambda message: get_state(message.chat.id) == "waiting_for_bank")
def receive_bank_details(message):
    user_id = message.chat.id
    if not ensure_exchange_available(user_id):
        return
    lang = get_user_lang(user_id)
    bank_details = message.text.strip()

    # ✅ Step 1: Check if session exists
    session = get_user_session(user_id)
    if not session:
        bot.send_message(user_id, t(lang, "error_session_not_found"))
        return

    invoice = session.get("invoice")
    if not invoice:
        bot.send_message(user_id, t(lang, "error_invoice_not_found"))
        return

    # ✅ Step 2: Validate bank format (must be 4 parts)
    currency_to = session.get("currency_to")
    if currency_to == "mnt":
        expected_fields = (3, 4)  # 3 (legacy) or 4 (with phone)
    else:
        expected_fields = (4,)

    parts = [p.strip() for p in bank_details.split(",")]
    # For MNT: require at least first 3 fields non-empty; phone (4th) can be empty
    required_parts = parts[:3] if currency_to == "mnt" else parts
    if len(parts) not in expected_fields or any(not p for p in required_parts):
        fmt_key = "bank_format_error_mnt" if currency_to == "mnt" else "bank_format_error_rub"
        bot.send_message(
            user_id,
            t(lang, fmt_key),
            parse_mode="Markdown"
        )
        return

    # ✅ Step 3: Ensure receipt has been received (i.e. pending_transactions initialized)
    if user_id not in pending_transactions or not pending_transactions[user_id].get("receipt_id"):
        bot.send_message(user_id, t(lang, "receipt_required"))
        return

    # ✅ Step 4: Save bank details
    pending_transactions[user_id]["bank_details"] = bank_details
    clear_state(user_id)

    # ✅ Step 5: Record in Supabase
    try:
        record_transaction(
            user_id,
            invoice,
            float(session["amount"]),
            session["currency_from"],
            session["currency_to"],
            float(session["rate"]),
            bank_details,
            "pending",
            session.get("promo_code")
        )
    except Exception as e:
        print(f"❌ Failed to save transaction: {e}")
        return

    # ✅ Step 6: Notify operator
    try:
        amount = float(session["amount"])
        currency = session["currency_from"]
        operator_id = HIGH_VALUE_OPERATOR_CHAT_ID if (
            (currency == "rub" and amount > 50000) or (currency == "mnt" and amount > 2500000)
        ) else get_current_shift_operator_id()

        notify_operator(
            user_id,
            invoice,
            pending_transactions[user_id]["receipt_id"],
            bank_details,
            operator_id
        )

        # Check if transaction amount is over 20000 rubles in either direction
        currency_from = session.get("currency_from")
        amount_rub = amount
        if currency_from == "mnt":
            # Convert MNT to RUB to check threshold
            rate = float(session.get("rate", 1))
            amount_rub = amount / rate if rate > 0 else amount
        
        if amount_rub > 20000:
            bot.send_message(user_id, t(lang, "bank_received_large"))
        else:
            bot.send_message(user_id, t(lang, "bank_received"))
    except Exception as e:
        print(f"❌ Operator notify error: {e}")
        bot.send_message(user_id, t(lang, "error_admin_notify"))



def notify_operator(user_id, invoice, receipt_id, bank_details, operator_chat_id):
    session = get_user_session(user_id)
    if not session:
        bot.send_message(user_id, "⚠️ Notify operator session олдсонгүй")
        return

    try:
        user_info = bot.get_chat(user_id)
        user_display = user_info.first_name
        if user_info.last_name:
            user_display += f" {user_info.last_name}"

        user_link = f"[{user_display}](tg://user?id={user_id})"

        if user_info.username:
            username_link = f"[@{user_info.username}](https://t.me/{user_info.username})"
        else:
            username_link = "`NoUsername`"

        id_link = f"[`{user_id}`](tg://user?id={user_id})"

        user_line = f"{user_link} — {username_link} — {id_link}"
    except:
        user_line = f"[`{user_id}`](tg://user?id={user_id})"

    rate = session.get("rate")
    amount = session.get("amount")
    currency_from = session.get("currency_from")
    currency_to = session.get("currency_to")

    converted = round(amount * rate if currency_from.lower() == "rub" else amount / rate, 2)

    operator_id = get_current_shift_operator_id()

    # 📝 Save caption to reuse
    lang = get_user_lang(operator_id)
    caption = t(lang, "admin_new_request_caption", invoice=invoice, user_line=user_line, amount=amount, currency_from=currency_from, currency_to=currency_to, converted=converted, bank_details=bank_details)

    markup = InlineKeyboardMarkup()
    markup.add(
        InlineKeyboardButton(t(lang, "admin_btn_confirm"), callback_data=f"confirm_{user_id}"),
        InlineKeyboardButton(t(lang, "admin_btn_reject"), callback_data=f"reject_{user_id}")
    )
    # ➤ Always send to current shift operator
    bot.send_photo(operator_id, receipt_id, caption=caption, parse_mode="Markdown", reply_markup=markup)

    # ➤ Also notify always-notify operator if it's different
    for always_id in ALWAYS_NOTIFY_OPERATOR_ID:
        bot.send_photo(
            always_id,
            receipt_id,
            caption=caption,
            parse_mode="Markdown",
            reply_markup=markup
        )

    # ➤ Notify high-value operator if the amount is large
    if (currency_from == "RUB" and amount > 50000) or (currency_from == "MNT" and amount > 2500000):
        for special_op in [HIGH_VALUE_OPERATOR_CHAT_ID]:
            if special_op not in [operator_chat_id] + ALWAYS_NOTIFY_OPERATOR_ID:
                bot.send_photo(special_op, receipt_id, caption=caption, parse_mode="Markdown", reply_markup=markup)


@bot.callback_query_handler(func=lambda call: call.data.startswith("confirm_") or call.data.startswith("reject_") or call.data.startswith("pending_") or call.data.startswith("waitedit_") or call.data.startswith("refresh_"))
def handle_transaction_action(call):
    if call.from_user.id not in ALLOWED_ADMINS:
        bot.answer_callback_query(call.id, t(get_user_lang(call.from_user.id), "admin_unauthorized"), show_alert=True)
        return

    action, user_id_str = call.data.split("_", 1)
    is_confirmed = action == "confirm"
    is_pending = action == "pending"
    is_waiting_edit = action == "waitedit"
    is_refresh = action == "refresh"
    user_id = int(user_id_str)

    # Handle refresh action
    if is_refresh:
        # Extract invoice from the message and refresh the status
        text = call.message.text or ""
        invoice_match = re.search(r'`([^`]+)`', text)
        if invoice_match:
            invoice = invoice_match.group(1)
            # Send updated status message
            bot.send_message(
                call.from_user.id,
                f"/status {invoice}",
                parse_mode="Markdown"
            )
            bot.answer_callback_query(call.id, t(get_user_lang(call.from_user.id), "admin_status_refreshed"), show_alert=True)
        else:
            bot.answer_callback_query(call.id, t(get_user_lang(call.from_user.id), "admin_invoice_not_found"), show_alert=True)
        return

    # 1️⃣ Extract invoice number from message (поддерживаем оба формата)
    text = call.message.caption or call.message.text or ""
    
    # Сначала ищем новый формат: YYYYMMDD-HHMMSS-XX
    match = re.search(r'(\d{8}-\d{6}-\d{2})', text)
    if match:
        invoice = match.group(1)
    else:
        # Если не найден новый формат, ищем старый: YYYYMMDD_HHMMSS
        match = re.search(r'(\d{8}_\d{6})', text)
        if match:
            invoice = match.group(1)
        else:
            bot.answer_callback_query(call.id, t(get_user_lang(call.from_user.id), "admin_request_not_found"), show_alert=True)
            return
    
    resp = supabase.table("transactions") \
                   .select("status") \
                   .eq("invoice", invoice) \
                   .limit(1) \
                   .execute()
    current_status = resp.data[0]["status"] if resp.data else None

    if not is_pending and not is_waiting_edit and current_status != "pending":
        # if it's already successful or rejected, tell the admin
        return bot.answer_callback_query(
            call.id,
            t(get_user_lang(call.from_user.id), "admin_already_processed"),
            show_alert=True
        )
    if is_waiting_edit and current_status not in ["pending", "approved"]:
        return bot.answer_callback_query(
            call.id,
            t(get_user_lang(call.from_user.id), "admin_already_processed"),
            show_alert=True
        )
    # 2️⃣ Get transaction from Supabase
    response = supabase.table("transactions").select("*").eq("invoice", invoice).limit(1).execute()
    if not response.data:
        bot.answer_callback_query(call.id, t(get_user_lang(call.from_user.id), "admin_txn_not_in_db"), show_alert=True)
        return

    txn = response.data[0]
    currency_from = txn["currency_from"].upper()
    currency_to = txn["currency_to"].upper()
    amount = float(txn["amount"])
    rate = float(txn["rate"])
    bank_details = txn.get("bank_details", "")
    receipt_id = txn.get("receipt_id")

    # 3️⃣ Prepare timestamp and payload
    now_moscow = datetime.now(MOSCOW_TZ).isoformat()
    if is_confirmed:
        updates = {
            "status":       "successful",
            "completed_at": now_moscow,
            "completed_by_admin": call.from_user.id,
        }
    elif is_waiting_edit:
        updates = {
            "status": "waiting_edit",
            "waiting_started_at": now_moscow,
            "timer_paused_at": now_moscow,
            "completed_at": None,
            "completed_by_admin": None,
        }
    elif is_pending:
        updates = {
            "status": "pending",
            "completed_at": None,
            "completed_by_admin": None,
            "admin_comment": None
        }
    else:
        updates = {
            "status":       "rejected",
            # if you want to track when we rejected too:
            # "rejected_at": now_moscow
        }

    # 4️⃣ Write back to Supabase
    supabase.table("transactions") \
            .update(updates) \
            .eq("invoice", invoice) \
            .execute()

    # 🎁 Award gift for transactions >= 10,000 RUB
    if is_confirmed:
        award_gift_for_transaction(user_id, amount, currency_from, currency_to, rate)

    # 4️⃣ Notify user
    lang_admin = get_user_lang(call.from_user.id)
    if is_pending:
        # Notify user about status change to pending
        lang_user = get_user_lang(user_id)
        bot.send_message(
            user_id,
            t(lang_user, "txn_pending_again", invoice=invoice),
            parse_mode="Markdown"
        )
        bot.answer_callback_query(call.id, t(lang_admin, "admin_set_pending"), show_alert=True)
    elif is_waiting_edit:
        lang_user = get_user_lang(user_id)
        edit_url = WEBAPP_URL
        separator = "&" if "?" in edit_url else "?"
        edit_link = f"{edit_url}{separator}edit-invoice={invoice}"
        edit_markup = InlineKeyboardMarkup()
        edit_markup.add(InlineKeyboardButton(t(lang_user, "btn_edit_request"), web_app=WebAppInfo(url=edit_link)))

        bot.send_message(
            user_id,
            t(lang_user, "txn_waiting_edit", invoice=invoice),
            parse_mode="Markdown",
            reply_markup=edit_markup,
        )
        bot.answer_callback_query(call.id, t(lang_admin, "admin_set_waiting_edit"), show_alert=True)
    elif is_confirmed:
        # ✅ Calculate how much to send
        converted = round(amount * rate if currency_from == "RUB" else amount / rate, 2)

        # ✅ Notify user
        lang_user = get_user_lang(user_id)
        bot.send_message(
            user_id,
            t(lang_user, "txn_confirmed", invoice=invoice),
            parse_mode="Markdown"
        )

        # ✅ Display to operator
        try:
            # Parse payout/processing details. Top-up requests use a shorter format.
            parts = [x.strip() for x in bank_details.split(",")] if bank_details else []

            bank_info = None
            if len(parts) == 2:
                # Phone top-up: phone number, telecom
                phone, telecom = parts
                bank_info = t(lang_admin, "admin_payout_topup", invoice=invoice, converted=converted, phone=sanitize_markdown(phone), telecom=sanitize_markdown(telecom), rate=rate)
            elif currency_to == "MNT" and len(parts) >= 3:
                bank, iban, name = parts[:3]
                bank_info = t(lang_admin, "admin_payout_mnt", invoice=invoice, converted=converted, bank=bank, iban=iban, name=name, rate=rate)
            elif currency_to == "RUB" and len(parts) >= 4:
                bank, phone, card, name = parts[:4]
                bank_info = t(lang_admin, "admin_payout_rub", invoice=invoice, converted=converted, bank=bank, phone=phone, card=card, name=name, rate=rate)

            if not bank_info:
                raise ValueError("Unsupported bank details format")

            msg = bot.send_message(call.message.chat.id, bank_info, parse_mode="Markdown")
        except Exception as e:
            print(f"❌ Error formatting bank details: {e}")
            bot.send_message(call.message.chat.id, t(lang_admin, "admin_payout_format_error"))

    else:
        # Ask for rejection comment
        update_user_session(call.from_user.id, {"state": f"awaiting_tx_rejection_comment|{invoice}|{user_id}"})
        bot.send_message(call.from_user.id, t(lang_admin, "admin_rejection_prompt", invoice=invoice), parse_mode="Markdown")


    # ✅ Clean up: remove buttoned message if desired
    try:
        bot.delete_message(call.message.chat.id, call.message.message_id)
    except:
        pass


@bot.message_handler(func=lambda m: get_state(m.chat.id).startswith("awaiting_tx_rejection_comment|"))
def handle_transaction_rejection_comment(message):
    admin_id = message.chat.id
    comment = message.text.strip()

    # Full string after the prefix
    state = get_state(admin_id)
    if not state.startswith("awaiting_tx_rejection_comment|"):
        bot.send_message(admin_id, t(get_user_lang(admin_id), "admin_rejection_state_error"))
        return
    
    # Extract invoice and user_id from state
    # Format: "awaiting_tx_rejection_comment|INVOICE|USERID"
    state_parts = state.replace("awaiting_tx_rejection_comment|", "").split("|")
    
    if len(state_parts) < 2:
        bot.send_message(admin_id, t(get_user_lang(admin_id), "admin_rejection_data_error"))
        return
    
    invoice = state_parts[0]
    user_id = int(state_parts[1])

    try:
        # Update DB with rejection + comment
        supabase.table("transactions").update({
            "status": "rejected",
            "rejection_comment": comment
        }).eq("invoice", invoice).execute()

        # Notify both parties
        lang_admin = get_user_lang(admin_id)
        bot.send_message(
            admin_id,
            t(lang_admin, "admin_rejection_success", invoice=invoice),
            parse_mode="Markdown"
        )

        lang_user = get_user_lang(user_id)
        bot.send_message(
            user_id,
            t(lang_user, "user_txn_rejected_with_reason", invoice=invoice, comment=comment, support=CONTACT_SUPPORT),
            parse_mode="Markdown"
        )
        update_user_session(user_id, {"invoice": None})

    except Exception as e:
        print(f"❌ Rejection DB error: {e}")
        bot.send_message(admin_id, t(get_user_lang(admin_id), "admin_rejection_error"))
    finally:
        clear_state(admin_id)
        pending_transactions.pop(user_id, None)

# 🔙 Back to Main Menu
@bot.callback_query_handler(func=lambda call: call.data == "back_main")
def back_main(call):
    lang = get_user_lang(call.from_user.id)
    bot.send_message(call.message.chat.id, t(lang, "back_main"), reply_markup=main_menu(lang))

# ==================== REFERRAL PROGRAM ====================

def generate_referral_link(user_id: int) -> str:
    """Generate a unique referral link for the user"""
    # Use the first channel for referral links
    channel = REFERRAL_CHANNELS[0]
    channel_clean = channel.replace('@', '').replace('+', '')
    return f"https://t.me/{channel_clean}"

def get_user_referral_status(user_id: int):
    """Get user's referral status from database"""
    try:
        response = supabase.table("referrals").select("*").eq("referrer_id", user_id).execute()
        referrals = response.data if response.data else []
        
        # Count by status
        pending = len([r for r in referrals if r.get("status") == "pending"])
        accepted = len([r for r in referrals if r.get("status") == "accepted"])
        rejected = len([r for r in referrals if r.get("status") == "rejected"])
        total = len(referrals)
        
        return {
            "total": total,
            "pending": pending,
            "accepted": accepted,
            "rejected": rejected,
            "referrals": referrals
        }
    except Exception as e:
        print(f"❌ Error getting referral status: {e}")
        return {"total": 0, "pending": 0, "accepted": 0, "rejected": 0, "referrals": []}


def award_referral_promo_codes(user_id: int):
    """Create missing referral promo codes based on the user's accepted referrals count.
    One promo code per REFERRAL_REQUIRED_COUNT accepted referrals. Uses 'source'='referral'.
    Returns list of created promo codes (empty if none created).
    """
    try:
        # Count accepted referrals that haven't been used for awarding yet (awarded=false)
        try:
            resp = supabase.table("referrals").select("id").eq("referrer_id", user_id).eq("status", "accepted").eq("awarded", False).execute()
        except Exception:
            # If awarded column isn't present, fall back to counting all accepted referrals
            resp = supabase.table("referrals").select("id").eq("referrer_id", user_id).eq("status", "accepted").execute()
        accepted_count = len(resp.data) if resp.data else 0

        desired_awards = accepted_count // REFERRAL_REQUIRED_COUNT
        promo_resp = supabase.table("promo_codes").select("id").eq("user_id", user_id).eq("source", "referral").execute()
        existing_awards = len(promo_resp.data) if promo_resp.data else 0

        to_award = max(0, desired_awards - existing_awards)
        if to_award <= 0:
            return []

        created_codes = []
        for _ in range(to_award):
            promo_code = generate_promo_code()
            success = create_promo_code_in_db(promo_code, user_id=user_id, discount=0.3, source="referral")
            if success:
                created_codes.append(promo_code)
        if created_codes:
            # Mark the used referrals as awarded (so they don't get reused)
            try:
                count_to_mark = REFERRAL_REQUIRED_COUNT * len(created_codes)
                ids_resp = supabase.table("referrals").select("id").eq("referrer_id", user_id).eq("status", "accepted").eq("awarded", False).order("verified_at", asc=True).limit(count_to_mark).execute()
                ids = [r["id"] for r in ids_resp.data] if ids_resp.data else []
                if ids:
                    supabase.table("referrals").update({"awarded": True}).in_("id", ids).execute()
            except Exception as e:
                print(f"❌ Failed to mark referrals awarded: {e}")
        if created_codes:
            codes_text = "\n".join([f"  • `{c}`" for c in created_codes])
            bot.send_message(
                user_id,
                f"🎉 Баяр хүргэе! Та {accepted_count} найз урьсан тул {len(created_codes)} ширхэг промокод авлаа!\n\n{codes_text}\n\n💰 Хөнгөлөлт: 0.3 MNT\n",
                parse_mode="Markdown",
                reply_markup=InlineKeyboardMarkup().add(InlineKeyboardButton("🔙 Буцах", callback_data="back_main"))
            )
        return created_codes
    except Exception as e:
        print(f"❌ Failed to award referral promo codes for {user_id}: {e}")
        return []


def mark_referrals_awarded(user_id: int, count_to_mark: int):
    """Mark the earliest accepted, unawarded referral rows as awarded.
    Returns number of rows marked.
    """
    try:
        ids_resp = supabase.table("referrals").select("id").eq("referrer_id", user_id).eq("status", "accepted").eq("awarded", False).order("verified_at", asc=True).limit(count_to_mark).execute()
        ids = [r["id"] for r in ids_resp.data] if ids_resp.data else []
        if not ids:
            return 0
        supabase.table("referrals").update({"awarded": True}).in_("id", ids).execute()
        return len(ids)
    except Exception as e:
        print(f"❌ Failed to mark referrals as awarded: {e}")
        return 0


def has_pending_referral_confirmation(user_id: int) -> bool:
    try:
        for v in pending_referral_confirmations.values():
            if v.get("user_id") == user_id:
                return True
    except Exception:
        pass
    return False


# --- Referral invite link helpers ---

def _cache_invite_mapping(referrer_id: int, invite_link: str):
    """Cache and persist invite link mapping to Supabase"""
    if invite_link:
        invite_link_to_referrer[invite_link] = referrer_id
    referrer_to_invite_link[referrer_id] = invite_link
    
    # Persist to Supabase for tracking across bot restarts
    try:
        # Check if link already exists
        existing = supabase.table("referral_links").select("id").eq("invite_link", invite_link).limit(1).execute()
        if existing.data:
            # Update existing record
            supabase.table("referral_links").update({"referrer_id": referrer_id, "created_at": datetime.now(MOSCOW_TZ).isoformat()}).eq("invite_link", invite_link).execute()
        else:
            # Insert new record
            supabase.table("referral_links").insert({
                "referrer_id": referrer_id,
                "invite_link": invite_link,
                "created_at": datetime.now(MOSCOW_TZ).isoformat(),
                "is_active": True
            }).execute()
        print(f"✅ Saved invite link mapping: {referrer_id} -> {invite_link}")
    except Exception as e:
        print(f"⚠️ Failed to persist invite link to database: {e}")


def _lookup_referrer_by_invite(invite_link: str):
    """Lookup referrer ID from invite link (check cache first, then database)"""
    # Check memory cache first (fastest)
    if invite_link in invite_link_to_referrer:
        return invite_link_to_referrer[invite_link]
    
    # Check Supabase database
    try:
        resp = supabase.table("referral_links").select("referrer_id").eq("invite_link", invite_link).limit(1).execute()
        if resp.data:
            rid = resp.data[0].get("referrer_id")
            if rid:
                _cache_invite_mapping(int(rid), invite_link)
                print(f"✅ Found referrer {rid} for link {invite_link} in database")
                return int(rid)
    except Exception as e:
        print(f"❌ Failed to lookup referrer by invite: {e}")
    
    print(f"⚠️ No referrer found for invite link: {invite_link}")
    return None


def get_or_create_referral_link(referrer_id: int) -> str | None:
    """Get or create a single invite link for user that expires after 5 members join.
    Reuses existing link if valid, creates new one if expired or doesn't exist.
    Persists all links to Supabase for tracking.
    """
    try:
        # Step 1: Check memory cache first
        if referrer_id in referrer_to_invite_link:
            cached_link = referrer_to_invite_link[referrer_id]
            if cached_link:
                # Try to verify the link is still valid in Telegram
                try:
                    link_info = bot.get_chat_invite_link(REFERRAL_TARGET_CHAT_ID, cached_link)
                    if link_info and not link_info.is_expired:
                        print(f"✅ Reusing valid cached invite link for {referrer_id}: {cached_link} (members: {link_info.member_count}/{link_info.member_limit})")
                        return cached_link
                    else:
                        print(f"⚠️ Cached link expired for {referrer_id}, will create new one")
                except Exception as e:
                    print(f"⚠️ Could not verify cached link for {referrer_id}: {e}")
        
        # Step 2: Check Supabase for existing active link
        try:
            db_resp = supabase.table("referral_links").select("invite_link").eq("referrer_id", referrer_id).eq("is_active", True).limit(1).execute()
            if db_resp.data:
                db_link = db_resp.data[0].get("invite_link")
                if db_link:
                    # Verify it's still valid in Telegram
                    try:
                        link_info = bot.get_chat_invite_link(REFERRAL_TARGET_CHAT_ID, db_link)
                        if link_info and not link_info.is_expired:
                            _cache_invite_mapping(referrer_id, db_link)
                            print(f"✅ Found valid invite link in database for {referrer_id}: {db_link}")
                            return db_link
                    except Exception as e:
                        print(f"⚠️ Database link invalid for {referrer_id}: {e}")
        except Exception as e:
            print(f"⚠️ Failed to check database for existing link: {e}")
        
        # Step 3: Create a new link (all previous ones are expired/invalid)
        print(f"📝 Creating new invite link for {referrer_id}...")
        link_obj = bot.create_chat_invite_link(
            chat_id=REFERRAL_TARGET_CHAT_ID,
            name=f"ref_{referrer_id}_{int(datetime.now(MOSCOW_TZ).timestamp())}",
            member_limit=5,  # Expires after 5 joins
            creates_join_request=False
        )
        invite_link = link_obj.invite_link
        
        # Mark old links as inactive in database
        try:
            supabase.table("referral_links").update({"is_active": False}).eq("referrer_id", referrer_id).execute()
            print(f"✅ Marked old links as inactive for {referrer_id}")
        except Exception as e:
            print(f"⚠️ Failed to mark old links inactive: {e}")
        
        # Cache and persist the new link
        _cache_invite_mapping(referrer_id, invite_link)
        print(f"✅ Created and saved new invite link for {referrer_id} (expires after 5 joins): {invite_link}")
        return invite_link
        
    except Exception as e:
        print(f"❌ Failed to get/create invite link for {referrer_id}: {e}")
        import traceback
        traceback.print_exc()
        return None


def auto_award_referrals(referrer_id: int):
    try:
        resp = supabase.table("referrals").select("id").eq("referrer_id", referrer_id).eq("status", "accepted").eq("awarded", False).execute()
        accepted_unawarded = len(resp.data) if resp.data else 0
        print(f"📊 User {referrer_id} has {accepted_unawarded} unawarded accepted referrals")
    except Exception as e:
        print(f"❌ Failed to count unawarded referrals: {e}")
        return

    to_award = accepted_unawarded // REFERRAL_REQUIRED_COUNT
    if to_award <= 0:
        print(f"ℹ️ No promo codes to award yet (need {REFERRAL_REQUIRED_COUNT - (accepted_unawarded % REFERRAL_REQUIRED_COUNT)} more referrals)")
        return

    print(f"🎁 Awarding {to_award} promo code(s) to user {referrer_id}")
    created_codes = []
    for _ in range(to_award):
        code = generate_promo_code()
        if create_promo_code_in_db(code, user_id=referrer_id, discount=0.3, source="referral_auto"):
            created_codes.append(code)

    if created_codes:
        try:
            codes_text = "\n".join([f"  • `{sanitize_markdown(c)}`" for c in created_codes])
            bot.send_message(referrer_id, f"🎉 Танд {len(created_codes)} промокод олголоо!\n\n{codes_text}\n\n💰 Хөнгөлөлт: 0.3", parse_mode="Markdown")
            print(f"✅ Sent {len(created_codes)} promo code(s) to user {referrer_id}")
        except Exception as e:
            print(f"⚠️ Failed to send promo codes to user {referrer_id}: {e}")
        try:
            mark_referrals_awarded(referrer_id, REFERRAL_REQUIRED_COUNT * len(created_codes))
            print(f"✅ Marked {REFERRAL_REQUIRED_COUNT * len(created_codes)} referrals as awarded for user {referrer_id}")
        except Exception as e:
            print(f"❌ Failed to mark referrals awarded: {e}")


def send_referral_confirmation_request(user_id: int, accepted_count: int, to_award: int):
    """Send a referral confirmation request to the moderator for manual approval.
    Returns the message object of moderator message or None on error.
    """
    try:
        # Get basic user info for context
        resp = supabase.table("users").select("first_name, last_name, phone").eq("id", user_id).limit(1).execute()
        user_info = resp.data[0] if resp.data else {}
        display_name = user_info.get("first_name") or user_info.get("last_name") or str(user_id)

        # Fetch recent referrals to show in moderator message
        # Query recent referrals for this referrer; try several approaches to be robust
        recent = []
        try:
            recent_resp = supabase.table("referrals").select("friend_username,status,created_at,verified_at").eq("referrer_id", int(user_id)).order("created_at", desc=False).limit(REFERRAL_REQUIRED_COUNT*5).execute()
            recent = recent_resp.data if recent_resp.data else []
        except Exception as e:
            print(f"❌ Debug: first recent referral query failed for user {user_id}: {e}")
            # Try querying with stringified user_id (some DBs store int as text)
            try:
                recent_resp = supabase.table("referrals").select("friend_username,status,created_at,verified_at").eq("referrer_id", str(user_id)).order("created_at", desc=False).limit(REFERRAL_REQUIRED_COUNT*5).execute()
                recent = recent_resp.data if recent_resp.data else []
            except Exception as e2:
                print(f"❌ Debug: fallback recent referral query failed for user {user_id}: {e2}")
                recent = []

        list_text = ""
        if not recent:
            print(f"🔎 Debug: no recent referrals found for user {user_id}. recent_resp: {recent}")
            # Try fetching all referrals (without limit) as a fallback
            try:
                all_resp = supabase.table("referrals").select("friend_username,status,created_at,verified_at").eq("referrer_id", int(user_id)).order("created_at", desc=False).execute()
                if all_resp.data:
                    recent = all_resp.data
                else:
                    # try string id
                    all_resp = supabase.table("referrals").select("friend_username,status,created_at,verified_at").eq("referrer_id", str(user_id)).order("created_at", desc=False).execute()
                    recent = all_resp.data if all_resp.data else []
            except Exception as e3:
                print(f"❌ Debug: all referrals fallback failed for user {user_id}: {e3}")
        for r in recent:
            uname = r.get("friend_username") or "(no username)"
            # Normalize: ensure username starts with @
            if not uname.startswith("@") and uname != "(no username)":
                uname = f"@{uname}"
            st = r.get("status") or "pending"
            list_text += f"\n  - {uname} : {st}"
        if not list_text:
            list_text = "\n  - (no referrals found)"

        lang_mod = get_user_lang(MODERATOR_ID)
        text = t(lang_mod, "admin_referral_request", display_name=display_name, user_id=user_id, accepted_count=accepted_count, to_award=to_award, list_text=list_text)

        markup = InlineKeyboardMarkup()
        markup.add(InlineKeyboardButton(t(lang_mod, "admin_btn_confirm"), callback_data=f"confirm_referral:{user_id}"))
        markup.add(InlineKeyboardButton(t(lang_mod, "admin_btn_reject"), callback_data=f"reject_referral:{user_id}"))

        admin_msg = bot.send_message(MODERATOR_ID, text, reply_markup=markup, parse_mode="Markdown")
        # Store mapping to allow deletion / tracking
        pending_referral_confirmations[admin_msg.message_id] = {"user_id": user_id, "accepted_count": accepted_count, "requested_awards": to_award}
        return admin_msg
    except Exception as e:
        print(f"❌ Failed to send referral confirmation request to moderator: {e}")
        return None


@bot.chat_member_handler()
def handle_chat_member_update(update):
    """Auto-credit referrals when users join via invite links."""
    try:
        print(f"📥 Received chat_member_update: chat_id={update.chat.id if update.chat else None}")
        
        # ChatMemberUpdated object has 'chat', 'from_user', 'old_chat_member', 'new_chat_member', 'invite_link'
        if not update.chat or update.chat.id != REFERRAL_TARGET_CHAT_ID:
            print(f"⏭️ Skipping update - not target chat (got {update.chat.id if update.chat else None}, expected {REFERRAL_TARGET_CHAT_ID})")
            return

        # Check if user is joining (old status was not member, new status is member)
        old_status = update.old_chat_member.status if update.old_chat_member else None
        new_status = update.new_chat_member.status if update.new_chat_member else None
        
        print(f"👤 Status change: {old_status} → {new_status}")
        
        # User must be newly joining or upgrading to member status
        if new_status not in ["member", "administrator", "creator"]:
            print(f"⏭️ Skipping - new status not a member: {new_status}")
            return
        if old_status in ["member", "administrator", "creator"]:
            print(f"⏭️ Skipping - user was already a member (old status: {old_status})")
            return  # Already was a member, not a new join

        # Extract invite link if present
        invite_link = None
        if update.invite_link:
            invite_link = update.invite_link.invite_link if hasattr(update.invite_link, 'invite_link') else str(update.invite_link)
        
        print(f"🔗 Invite link: {invite_link}")
        
        referrer_id = None
        if invite_link:
            referrer_id = invite_link_to_referrer.get(invite_link) or _lookup_referrer_by_invite(invite_link)
        
        if not referrer_id:
            print(f"⚠️ No referrer found for invite link: {invite_link}")
            print(f"📊 Current cache has {len(invite_link_to_referrer)} links")
            return

        # Get the user who joined
        user = update.new_chat_member.user if update.new_chat_member else None
        if not user:
            print(f"⚠️ No user found in new_chat_member")
            return
        friend_id = user.id
        friend_username = f"@{user.username}" if user.username else str(friend_id)
        
        print(f"✅ New member via referral: {friend_username} (ID: {friend_id}) referred by {referrer_id}")

        # Skip duplicates
        try:
            dup_resp = supabase.table("referrals").select("id").eq("referrer_id", referrer_id).eq("friend_user_id", friend_id).execute()
            if dup_resp.data:
                print(f"⏭️ Skipping duplicate referral: {friend_username} already referred by {referrer_id}")
                return
        except Exception as e:
            print(f"⚠️ Error checking for duplicate referral: {e}")

        referral_data = {
            "referrer_id": referrer_id,
            "friend_user_id": friend_id,
            "friend_username": friend_username,
            "status": "accepted",
            "verified_at": datetime.now(MOSCOW_TZ).isoformat(),
            "created_at": datetime.now(MOSCOW_TZ).isoformat(),
            "awarded": False,
            "invite_link": invite_link,
        }

        inserted = False
        try:
            supabase.table("referrals").insert(referral_data).execute()
            inserted = True
            print(f"✅ Referral recorded: {friend_username} (ID: {friend_id}) referred by {referrer_id}")
        except Exception as e:
            print(f"ℹ️ referral insert with user_id failed, retrying without optional fields: {e}")
            try:
                minimal = {
                    "referrer_id": referrer_id,
                    "friend_username": friend_username,
                    "status": "accepted",
                    "verified_at": datetime.now(MOSCOW_TZ).isoformat(),
                    "created_at": datetime.now(MOSCOW_TZ).isoformat(),
                    "awarded": False,
                }
                supabase.table("referrals").insert(minimal).execute()
                inserted = True
                print(f"✅ Referral recorded (minimal): {friend_username} referred by {referrer_id}")
            except Exception as e2:
                print(f"❌ Failed to record referral join: {e2}")

        if inserted:
            print(f"🎁 Checking for referral rewards for {referrer_id}...")
            auto_award_referrals(referrer_id)
    except Exception as e:
        print(f"❌ chat_member handler error: {e}")

@bot.callback_query_handler(func=lambda call: call.data == "invite_friend")
def invite_friend_handler(call):
    """Show referral program information - Manual verification"""
    user_id = call.message.chat.id
    
    # Get channel link
    channel_username = None
    for ch in REFERRAL_CHANNELS:
        if isinstance(ch, str) and ch.startswith('@'):
            channel_username = ch
            break
    channel_link = f"https://t.me/{channel_username.replace('@', '')}" if channel_username else "https://t.me/oyuns_alo"
    
    # Check current referral status
    status = get_user_referral_status(user_id)
    accepted_count = status["accepted"]
    pending_count = status["pending"]
    
    text = (
        f"👥 Найз урих хөтөлбөр\n\n"
        f"Та {REFERRAL_REQUIRED_COUNT} найзаа OYUNS ALL-IN-ONE сувагт уриад промокод авах боломжтой.\n\n"
        f"✅ Одоогийн статус: Та {accepted_count}/{REFERRAL_REQUIRED_COUNT} найзаа урьсан байна.\n\n"
        f"📋 Заавар:\n\n"
        f"1️⃣ Та найзуудаа OYUNS ALL-IN-ONE сувагт дараах линкээр урина уу:\n"
        f"🔗 {channel_link}\n\n"
        f"2️⃣ Таны найзууд манай телеграм сувагт нэгдсэний дараа доорх '✅ Би урьсан' товчийг дарна уу.\n\n"
        f"3️⃣ Товч дарсны дараагаар найзуудынхаа телеграм хаягийг илгээнэ.\n\n"
        f"4️⃣ Таны {REFERRAL_REQUIRED_COUNT} найз сувагт нэгдэн бид баталгаажуулмагц гүйлгээнд ашиглах промокодыг танд олгоно.\n\n"
    )
    
    markup = InlineKeyboardMarkup()
    markup.add(InlineKeyboardButton("✅ Би урьсан", callback_data="submit_referral_usernames"))
    markup.add(InlineKeyboardButton("🔙 Буцах", callback_data="back_main"))
    
    bot.send_message(user_id, text, reply_markup=markup)
    
    # Send forwardable message for sharing with friends
    forward_text = (
        f"Сайн уу! Би чамайг OYUNS ALL-IN-ONE сувагт нэгдэхийг урьж байна.\n\n"
        f"Доорх линкээр телеграм сувагт нэгдээрэй.\n\n"
        f"📰 Өдөр тутмын санхүүгийн мэдээлэл\n"
        f"💱 Валютын ханш\n"
        f"🤖 OYUNS ALL-IN-ONE Telegram ботын мэдээлэл\n\n"
        f"👉 {channel_link}\n\n"
        f"OYUNS ALL-IN-ONE – Илүү хурдан, илүү хялбар"
    )
    
    bot.send_message(user_id, forward_text)

def prompt_channel_join(user_id: int, referrer_id: int):
    """Prompt new user to join the channel and verify"""
    try:
        # Get channel link
        channel_username = None
        for ch in REFERRAL_CHANNELS:
            if isinstance(ch, str) and ch.startswith('@'):
                channel_username = ch
                break
        
        channel_link = f"https://t.me/{channel_username.replace('@', '')}" if channel_username else "https://t.me/oyuns_alo"
        
        text = (
            f"👋 Сайн байна уу!\n\n"
            f"Та урилгын линкээр ирсэн байна. Үргэлжлүүлэхийн тулд:\n\n"
            f"1️⃣ Эхлээд OYUNS ALL-IN-ONE сувагт нэгдэнэ үү:\n"
            f"👉 {channel_link}\n\n"
            f"2️⃣ Нэгдсэний дараа доорх **'✅ Би нэгдсэн'** товчийг дарж баталгаажуулна уу.\n\n"
            f"📌 Зөвхөн сувагт нэгдсэн тохиолдолд таны урьсан найз промокод авах боломжтой болно."
        )
        
        markup = InlineKeyboardMarkup()
        markup.add(InlineKeyboardButton("📢 OYUNS ALL-IN-ONE суваг", url=channel_link))
        markup.add(InlineKeyboardButton("✅ Би нэгдсэн", callback_data="verify_channel_join"))
        
        bot.send_message(user_id, text, parse_mode="Markdown", reply_markup=markup)
        print(f"✅ Prompted user {user_id} to join channel (referred by {referrer_id})")
        
    except Exception as e:
        print(f"❌ Failed to prompt channel join for user {user_id}: {e}")
        # Fallback: just show main menu
        bot.send_message(user_id, "👋 Сайн уу! OYUNS ALL-IN-ONE ботод тавтай морил.", reply_markup=main_menu())


@bot.callback_query_handler(func=lambda call: call.data == "verify_channel_join")
def verify_channel_join_handler(call):
    """Verify that user has joined the channel"""
    user_id = call.message.chat.id
    
    # Get pending referrer from session
    session = get_user_session(user_id)
    referrer_id = session.get("pending_referrer_id")
    
    if not referrer_id:
        bot.answer_callback_query(call.id, "❌ Урилгын мэдээлэл олдсонгүй")
        return
    
    # Check if user is actually a member of the channel
    is_member = check_user_is_member(user_id)
    
    if is_member:
        # User verified! Record the referral
        friend_username = f"@{call.from_user.username}" if call.from_user.username else str(user_id)
        
        # Check for duplicate
        try:
            dup_resp = supabase.table("referrals").select("id").eq("referrer_id", referrer_id).eq("friend_user_id", user_id).execute()
            if dup_resp.data:
                bot.answer_callback_query(call.id, "ℹ️ Та аль хэдийн бүртгэгдсэн байна")
                bot.send_message(user_id, "✅ Баярлалаа! Та аль хэдийн бүртгэгдсэн байна.", reply_markup=main_menu())
                return
        except Exception as e:
            print(f"⚠️ Error checking duplicate: {e}")
        
        # Record the referral
        referral_data = {
            "referrer_id": referrer_id,
            "friend_user_id": user_id,
            "friend_username": friend_username,
            "status": "accepted",
            "verified_at": datetime.now(MOSCOW_TZ).isoformat(),
            "created_at": datetime.now(MOSCOW_TZ).isoformat(),
            "awarded": False,
        }
        
        try:
            supabase.table("referrals").insert(referral_data).execute()
            print(f"✅ Referral verified and recorded: {friend_username} (ID: {user_id}) referred by {referrer_id}")
            
            # Clear the pending referrer
            update_user_session(user_id, {"pending_referrer_id": None})
            
            # Award referrals to referrer
            auto_award_referrals(referrer_id)
            
            bot.answer_callback_query(call.id, "✅ Баталгаажлаа!")
            bot.send_message(
                user_id,
                "🎉 Баярлалаа! Та амжилттай сувагт нэгдэж баталгаажлаа.\n\n",
                reply_markup=main_menu()
            )
            
            # Notify referrer
            try:
                ref_status = get_user_referral_status(referrer_id)
                bot.send_message(
                    referrer_id,
                    f"🎉 Таны найз манай сувагт амжилттай нэгдлээ!\n\n"
                    f"Одоогийн статус: {ref_status['accepted']}/{REFERRAL_REQUIRED_COUNT}"
                )
            except Exception as e:
                print(f"⚠️ Failed to notify referrer: {e}")
                
        except Exception as e:
            print(f"❌ Failed to record referral: {e}")
            bot.answer_callback_query(call.id, "❌ Алдаа гарлаа")
    else:
        # User hasn't joined yet
        bot.answer_callback_query(call.id, "❌ Та сувагт нэгдээгүй байна", show_alert=True)
        
        # Get channel link
        channel_username = None
        for ch in REFERRAL_CHANNELS:
            if isinstance(ch, str) and ch.startswith('@'):
                channel_username = ch
                break
        channel_link = f"https://t.me/{channel_username.replace('@', '')}" if channel_username else "https://t.me/oyuns_alo"
        
        markup = InlineKeyboardMarkup()
        markup.add(InlineKeyboardButton("📢 OYUNS ALL-IN-ONE суваг", url=channel_link))
        markup.add(InlineKeyboardButton("✅ Би нэгдсэн", callback_data="verify_channel_join"))
        
        bot.send_message(
            user_id,
            "⚠️ Та сувагт нэгдээгүй байна.\n\n"
            "Эхлээд сувагт нэгдээд дахин баталгаажуулна уу.",
            reply_markup=markup
        )
        print(f"⚠️ User {user_id} tried to verify but hasn't joined channel")


@bot.callback_query_handler(func=lambda call: call.data == "submit_referral_usernames")
def submit_referral_usernames_handler(call):
    """Ask user to submit usernames of friends they invited"""
    user_id = call.message.chat.id
    
    bot.answer_callback_query(call.id)
    
    text = (
        f"👥 **Урьсан найзуудынхаа телеграм хаягийг илгээнэ үү**\n\n"
        f"Та урьсан найзуудынхаа телеграм хаягийг дараах форматаар илгээнэ үү:\n\n"
        f"📝 **Формат:**\n"
        f"`@username1 @username2 @username3 @username4 @username5`\n\n"
        f"⚠️ **Анхаар:**\n"
        f"• Телеграм хаягийг @ тэмдэгтээр эхэлж бичнэ\n"
        f"• Хооронд нь зай авна\n"
        f"• Нэг удаад {REFERRAL_REQUIRED_COUNT} найзын телеграм хаягийг илгээнэ\n"
        f"• Таны урьсан найзууд манай сувагт нэгдсэн байх ёстой\n\n"
        f"🔍 Админ таны урилгыг шалгаж баталгаажуулна."
    )
    
    markup = InlineKeyboardMarkup()
    markup.add(InlineKeyboardButton("🔙 Буцах", callback_data="back_main"))
    
    bot.send_message(user_id, text, parse_mode="Markdown", reply_markup=markup)
    
    # Set state to collect usernames
    update_user_session(user_id, {"state": "collecting_referral_usernames"})


@bot.message_handler(func=lambda m: get_state(m.chat.id) == "collecting_referral_usernames")
def collect_referral_usernames(message):
    """Collect usernames and send to moderator for approval"""
    user_id = message.chat.id
    text = message.text.strip()
    
    # Extract usernames (anything starting with @)
    import re
    usernames = re.findall(r'@\w+', text)
    
    if not usernames:
        bot.send_message(user_id, "❌ Телеграм хаяг олдсонгүй. Дахин оролдоно уу.\n\nЖишээ: @username1 @username2 @username3")
        return
    
    if len(usernames) != REFERRAL_REQUIRED_COUNT:
        bot.send_message(
            user_id,
            f"⚠️ Та {REFERRAL_REQUIRED_COUNT} найзын телеграм хаягийг илгээх ёстой.\n"
            f"Одоогоор та {len(usernames)} телеграм хаяг илгээсэн байна.\n\n"
            f"Дахин оролдоно уу."
        )
        return
    
    # Store referrals as pending
    referral_ids = []
    for username in usernames:
        referral_data = {
            "referrer_id": user_id,
            "friend_username": username,
            "status": "pending",
            "created_at": datetime.now(MOSCOW_TZ).isoformat(),
            "awarded": False
        }
        try:
            result = supabase.table("referrals").insert(referral_data).execute()
            if result.data:
                referral_ids.append(result.data[0]["id"])
            print(f"📝 Pending referral: {username} by user {user_id}")
        except Exception as e:
            print(f"❌ Failed to store referral {username}: {e}")
    
    if not referral_ids:
        bot.send_message(user_id, "❌ Алдаа гарлаа. Дахин оролдоно уу.")
        clear_state(user_id)
        return
    
    # Send to moderator for approval
    try:
        # Get user info
        user_info = supabase.table("users").select("first_name, last_name, phone").eq("id", user_id).execute()
        user_data = user_info.data[0] if user_info.data else {}
        user_name = user_data.get("first_name") or user_data.get("last_name") or str(user_id)
        
        moderator_text = (
            f"🔔 **REFERRAL**\n\n"
            f"👤 Хэрэглэгч: [{user_name}](tg://user?id={user_id})\n"
            f"🆔 User ID: `{user_id}`\n"
            f"📞 Утас: {user_data.get('phone', 'N/A')}\n\n"
            f"👥 **Урьсан найзуудын телеграм хаягууд:**\n"
        )
        
        for i, username in enumerate(usernames, 1):
            moderator_text += f"{i}. {username}\n"
        
        moderator_text += f"\n🔍 Эдгээр хэрэглэгчид сувагт нэгдсэн эсэхийг шалгаад баталгаажуулна уу."
        
        markup = InlineKeyboardMarkup()
        markup.add(
            InlineKeyboardButton("✅ Батлах", callback_data=f"approve_referral_{user_id}_{','.join(map(str, referral_ids))}"),
            InlineKeyboardButton("❌ Татгалзах", callback_data=f"reject_referral_{user_id}_{','.join(map(str, referral_ids))}")
        )
        
        bot.send_message(MODERATOR_ID, moderator_text, parse_mode="Markdown", reply_markup=markup)
        
        # Notify user
        bot.send_message(
            user_id,
            "✅ Таны хүсэлт илгээгдлээ!\n\n"
            "⏳ Админ таны урилгыг шалгаж байна. Хэрэв таны урьсан найзууд манай телеграм сувагт нэгдсэн бол админ баталгаажуулж танд промокод олгох болно.\n\n",
            reply_markup=main_menu()
        )
        
        print(f"✅ Referral request sent to moderator for user {user_id}")
        
    except Exception as e:
        bot.send_message(user_id, f"❌ Алдаа гарлаа: {e}")
        print(f"❌ Failed to send to moderator: {e}")
    
    clear_state(user_id)


@bot.callback_query_handler(func=lambda call: call.data.startswith("approve_referral_"))
def approve_referral_handler(call):
    """Moderator approves referrals"""
    if call.from_user.id != MODERATOR_ID:
        bot.answer_callback_query(call.id, "❌ Зөвхөн модератор энэ үйлдлийг хийх боломжтой")
        return
    
    try:
        # Parse callback data: approve_referral_USER_ID_REF_ID1,REF_ID2,...
        parts = call.data.split("_")
        user_id = int(parts[2])
        referral_ids_str = "_".join(parts[3:])  # In case there are underscores in the IDs
        referral_ids = [int(rid) for rid in referral_ids_str.split(",")]
        
        # Update referrals to accepted
        for ref_id in referral_ids:
            supabase.table("referrals").update({
                "status": "accepted",
                "verified_at": datetime.now(MOSCOW_TZ).isoformat()
            }).eq("id", ref_id).execute()
        
        print(f"✅ Moderator approved {len(referral_ids)} referrals for user {user_id}")
        
        # Check if user should get promo code
        auto_award_referrals(user_id)
        
        # Notify moderator
        bot.answer_callback_query(call.id, "✅ Баталгаажлаа!")
        bot.edit_message_text(
            f"{call.message.text}\n\n✅ **Баталгаажсан** ({datetime.now(MOSCOW_TZ).strftime('%Y-%m-%d %H:%M')})",
            call.message.chat.id,
            call.message.message_id,
            parse_mode="Markdown"
        )
        
        # Notify user
        bot.send_message(
            user_id,
            "🎉 Таны урьсан найзууд бүгд манай телеграм сувагт нэгдсэн байна!\n\n📌 Та промокодоо гүйлгээ хийх үедээ ашиглаарай!"
        )
        
    except Exception as e:
        bot.answer_callback_query(call.id, "❌ Алдаа гарлаа")
        print(f"❌ Error approving referral: {e}")


@bot.callback_query_handler(func=lambda call: call.data.startswith("reject_referral_"))
def reject_referral_handler(call):
    """Moderator rejects referrals and provides feedback"""
    if call.from_user.id != MODERATOR_ID:
        bot.answer_callback_query(call.id, "❌ Зөвхөн модератор энэ үйлдлийг хийх боломжтой")
        return
    
    try:
        # Parse callback data
        parts = call.data.split("_")
        user_id = int(parts[2])
        referral_ids_str = "_".join(parts[3:])
        referral_ids = [int(rid) for rid in referral_ids_str.split(",")]
        
        # Store info for feedback
        update_user_session(MODERATOR_ID, {
            "pending_rejection_user_id": user_id,
            "pending_rejection_ref_ids": referral_ids_str,
            "state": "awaiting_rejection_reason"
        })
        
        bot.answer_callback_query(call.id)
        bot.send_message(
            MODERATOR_ID,
            "📝 Татгалзах шалтгаанаа бичнэ үү:\n\n"
            "(Энэ мессеж хэрэглэгчид очих болно)"
        )
        
    except Exception as e:
        bot.answer_callback_query(call.id, "❌ Алдаа гарлаа")
        print(f"❌ Error initiating rejection: {e}")


@bot.message_handler(func=lambda m: m.from_user.id == MODERATOR_ID and get_state(MODERATOR_ID) == "awaiting_rejection_reason")
def collect_rejection_reason(message):
    """Collect rejection reason from moderator"""
    reason = message.text.strip()
    
    session = get_user_session(MODERATOR_ID)
    user_id = session.get("pending_rejection_user_id")
    referral_ids_str = session.get("pending_rejection_ref_ids")
    
    if not user_id or not referral_ids_str:
        bot.send_message(MODERATOR_ID, "❌ Алдаа: Мэдээлэл олдсонгүй")
        clear_state(MODERATOR_ID)
        return
    
    try:
        referral_ids = [int(rid) for rid in referral_ids_str.split(",")]
        
        # Update referrals to rejected
        for ref_id in referral_ids:
            supabase.table("referrals").update({
                "status": "rejected"
            }).eq("id", ref_id).execute()
        
        print(f"❌ Moderator rejected {len(referral_ids)} referrals for user {user_id}")
        
        # Notify user
        bot.send_message(
            user_id,
            f"❌ Таны найзууд хараахан манай телеграм сувагт нэгдээгүй байна.\n\n"
            f"📝 **Шалтгаан:**\n{reason}\n\n"
            f"Таны найзууд сувагт нэгдсэний дараа дахин оролдоорой."
        )
        
        # Notify moderator
        bot.send_message(MODERATOR_ID, f"✅ Татгалзсан. Хэрэглэгчид мэдэгдэл илгээгдлээ.")
        
    except Exception as e:
        bot.send_message(MODERATOR_ID, f"❌ Алдаа: {e}")
        print(f"❌ Error rejecting referral: {e}")
    
    clear_state(MODERATOR_ID)
    

@bot.message_handler(func=lambda m: m.text and m.text.startswith('/promocode'))
def admin_award_referral_command(message):
    """Admin-only command: /promocode <user_id>
    Manually trigger awarding referral promo codes for a user.
    """
    admin_id = message.from_user.id
    lang_a = get_user_lang(admin_id)
    if admin_id not in ALLOWED_ADMINS:
        bot.send_message(message.chat.id, t(lang_a, "admin_promo_unauthorized"))
        return

    parts = message.text.strip().split()
    if len(parts) < 2:
        bot.send_message(message.chat.id, t(lang_a, "admin_promo_format"))
        return

    try:
        user_id = int(parts[1])
    except ValueError:
        bot.send_message(message.chat.id, t(lang_a, "admin_promo_bad_id"))
        return

    # Optional discount argument
    discount = 0.2
    if len(parts) >= 3:
        try:
            discount = float(parts[2])
        except ValueError:
            bot.send_message(message.chat.id, t(lang_a, "admin_promo_bad_discount"))
            return

    # Generate a 10-digit numeric promo code
    try:
        promo_code = generate_promo_code()
        success = create_promo_code_in_db(promo_code, user_id=user_id, discount=discount, source="admin")
        if success:
            # Notify the target user
            try:
                bot.send_message(user_id, f"🎉 Танд промокод олгогдлоо: `{sanitize_markdown(promo_code)}`\n💰 Хөнгөлөлт: {discount}", parse_mode="Markdown")
            except Exception:
                pass
            bot.send_message(message.chat.id, t(lang_a, "admin_promo_success", code=promo_code, discount=discount, user_id=user_id))
        else:
            bot.send_message(message.chat.id, t(lang_a, "admin_promo_error"))
    except Exception as e:
        bot.send_message(message.chat.id, t(lang_a, "admin_promo_error_detail", error=str(e)))





def payment_receipt(message):
    user_id = message.chat.id
    lang = get_user_lang(user_id)
    receipt_id = message.photo[-1].file_id
    session = get_user_session(user_id)
    invoice = session.get("invoice")
    pending_transactions[user_id] = {
        "invoice": invoice,
        "receipt_id": receipt_id,
        "receipt_submitted_at": datetime.now(MOSCOW_TZ).isoformat(),
        "bank_details": None,
        "admin_bill_id": None
    }

    invoice = session.get("invoice")
    update_user_session(user_id, {"state": "waiting_for_bank"})
    # 🧠 Detect the target currency
    session = get_user_session(user_id)
    if not session:
        bot.send_message(user_id, t(lang, "error_session_not_found"))
        return
    currency_to = session.get("currency_to") if session else "mnt"

    # 📌 Instructions based on destination currency
    receipt_key = "receipt_accepted_mnt" if currency_to == "mnt" else "receipt_accepted_rub"

    markup = InlineKeyboardMarkup()
    markup.add(
        InlineKeyboardButton(t(lang, "btn_use_saved_bank"), callback_data="use_saved_bank")
    )

    bot.send_message(
        user_id,
        t(lang, receipt_key, invoice=invoice),
        reply_markup=markup,
        parse_mode="Markdown"
    )
@bot.message_handler(content_types=['document'])
def reject_file_receipts(message):
    user_id = message.chat.id
    session = get_user_session(user_id)
    state = session["state"] if session else None

    if state == "waiting_for_receipt":
        bot.send_message(
            user_id,
            "❌ *Та PDF болон өөр төрлийн файл илгээх боломжгүй!*\n\n"
            "📸 Та гүйлгээний баримтаа зөвхөн *зураг хэлбэрээр* оруулна уу.\n",
            parse_mode="Markdown"
        )
    else:
        # Optional: Handle other states if needed
        bot.send_message(user_id, "📁 Энэ файлыг одоогоор хүлээн авах боломжгүй байна.")


@bot.message_handler(commands=['batalgaajuulah'])
def cmd_reconfirm(message):
    admin_id = message.chat.id
    if admin_id not in ALLOWED_ADMINS:
        return bot.reply_to(message, t(get_user_lang(admin_id), "admin_cmd_unauthorized_2"))

    lang_admin = get_user_lang(admin_id)
    parts = message.text.split(maxsplit=1)
    if len(parts) != 2 or not is_valid_invoice_format(parts[1]):
        return bot.reply_to(message, t(lang_admin, "admin_reconfirm_format"))
    invoice = parts[1]

    # Fetch txn
    resp = supabase.table("transactions") \
        .select("status,amount,currency_from,currency_to,rate,bank_details,bill_url") \
        .eq("invoice", invoice) \
        .single() \
        .execute()
    if not resp.data:
        return bot.reply_to(message, t(lang_admin, "admin_txn_not_found_inv", invoice=invoice), parse_mode="Markdown")
    txn = resp.data

    if txn["status"] != "rejected":
        return bot.reply_to(
            message,
            t(lang_admin, "admin_reconfirm_status_err", invoice=invoice, status=txn['status']),
            parse_mode="Markdown"
        )

    # Re‑open
    supabase.table("transactions").update({"status": "pending"}).eq("invoice", invoice).execute()

    # Compute converted amount
    amt   = float(txn["amount"])
    rate  = float(txn["rate"])
    tocur = txn["currency_to"].upper()
    conv  = round(amt * rate if txn["currency_from"].upper()=="RUB" else amt / rate, 2)
    bd    = txn.get("bank_details", "")
    url   = txn.get("bill_url", "")

    # Build caption
    if tocur == "MNT":
        bank, iban, name = [x.strip() for x in bd.split(",")]
        caption = t(lang_admin, "admin_payout_mnt_reopen", invoice=invoice, converted=conv, bank=bank, iban=iban, name=name, rate=rate)
    else:
        bank, phone, card, name = [x.strip() for x in bd.split(",")]
        caption = t(lang_admin, "admin_payout_rub_reopen", invoice=invoice, converted=conv, bank=bank, phone=phone, card=card, name=name, rate=rate)

    # Attach public link
    if url:
        caption += f"\n\n[{t(lang_admin, 'admin_receipt_view')}]({url})"

    bot.send_message(admin_id, caption, parse_mode="Markdown")

# ✅ Admin command to show transaction status and manage it
@bot.message_handler(commands=['status'])
def cmd_status(message):
    admin_id = message.chat.id
    if admin_id not in ALLOWED_ADMINS:
        return bot.reply_to(message, t(get_user_lang(admin_id), "admin_cmd_unauthorized_2"))

    parts = message.text.split(maxsplit=1)
    if len(parts) != 2 or not is_valid_invoice_format(parts[1]):
        return bot.reply_to(message, t(get_user_lang(admin_id), "admin_status_format"))
    invoice = parts[1]

    # Fetch txn
    resp = supabase.table("transactions") \
        .select("*") \
        .eq("invoice", invoice) \
        .single() \
        .execute()
    if not resp.data:
        return bot.reply_to(message, t(get_user_lang(admin_id), "admin_txn_not_found_inv", invoice=invoice), parse_mode="Markdown")
    txn = resp.data

    # Build status message
    status_emoji = {
        "pending": "⏳",
        "successful": "✅", 
        "rejected": "❌"
    }
    
    lang_admin = get_user_lang(message.from_user.id)
    status_text = {
        "pending": t(lang_admin, "admin_status_pending"),
        "successful": t(lang_admin, "admin_status_successful"),
        "rejected": t(lang_admin, "admin_status_rejected"),
    }

    status = txn["status"]
    emoji = status_emoji.get(status, "❓")
    status_name = status_text.get(status, status)
    
    # Calculate converted amount
    amt = float(txn["amount"])
    rate = float(txn["rate"])
    currency_from = txn["currency_from"].upper()
    currency_to = txn["currency_to"].upper()
    converted = round(amt * rate if currency_from == "RUB" else amt / rate, 2)

    created = txn.get('timestamp', 'N/A')[:19] if txn.get('timestamp') else 'N/A'
    message_text = t(lang_admin, "admin_status_info", emoji=emoji, invoice=invoice, status_name=status_name, amt=amt, currency_from=currency_from, converted=converted, currency_to=currency_to, rate=rate, user_id=txn['user_id'], created=created)

    if txn.get("completed_at"):
        message_text += t(lang_admin, "admin_status_completed_at", date=txn['completed_at'][:19])
    if txn.get("completed_by_admin"):
        message_text += t(lang_admin, "admin_status_confirmed_by", admin=txn['completed_by_admin'])
    if txn.get("admin_comment"):
        message_text += t(lang_admin, "admin_status_comment", comment=txn['admin_comment'])

    # Add action buttons based on current status
    markup = InlineKeyboardMarkup()
    if status == "pending":
        markup.add(
            InlineKeyboardButton(t(lang_admin, "admin_btn_confirm"), callback_data=f"confirm_{txn['user_id']}"),
            InlineKeyboardButton(t(lang_admin, "admin_btn_reject"), callback_data=f"reject_{txn['user_id']}")
        )
    elif status == "successful":
        markup.add(
            InlineKeyboardButton(t(lang_admin, "admin_btn_return_pending"), callback_data=f"pending_{txn['user_id']}")
        )
    elif status == "rejected":
        markup.add(
            InlineKeyboardButton(t(lang_admin, "admin_btn_return_pending"), callback_data=f"pending_{txn['user_id']}")
        )

    bot.reply_to(message, message_text, parse_mode="Markdown", reply_markup=markup)

def _send_rating_prompt(user_id: int):
    kb = InlineKeyboardMarkup()
    for i in range(1, 6):
        kb.add(InlineKeyboardButton("⭐" * i, callback_data=f"rate_{i}"))
    lang = get_user_lang(user_id)
    kb.add(InlineKeyboardButton(t(lang, "admin_feedback_btn"), callback_data="write_feedback"))
    bot.send_message(user_id, t(lang, "admin_rating_prompt"), reply_markup=kb)

def _flush_admin_media_group(mgid: str, target_user: int, caption: str, admin_id: int):
    # pop buffer and clear scheduled flag
    photos = _admin_media_buffers.pop(mgid, [])
    _admin_media_flush_scheduled.discard(mgid)
    if not photos:
        return

    media = []
    # first photo with caption
    media.append(InputMediaPhoto(media=photos[0], caption=caption, parse_mode="Markdown"))
    # rest without captions
    for fid in photos[1:]:
        media.append(InputMediaPhoto(media=fid))
    bot.send_media_group(target_user, media)

    # now prompt for rating
    _send_rating_prompt(target_user)

    # Extract invoice from caption for admin notification
    invoice_match = re.search(r'`([^`]+)`', caption)
    invoice = invoice_match.group(1) if invoice_match else "unknown"
    
    # acknowledge to admin
    bot.send_message(
        admin_id,
        t(get_user_lang(admin_id), "admin_receipt_sent", invoice=invoice),
        parse_mode="Markdown"
    )
@bot.message_handler(content_types=['photo'])
def handle_passport_or_receipt(message):
    user_id = message.chat.id
    photo_id = message.photo[-1].file_id
    state = get_state(user_id)
    admin_id = user_id  # for clarity

    # --- 1) PASSPORT UPLOAD FLOW (for new-user registration) ---
    if state == "waiting_for_passport":
        try:
            file_info = bot.get_file(photo_id)
            file_url  = f"https://api.telegram.org/file/bot{BOT_TOKEN}/{file_info.file_path}"
            resp      = requests.get(file_url)
            resp.raise_for_status()

            file_name = f"{user_id}_{datetime.now().strftime('%Y%m%d%H%M%S')}.jpg"
            with tempfile.NamedTemporaryFile(delete=False, suffix=".jpg") as tmp:
                tmp.write(resp.content)
                temp_path = tmp.name

            public_url = supabase.storage.from_("passports").get_public_url(file_name)
            supabase.storage.from_("passports").upload(
                file_name,
                temp_path,
                {"content-type": "image/jpeg", "x-upsert": "true"}
            )

            supabase.table("users").update({
                "passport_file_id": photo_id,
                "passport_storage_url": public_url
            }).eq("id", user_id).execute()

            bot.send_message(user_id, "🪪 Паспортын зураг амжилттай хадгалагдлаа!")
        except Exception as e:
            print(f"❌ Passport upload error: {e}")
            bot.send_message(user_id, f"❌ Алдаа гарлаа: {e}")
        finally:
            clear_state(user_id)
            if 'temp_path' in locals() and os.path.exists(temp_path):
                os.remove(temp_path)
        return

    # --- 2) USER RECEIPT UPLOAD FLOW (client uploads payment proof) ---
    if state == "waiting_for_receipt":
        session = get_user_session(user_id)
        invoice = session.get("invoice")
        if not invoice:
            return bot.send_message(user_id, "❗ Хүсэлтийн дугаар алга байна. Шинээр эхлэнэ үү.")

        try:
            file_info = bot.get_file(photo_id)
            file_url  = f"https://api.telegram.org/file/bot{BOT_TOKEN}/{file_info.file_path}"
            resp      = requests.get(file_url); resp.raise_for_status()

            file_name = f"{invoice}_{user_id}.jpg"
            with tempfile.NamedTemporaryFile(delete=False, suffix=".jpg") as tmp:
                tmp.write(resp.content)
                temp_path = tmp.name

            bill_url = storage_upload_file(supabase, "bills", file_name, temp_path, "image/jpeg")

            # Log transaction start time when user sends bill screenshot
            receipt_submitted_at = datetime.now(MOSCOW_TZ).isoformat()
            try:
                resp = supabase.table("transactions").update({
                    "bill_id":     photo_id,
                    "receipt_id":  photo_id,
                    "bill_url":    bill_url,
                    "receipt_submitted_at": receipt_submitted_at
                }).eq("invoice", (invoice or "").strip()).execute()
                print(f"📥 Receipt update result for invoice={invoice}:", resp)
                # If update didn't affect any rows, try normalized invoice fallback
                if not getattr(resp, "data", None):
                    norm = normalize_invoice_format(invoice)
                    if norm and norm != invoice:
                        try:
                            resp2 = supabase.table("transactions").update({
                                "bill_id":     photo_id,
                                "receipt_id":  photo_id,
                                "bill_url":    bill_url,
                                "receipt_submitted_at": receipt_submitted_at
                            }).eq("invoice", norm).execute()
                            print(f"📥 Receipt update fallback for normalized invoice={norm}:", resp2)
                        except Exception as e:
                            print(f"❌ Receipt update fallback error for {norm}: {e}")
            except Exception as e:
                print(f"❌ Receipt upload DB update error: {e}")

            bot.send_message(user_id, t(get_user_lang(user_id), "user_topup_receipt_saved"))
        except Exception as e:
            print(f"❌ Receipt upload error: {e}")
            bot.send_message(user_id, t(get_user_lang(user_id), "user_topup_receipt_error", error=str(e)))
        finally:
            update_user_session(user_id, {"state": "waiting_for_bank"})
            if 'temp_path' in locals() and os.path.exists(temp_path):
                os.remove(temp_path)

        # Now prompt for bank details
        return payment_receipt(message)

    # --- 2.5) PHONE TOP-UP RECEIPT UPLOAD FLOW ---
    if state == "phone_topup_waiting_receipt":
        session = get_user_session(user_id)
        invoice = session.get("invoice")
        if not invoice:
            return bot.send_message(user_id, "❗ Хүсэлтийн дугаар алга байна. Шинээр эхлэнэ үү.")
        
        try:
            file_info = bot.get_file(photo_id)
            file_url = f"https://api.telegram.org/file/bot{BOT_TOKEN}/{file_info.file_path}"
            resp = requests.get(file_url)
            resp.raise_for_status()
            
            file_name = f"{invoice}_{user_id}.jpg"
            with tempfile.NamedTemporaryFile(delete=False, suffix=".jpg") as tmp:
                tmp.write(resp.content)
                temp_path = tmp.name
            
            bill_url = storage_upload_file(supabase, "bills", file_name, temp_path, "image/jpeg")
            
            # Record transaction
            receipt_submitted_at = datetime.now(MOSCOW_TZ).isoformat()
            
            amount_rub = session.get("amount")  # RUB amount
            rate = session.get("rate", 1)
            amount_mnt = amount_rub * rate  # Calculate MNT
            phone_number = session.get("selected_rub_bank", "")  # Phone number
            telecom = session.get("direction", "")  # Telecom company
            
            # Combine for bank_details field in transactions table
            topup_details = f"{phone_number}, {telecom}"
            
            record_transaction(
                user_id,
                invoice,
                float(amount_mnt),  # MNT the user pays
                "mnt",
                "rub",  # Treat top-up as MNT → RUB for DB consistency
                float(rate),  # Use current SELL rate
                topup_details,
                "pending",
                None
            )
            
            # Update with receipt info
            supabase.table("transactions").update({
                "bill_id": photo_id,
                "receipt_id": photo_id,
                "bill_url": bill_url,
                "receipt_submitted_at": receipt_submitted_at
            }).eq("invoice", invoice).execute()
            
            bot.send_message(user_id, t(get_user_lang(user_id), "user_topup_receipt_saved"))
            
            # Notify operator
            notify_phone_topup_operator(
                user_id,
                invoice,
                photo_id,
                amount_rub,
                amount_mnt,
                phone_number,
                telecom
            )
            
            bot.send_message(user_id, t(get_user_lang(user_id), "user_topup_sent_to_admin"))
            
            clear_state(user_id)
            
        except Exception as e:
            print(f"❌ Phone topup receipt upload error: {e}")
            bot.send_message(user_id, t(get_user_lang(user_id), "user_topup_receipt_error", error=str(e)))
        finally:
            if 'temp_path' in locals() and os.path.exists(temp_path):
                os.remove(temp_path)
        
        return

    # --- 3) ADMIN CONFIRMATION FLOW (only if NOT in one of the above states) ---
    if message.from_user.id in ALLOWED_ADMINS:
            # Check if this is part of a media group that's already being processed
            mgid = message.media_group_id
            if mgid and mgid in _admin_media_flush_scheduled:
                # This is a subsequent photo in an already scheduled media group
                # Just add it to the buffer and return
                buf = _admin_media_buffers.setdefault(mgid, [])
                buf.append(photo_id)
                return

            # 1) Build a single text blob to search for invoice + comment
            source = ""
            if message.reply_to_message:
                source += (message.reply_to_message.caption or "") + "\n"
                source += (message.reply_to_message.text or "") + "\n"
            source += (message.caption or "")

            # 2) Extract the invoice (поддерживаем оба формата)
            # Сначала ищем новый формат: YYYYMMDD-HHMMSS-XX
            m = re.search(r'(\d{8}-\d{6}-\d{2})', source)
            if m:
                invoice = m.group(1)
            else:
                # Если не найден новый формат, ищем старый: YYYYMMDD_HHMMSS
                m = re.search(r'(\d{8}_\d{6})', source)
                if m:
                    invoice = m.group(1)
                else:
                    return bot.send_message(
                        user_id,
                        "⛔ Гүйлгээний дугаар тодорхойгүй байна.\n"
                        "Зурган дээр reply хийх эсвэл зургийн caption хэсэгт `YYYYMMDD_HHMMSS` эсвэл `YYYYMMDD-HHMMSS-XX` хэлбэрийн invoice id-г бичнэ үү.",
                        parse_mode="Markdown"
                    )

            # 3) Anything after the invoice in the admin's caption → comment
            #    We look only in this message's caption, not the replied-to one
            raw = message.caption or ""
            comment = raw.replace(invoice, "").strip()

            # 3) Lookup transaction data including user_id, amount, currency, and receipt_submitted_at
            resp = supabase.table("transactions") \
                          .select("user_id, amount, currency_from, currency_to, rate, receipt_submitted_at") \
                          .eq("invoice", invoice) \
                          .limit(1) \
                          .execute()
            if not resp.data:
                bot.send_message(message.chat.id, f"❌ `{invoice}` гүйлгээ олдсонгүй. Invoice ID-г шалгана уу.", parse_mode="Markdown")
                return
            txn_data = resp.data[0]
            target_user = txn_data["user_id"]
            amount = float(txn_data["amount"])
            currency_from = txn_data["currency_from"]
            currency_to = txn_data["currency_to"]
            rate = float(txn_data.get("rate", 1))
            receipt_submitted_at = txn_data.get("receipt_submitted_at")

            # 4) Update DB
            # Timestamp when admin uploads their confirmation bill (used to compute admin handling duration)
            admin_bill_submitted_at = datetime.now(MOSCOW_TZ).isoformat()
            # completed_at remains the time we mark the transaction finished
            completed_at = datetime.now(MOSCOW_TZ).isoformat()
            updates = {
                "status": "successful",
                "admin_bill_id": message.photo[-1].file_id,
                "completed_by_admin": message.from_user.id,
                "completed_at": completed_at,
                # store admin timestamp separately so we can compute handling duration
                "admin_bill_submitted_at": admin_bill_submitted_at
            }
            if comment:
                updates["admin_comment"] = comment
            supabase.table("transactions").update(updates).eq("invoice", invoice).execute()

            # 5) Calculate transaction completion duration and generate promo code if needed
            promo_code_generated = None
            duration_minutes = None
            if receipt_submitted_at:
                try:
                    # Parse start time (receipt_submitted_at) - handle various ISO formats
                    start_time_str = receipt_submitted_at
                    if start_time_str.endswith('Z'):
                        start_time = datetime.fromisoformat(start_time_str.replace('Z', '+00:00'))
                    elif '+' in start_time_str or (start_time_str.count('-') >= 3 and 'T' in start_time_str):
                        start_time = datetime.fromisoformat(start_time_str)
                    else:
                        # No timezone info, assume it's already in Moscow timezone format
                        start_time = datetime.fromisoformat(start_time_str)
                    
                    # Ensure start_time is in Moscow timezone
                    if start_time.tzinfo is None:
                        start_time = start_time.replace(tzinfo=MOSCOW_TZ)
                    else:
                        start_time = start_time.astimezone(MOSCOW_TZ)
                    
                    # Parse end time (admin uploaded the confirmation bill)
                    # Use admin_bill_submitted_at when available (represents when admin handled the request)
                    end_time_str = admin_bill_submitted_at if 'admin_bill_submitted_at' in locals() else completed_at
                    if end_time_str.endswith('Z'):
                        end_time = datetime.fromisoformat(end_time_str.replace('Z', '+00:00'))
                    elif '+' in end_time_str or (end_time_str.count('-') >= 3 and 'T' in end_time_str):
                        end_time = datetime.fromisoformat(end_time_str)
                    else:
                        end_time = datetime.fromisoformat(end_time_str)
                    
                    # Ensure end_time is in Moscow timezone
                    if end_time.tzinfo is None:
                        end_time = end_time.replace(tzinfo=MOSCOW_TZ)
                    else:
                        end_time = end_time.astimezone(MOSCOW_TZ)
                    
                    duration_minutes = (end_time - start_time).total_seconds() / 60.0
                    
                    # Store duration in transactions table
                    try:
                        resp = supabase.table("transactions").update({
                            "completion_duration_minutes": duration_minutes
                        }).eq("invoice", (invoice or "").strip()).execute()
                        print(f"⏱️ Completion duration update result for invoice={invoice}:", resp)
                        if not getattr(resp, "data", None):
                            # Try normalized invoice fallback
                            norm = normalize_invoice_format(invoice)
                            if norm and norm != invoice:
                                try:
                                    resp2 = supabase.table("transactions").update({
                                        "completion_duration_minutes": duration_minutes
                                    }).eq("invoice", norm).execute()
                                    print(f"⏱️ Completion duration update fallback for normalized invoice={norm}:", resp2)
                                except Exception as e:
                                    print(f"❌ Duration update fallback error for {norm}: {e}")
                    except Exception as e:
                        print(f"❌ Failed to store duration: {e}")
                    
                    # Check if amount is less than 20000 rubles (in either direction)
                    amount_rub = amount
                    if currency_from.lower() == "mnt":
                        # Convert MNT to RUB using the rate
                        amount_rub = amount / rate if rate > 0 else amount
                    # If currency_from is "rub", amount_rub is already in rubles
                    
                    # Promo qualification check: automatically award promo for slow transactions
                    if amount_rub < 20000 and duration_minutes > 10:
                        try:
                            promo_code = generate_promo_code()
                            if create_promo_code_in_db(promo_code, user_id=target_user, discount=0.2, source="system"):
                                promo_code_generated = promo_code
                                bot.send_message(
                                    target_user,
                                    f"😓 Уучлаарай, таны гүйлгээний хүсэлтийг гүйцэтгэхэд {duration_minutes:.1f} минут зарцуулагдлаа.\n\n"
                                    f"🎟️ Танд промокод бэлэглэж байна: `{sanitize_markdown(promo_code)}`\n\n"
                                    f"Энэхүү промокодыг дараагийн нэг удаагийн гүйлгээндээ ашиглаарай. Бид үйлчилгээний хурд, чанартаа цаашид илүү анхаарах болно. 🙌",
                                    parse_mode="Markdown"
                                )
                        except Exception as e:
                            print(f"❌ Failed to auto-create promo for user {target_user}: {e}")
                except Exception as e:
                    print(f"❌ Error calculating duration or generating promo code: {e}")
                    import traceback
                    traceback.print_exc()

            # 6) Build forward caption
            caption = f"✅ `{invoice}` дугаартай *гүйлгээ амжилттай хийгдлээ!* \n\nТа шилжүүлсэн баримтыг хүлээн авна уу."
            if comment:
                caption += f"\n\n💬 *Админы тайлбар:* {comment}"
            caption += "\n\nМанайхыг сонгон үйлчлүүлсэнд баярлалаа! 🤗"

            # 7) Send photo(s) as media_group if needed
            if mgid:
                # buffer
                buf = _admin_media_buffers.setdefault(mgid, [])
                buf.append(photo_id)
                # only schedule one flush per mgid
                if mgid not in _admin_media_flush_scheduled:
                    _admin_media_flush_scheduled.add(mgid)
                    # after 1 second, flush the entire group
                    threading.Timer(
                        1.0,
                        _flush_admin_media_group,
                        args=(mgid, target_user, caption, admin_id)
                    ).start()
            else:
                # single
                bot.send_photo(target_user, photo_id, caption=caption, parse_mode="Markdown")
                _send_rating_prompt(target_user)
                bot.send_message(
                    admin_id,
                    f"📨 `{invoice}` дугаартай гүйлгээний баримт хэрэглэгч рүү амжилттай илгээгдлээ.",
                    parse_mode="Markdown"
                )
            return

    # --- 4) FALLBACK: nobody matched ---
    bot.send_message(
        message.chat.id,
        "❓ Энэ зураг юунд зориулагдсан болохыг тодорхойлж чадсангүй.\n"
        "🕹️ Та хэрэв валют солиулахыг хүсч байвал эхлээд */start* команд ашиглан цэснээс валют солих үйлчилгээг сонгоод гүйлгээний хүсэлт үүсгэсний дараа гүйлгээний баримтын зургаа явуулна уу, эсвэл OYUNS SUPPORT чатруу хандаарай:\n"
        f"{CONTACT_SUPPORT}",
        parse_mode="Markdown"
    )


@bot.callback_query_handler(func=lambda call: call.data.startswith("rate_"))
def handle_rating(call):
    user_id = call.message.chat.id
    rating = int(call.data.split("_")[1])
    session = get_user_session(user_id)
    # Optionally store invoice info
    invoice = session.get("invoice")
    # Save rating temporarily
    user_feedback_state[user_id] = {
        "rating": rating,
        "invoice": invoice
    }

    # Show feedback button
    markup = InlineKeyboardMarkup()
    markup.add(InlineKeyboardButton("✍️ Санал хүсэлт бичих", callback_data="write_feedback"))

    bot.send_message(
        user_id,
        f"🎉 Баярлалаа! Та бидний үйлчилгээнд {rating} ⭐ үнэлгээ өглөө.\n✉️ Хэрэв санал хүсэлт байвал дараах товчийг дарна уу.",
        reply_markup=markup
    )

@bot.callback_query_handler(func=lambda call: call.data == "write_feedback")
def ask_for_text_feedback(call):
    update_user_session(call.message.chat.id, {"state": "awaiting_feedback"})
    bot.send_message(call.message.chat.id, "📝 Та санал хүсэлтээ бичнэ үү:")
@bot.message_handler(func=lambda m: get_state(m.chat.id) == "awaiting_feedback")
def save_text_feedback(message):
    user_id = message.chat.id
    comment = message.text.strip()

    feedback_info = user_feedback_state.pop(user_id, {})
    rating = feedback_info.get("rating")
    invoice = feedback_info.get("invoice")

    if not rating:
        bot.send_message(user_id, "⚠️ Үнэлгээ бүртгэгдээгүй байна. Та дахин оролдоно уу.")
        return

    try:
        supabase.table("feedback").insert({
            "user_id": user_id,
            "rating": rating,
            "invoice": invoice,
            "comment": comment,
            "created_at": datetime.utcnow().isoformat()
        }).execute()

        markup = InlineKeyboardMarkup()
        markup.add(InlineKeyboardButton("🏠 Үндсэн цэс рүү очих", callback_data="back_main"))

        bot.send_message(
            user_id,
            "✅ Баярлалаа! Таны сэтгэгдлийг амжилттай хүлээн авлаа.\n🤗 Бид таны саналыг үйлчилгээг сайжруулахад ашиглах болно.",
            reply_markup=markup
        )
    except Exception as e:
        print(f"❌ Feedback insert error: {e}")
        bot.send_message(user_id, "❌ Уучлаарай, алдаа гарлаа. Та дахин оролдоно уу.")
    finally:
        clear_state(user_id)

#REGISTRATION FORM

@bot.message_handler(commands=['register'])
def register(message):
    user_id = message.chat.id
    if not has_agreed_terms(user_id):
        ask_terms_agreement(message.chat.id)
        return
    lang = get_user_lang(user_id)
    clear_state(user_id)
    markup = InlineKeyboardMarkup()
    markup.add(InlineKeyboardButton(t(lang, "btn_open_app"), web_app=WebAppInfo(url=WEBAPP_URL)))
    bot.send_message(
        user_id,
        t(lang, "register_open_app_prompt"),
        parse_mode="Markdown",
        reply_markup=markup
    )



@bot.message_handler(commands=['hereglegch'])
def show_pending_users(message):
    try:
        user_id = message.from_user.id
        print("🆔 Admin requesting:", user_id)

        if user_id not in ALLOWED_ADMINS:
            bot.send_message(message.chat.id, t(get_user_lang(user_id), "admin_cmd_unauthorized"))
            return

        response = supabase.table("users").select("*").eq("verified", False).eq("ready_for_verification", True).execute()
        users = response.data

        print("🗂 Pending user data:", users)

        if not users:
            bot.send_message(message.chat.id, t(get_user_lang(message.from_user.id), "admin_no_pending"))
            return

        lang_admin = get_user_lang(message.from_user.id)
        for user in users:
            text = t(lang_admin, "admin_pending_user_info", user_id=user.get('id'), last_name=user.get('last_name', '-'), first_name=user.get('first_name', '-'), email=user.get('email', '-'), phone_mnt=user.get('phone_mnt', '-'), phone=user.get('phone', '-'), reg_num=user.get('registration_number', '-'), bank_mnt=user.get('bank_mnt', '-'), bank_rub=user.get('bank_rub', '-'))

            markup = InlineKeyboardMarkup()
            markup.add(
                InlineKeyboardButton(t(lang_admin, "admin_btn_verify"), callback_data=f"verify_{user['id']}"),
                InlineKeyboardButton(t(lang_admin, "admin_btn_cancel"), callback_data=f"rejectuser_{user['id']}")
            )

            passport_id = user.get('passport_file_id')
            passport_url = user.get("passport_storage_url")

            if passport_id:
                # ✅ Telegram file ID байгаа үед
                bot.send_photo(message.chat.id, passport_id, caption=text, reply_markup=markup)
            elif passport_url:
                # ✅ Telegram ID байхгүй → Supabase public URL-оос татаж илгээх
                try:
                    response = requests.get(passport_url)
                    if response.status_code == 200:
                        photo_bytes = io.BytesIO(response.content)
                        photo_bytes.name = "passport.jpg"
                        bot.send_photo(message.chat.id, photo_bytes, caption=text, reply_markup=markup)
                    else:
                        raise Exception("⚠️ Supabase URL-с зураг татаж чадсангүй.")
                except Exception as e:
                    bot.send_message(message.chat.id, text + t(lang_admin, "admin_no_passport_download"), reply_markup=markup)
                    print(f"❌ Error downloading image from Supabase: {e}")
            else:
                bot.send_message(message.chat.id, text + t(lang_admin, "admin_no_passport_warning"), reply_markup=markup)

    except Exception as e:
        import traceback
        traceback.print_exc()
        bot.send_message(message.chat.id, f"❌ Алдаа гарлаа: {e}")

@bot.callback_query_handler(func=lambda call: call.data.startswith("verify_"))
def verify_user(call):
    user_id = int(call.data.replace("verify_", ""))
    try:
        supabase.table("users").update({"verified": True}).eq("id", user_id).execute()
        lang_admin = get_user_lang(call.from_user.id)
        bot.send_message(call.message.chat.id, t(lang_admin, "admin_user_verified", user_id=user_id), parse_mode="Markdown")
        bot.send_message(user_id, t(get_user_lang(user_id), "verification_submitted").replace("илгээгдлээ! Админ шалгаад хариу өгөх болно.", "баталгаажлаа!"))

        # 🧹 Delete the original message with buttons
        bot.delete_message(call.message.chat.id, call.message.message_id)

    except Exception as e:
        print(f"❌ Error verifying user: {e}")
        bot.send_message(call.message.chat.id, t(get_user_lang(call.from_user.id), "admin_verify_error"))

@bot.callback_query_handler(func=lambda call: call.data.startswith("rejectuser_"))
def reject_user_with_reason_prompt(call):
    user_id = int(call.data.replace("rejectuser_", ""))
    admin_id = call.from_user.id
    update_user_session(admin_id, {"state": f"awaiting_rejection_comment_{user_id}"})

    bot.send_message(admin_id, t(get_user_lang(admin_id), "admin_reject_user_prompt", user_id=user_id), parse_mode="Markdown")

@bot.message_handler(func=lambda m: get_state(m.chat.id).startswith("awaiting_rejection_comment_"))
def handle_rejection_comment(message):
    admin_id = message.chat.id
    text = message.text.strip()
    state = get_state(admin_id)
    try:
        user_id = int(state.split("_")[-1])
    except (ValueError, AttributeError, IndexError):
        bot.send_message(admin_id, t(get_user_lang(admin_id), "admin_reject_read_error"))
        return

    # Save to DB
    supabase.table("users").update({
        "ready_for_verification": False,
    }).eq("id", user_id).execute()

    # Notify both parties
    lang_admin = get_user_lang(admin_id)
    bot.send_message(admin_id, t(lang_admin, "admin_user_rejected", user_id=user_id), parse_mode="Markdown")
    lang_user = get_user_lang(user_id)
    bot.send_message(
        user_id,
        t(lang_user, "user_verification_rejected", reason=text),
        parse_mode="Markdown"
    )
    clear_state(admin_id)

def build_transaction_caption_and_markup(user_id, invoice, amount, currency_from, currency_to, rate, bank_details, receipt_id=None):
    try:
        user_info = bot.get_chat(user_id)
        user_display = user_info.first_name
        if user_info.last_name:
            user_display += f" {user_info.last_name}"
        user_link = f"[{user_display}](tg://user?id={user_id})"

        if user_info.username:
            username_link = f"[@{user_info.username}](https://t.me/{user_info.username})"
        else:
            username_link = "`NoUsername`"

        id_link = f"[`{user_id}`](tg://user?id={user_id})"
        user_line = f"{user_link} — {username_link} — {id_link}"
    except:
        user_line = f"[`{user_id}`](tg://user?id={user_id})"

    converted = round(amount * rate if currency_from.upper() == "RUB" else amount / rate, 2)

    # Use first ALWAYS_NOTIFY admin lang, or fallback to 'ru'
    lang = get_user_lang(ALWAYS_NOTIFY_OPERATOR_ID[0] if ALWAYS_NOTIFY_OPERATOR_ID else 0)
    caption = t(lang, "admin_new_request_caption", invoice=invoice, user_line=user_line, amount=amount, currency_from=currency_from.upper(), currency_to=currency_to.upper(), converted=converted, bank_details=bank_details)

    markup = InlineKeyboardMarkup()
    markup.add(
        InlineKeyboardButton(t(lang, "admin_btn_confirm"), callback_data=f"confirm_{user_id}"),
        InlineKeyboardButton(t(lang, "admin_btn_reject"), callback_data=f"reject_{user_id}")
    )

    return caption, markup
@bot.message_handler(commands=['guilgee'])
def show_pending_transactions(message):
    if message.from_user.id not in ALLOWED_ADMINS:
        bot.send_message(message.chat.id, t(get_user_lang(message.from_user.id), "admin_cmd_unauthorized"))
        return

    response = supabase.table("transactions").select("*").eq("status", "pending").execute()
    transactions = response.data

    if not transactions:
        bot.send_message(message.chat.id, t(get_user_lang(message.from_user.id), "admin_no_pending_txn"))
        return

    for txn in transactions:
        user_id = txn["user_id"]
        invoice = txn["invoice"]
        amount = float(txn["amount"])
        currency_from = txn["currency_from"]
        currency_to = txn["currency_to"]
        bank_details = txn.get("bank_details", "")
        rate = float(txn["rate"])
        receipt_id = txn.get("receipt_id")
        bill_url = txn.get("bill_url")

        # 🔍 Try to get bill_url from bucket based on filename
        if not bill_url:
            try:
                file_name = f"{invoice}_{user_id}.jpg"
                bill_url = storage_public_url(supabase, "bills", file_name)

                # Confirm it's accessible
                check = requests.get(bill_url)
                if check.status_code == 200:
                    supabase.table("transactions").update({"bill_url": bill_url}).eq("invoice", invoice).execute()
                else:
                    bill_url = None
            except Exception as e:
                print(f"⚠️ Couldn't find or save bill_url for {invoice}: {e}")
                bill_url = None

        # 🏷️ Caption + Buttons
        caption, markup = build_transaction_caption_and_markup(
            user_id, invoice, amount, currency_from, currency_to, rate, bank_details, receipt_id
        )

        # 🖼️ Send image if receipt_id works
        if receipt_id:
            try:
                bot.send_photo(message.chat.id, receipt_id, caption=caption, parse_mode="Markdown", reply_markup=markup)
            except Exception as e:
                print(f"⚠️ Telegram-с зураг илгээж чадсангүй: {e}")
                if bill_url:
                    _lang = get_user_lang(message.from_user.id)
                    bot.send_message(message.chat.id, caption + f"\n{t(_lang, 'admin_receipt_view')}({bill_url})", parse_mode="Markdown", reply_markup=markup)
                else:
                    bot.send_message(message.chat.id, caption + t(get_user_lang(message.from_user.id), "admin_receipt_img_missing"), parse_mode="Markdown", reply_markup=markup)
        else:
            if bill_url:
                _lang = get_user_lang(message.from_user.id)
                bot.send_message(message.chat.id, caption + f"\n{t(_lang, 'admin_receipt_view')}({bill_url})", parse_mode="Markdown", reply_markup=markup)
            else:
                bot.send_message(message.chat.id, caption + t(get_user_lang(message.from_user.id), "admin_receipt_not_exist"), parse_mode="Markdown", reply_markup=markup)


@bot.message_handler(commands=["haih"])
def find_user_or_invoice(message):
    admin_id = message.from_user.id
    if admin_id not in ALLOWED_ADMINS:
        return bot.reply_to(message, t(get_user_lang(admin_id), "admin_cmd_unauthorized"))

    args = message.text.split(maxsplit=1)
    if len(args) != 2:
        return bot.reply_to(message, t(get_user_lang(admin_id), "admin_haih_format"))

    query = args[1].strip()

    # 1) If it looks like an invoice (поддерживаем оба формата)
    if is_valid_invoice_format(query):
        invoice = query
        try:
            # Сначала ищем точное совпадение
            resp = supabase.table("transactions") \
                           .select("user_id") \
                           .eq("invoice", invoice) \
                           .limit(1).execute()
            
            # Если не найдено и это старый формат, попробуем найти в новом формате
            if not resp.data and re.fullmatch(r"\d{8}_\d{6}", invoice):
                normalized_invoice = normalize_invoice_format(invoice)
                if normalized_invoice:
                    resp = supabase.table("transactions") \
                                   .select("user_id") \
                                   .eq("invoice", normalized_invoice) \
                                   .limit(1).execute()
            
            # Если не найдено и это новый формат, попробуем найти в старом формате
            elif not resp.data and re.fullmatch(r"\d{8}-\d{6}-\d{2}", invoice):
                old_format = invoice.replace("-", "_")[:-3]  # YYYYMMDD-HHMMSS-XX -> YYYYMMDD_HHMMSS
                resp = supabase.table("transactions") \
                               .select("user_id") \
                               .eq("invoice", old_format) \
                               .limit(1).execute()
                               
        except Exception as e:
            print(f"❌ Supabase lookup error: {e}")
            return bot.reply_to(message, t(get_user_lang(admin_id), "admin_lookup_error"))

        if not resp.data:
            return bot.reply_to(message, t(get_user_lang(admin_id), "admin_haih_txn_not_found", invoice=invoice), parse_mode="Markdown")

        target_id = resp.data[0]["user_id"]
        # fall through to the user-id branch
        query = str(target_id)

    # 2) Now if it’s numeric, treat as Telegram user ID
    if query.isdigit():
        user_id = int(query)
        
        # First, try to get user info from our database
        db_user = None
        try:
            db_resp = supabase.table("users").select("first_name,last_name,phone,verified,bank_rub,bank_mnt").eq("id", user_id).limit(1).execute()
            if db_resp.data:
                db_user = db_resp.data[0]
        except Exception as e:
            print(f"⚠️ DB user lookup error: {e}")
        
        # Try to get Telegram info (may fail if bot hasn't interacted with user)
        tg_user = None
        try:
            tg_user = bot.get_chat(user_id)
        except Exception as e:
            print(f"⚠️ Telegram user lookup error: {e}")
        
        # Build response based on available data
        if db_user or tg_user:
            # Get name parts
            tg_name = ""
            username = ""
            if tg_user:
                tg_name = tg_user.first_name + (f" {tg_user.last_name}" if tg_user.last_name else "")
                username = f"@{tg_user.username}" if tg_user.username else "username_байхгүй"
            
            db_name = ""
            if db_user and (db_user.get("first_name") or db_user.get("last_name")):
                db_name = f"{db_user.get('first_name', '')} {db_user.get('last_name', '')}".strip()
            
            # Build the quick-copy line format: "Name — @username — ID"
            lang_ha = get_user_lang(admin_id)
            display_name = tg_name or db_name or "Unknown"
            quick_line = f"<code>{display_name} — {username} — {user_id}</code>"
            
            lines = [
                t(lang_ha, "admin_haih_user_info_header"),
                t(lang_ha, "admin_haih_copy", quick_line=quick_line)
            ]
            
            # Detailed info
            if db_name:
                lines.append(t(lang_ha, "admin_haih_name_db", name=db_name))
            if tg_name:
                lines.append(t(lang_ha, "admin_haih_name_tg", name=tg_name))
            if tg_user and tg_user.username:
                lines.append(f"🔗 Username: @{tg_user.username}")
            lines.append(f"🆔 ID: <code>{user_id}</code>")
            
            # DB info
            if db_user:
                lines.append("")
                v = t(lang_ha, "admin_haih_verified_yes") if db_user.get('verified') else t(lang_ha, "admin_haih_verified_no")
                lines.append(t(lang_ha, "admin_haih_verified", val=v))
                if db_user.get("phone"):
                    lines.append(f"📞 {db_user.get('phone')}")
                if db_user.get("bank_rub"):
                    lines.append(f"🏦 RUB: {db_user.get('bank_rub')}")
                if db_user.get("bank_mnt"):
                    lines.append(f"🏦 MNT: {db_user.get('bank_mnt')}")
            
            # Get transaction count
            try:
                tx_resp = supabase.table("transactions").select("id", count="exact").eq("user_id", user_id).execute()
                tx_count = tx_resp.count if tx_resp.count else 0
                lines.append(t(lang_ha, "admin_haih_txn_count", count=tx_count))
            except:
                pass
            
            text = "\n".join(lines)
            return bot.send_message(message.chat.id, text, parse_mode="HTML")
        else:
            return bot.reply_to(message, t(get_user_lang(admin_id), "admin_haih_user_not_found", user_id=user_id), parse_mode="HTML")
    else:
        # neither invoice nor pure-digit
        return bot.reply_to(message, t(get_user_lang(admin_id), "admin_haih_format_err"))

@bot.message_handler(commands=["message"])
def send_message_to_user(message):
    """Admin command to send a message to a user by their Telegram user_id.
    Usage: /message [user_id] [message]
    """
    admin_id = message.from_user.id
    if admin_id not in ALLOWED_ADMINS:
        return bot.reply_to(message, t(get_user_lang(admin_id), "admin_cmd_unauthorized"))
    
    lang_adm = get_user_lang(admin_id)
    args = message.text.split(maxsplit=2)
    if len(args) < 3:
        return bot.reply_to(message, t(lang_adm, "admin_msg_format"))
    
    try:
        user_id = int(args[1])
    except ValueError:
        return bot.reply_to(message, t(lang_adm, "admin_msg_bad_id"))
    
    user_message = args[2]
    
    try:
        # Try to send the message to the user
        # Attempt Markdown parsing, fall back to plain text if it fails
        try:
            bot.send_message(user_id, user_message, parse_mode="Markdown")
        except telebot.apihelper.ApiTelegramException as md_error:
            # If Markdown parsing fails, try without formatting
            if "can't parse" in str(md_error).lower():
                bot.send_message(user_id, user_message)
            else:
                raise
        
        # Confirm to admin
        bot.reply_to(
            message, 
            f"✅ Мессеж [{user_id}](tg://user?id={user_id}) руу амжилттай илгээгдлээ.",
            parse_mode="Markdown"
        )
        # Log only metadata, not the actual message content for privacy
        print(f"✅ Admin {admin_id} sent message to user {user_id} (length: {len(user_message)} chars)")
    except telebot.apihelper.ApiTelegramException as e:
        if e.error_code == 403:
            bot.reply_to(
                message, 
                t(get_user_lang(admin_id), "admin_msg_user_blocked", user_id=user_id),
                parse_mode="Markdown"
            )
        elif e.error_code == 400:
            bot.reply_to(
                message, 
                t(get_user_lang(admin_id), "admin_msg_user_not_found", user_id=user_id),
                parse_mode="Markdown"
            )
        else:
            bot.reply_to(message, t(get_user_lang(admin_id), "admin_msg_send_error", error=str(e)))
        print(f"❌ Failed to send message from admin {admin_id} to user {user_id}: {e}")
    except Exception as e:
        bot.reply_to(message, f"❌ Алдаа гарлаа: {e}")
        print(f"❌ Error in send_message_to_user: {e}")


# ── /broadcast – send rate update photo to ALL users (admin & moderator only) ──
BROADCAST_IMAGE_URL = "https://ldolpsylyatkxqsgxhkn.supabase.co/storage/v1/object/public/Oyuns%20Finance/RATE_BOT.png"

def _ub_greeting() -> str:
    h = datetime.now(UB_TZ).hour
    if 6 <= h < 12:
        return "Өглөөний мэнд"
    elif 12 <= h < 18:
        return "Өдрийн мэнд"
    return "Оройн мэнд"

def _format_rate(value) -> str:
    num = float(value)
    return f"{num:,.2f}"

def _fetch_all_user_ids() -> list:
    """Fetch ALL user IDs from the users table, paginating past Supabase's 1000-row limit."""
    all_ids = []
    page_size = 1000
    offset = 0
    while True:
        resp = supabase.table("users").select("id").range(offset, offset + page_size - 1).execute()
        if not resp.data:
            break
        all_ids.extend(u["id"] for u in resp.data)
        if len(resp.data) < page_size:
            break
        offset += page_size
    return all_ids

def _extract_retry_after_seconds(exc: Exception) -> int | None:
    """Extract Telegram retry-after seconds from a flood-control exception message."""
    text = str(exc) or ""
    match = re.search(r"retry after\s+(\d+)", text, flags=re.IGNORECASE)
    if not match:
        return None
    try:
        return int(match.group(1))
    except Exception:
        return None

def _send_broadcast_photo_with_retry(uid: int, caption: str, max_retries: int = 3) -> tuple[bool, str | None]:
    """Send broadcast photo with flood-limit retries. Returns (ok, error_kind)."""
    for attempt in range(max_retries + 1):
        try:
            bot.send_photo(
                uid,
                photo=BROADCAST_IMAGE_URL,
                caption=caption,
                parse_mode="HTML",
            )
            return True, None
        except telebot.apihelper.ApiTelegramException as exc:
            retry_after = _extract_retry_after_seconds(exc)
            if retry_after is not None and attempt < max_retries:
                # Respect Telegram flood-control backoff, then retry.
                time_module.sleep(retry_after + 1)
                continue

            error_code = getattr(exc, "error_code", None)
            if error_code in (400, 403):
                return False, f"telegram_{error_code}"
            return False, "telegram_other"
        except Exception:
            if attempt < max_retries:
                time_module.sleep(1)
                continue
            return False, "unknown"

    return False, "unknown"

def _run_broadcast_send_loop(user_ids: list, caption: str, context: str = "Broadcast") -> tuple[int, int]:
    """Send broadcast with batching and retries; returns (success, failed)."""
    # De-duplicate and sanitize user IDs to avoid repeated failures.
    normalized_ids = []
    seen = set()
    for raw_uid in user_ids:
        try:
            uid = int(raw_uid)
        except Exception:
            continue
        if uid in seen:
            continue
        seen.add(uid)
        normalized_ids.append(uid)

    success = 0
    failed = 0
    for i in range(0, len(normalized_ids), BROADCAST_BATCH_SIZE):
        batch = normalized_ids[i : i + BROADCAST_BATCH_SIZE]
        for uid in batch:
            ok, error_kind = _send_broadcast_photo_with_retry(uid, caption)
            if ok:
                success += 1
            else:
                failed += 1
                print(f"⚠️ {context}: could not send to {uid} ({error_kind})")

        if i + BROADCAST_BATCH_SIZE < len(normalized_ids):
            # Keep a global pace under Telegram's practical throughput limits.
            time_module.sleep(BROADCAST_BATCH_DELAY)

    return success, failed

@bot.message_handler(commands=["broadcast"])
def broadcast_rates(message):
    """Broadcast current exchange rates with photo to ALL users.
    Only admins (ALLOWED_ADMINS) and the moderator (MODERATOR_ID) can use this.
    """
    sender_id = message.from_user.id
    lang_s = get_user_lang(sender_id)
    if sender_id not in ALLOWED_ADMINS and sender_id != MODERATOR_ID:
        return bot.reply_to(message, t(lang_s, "admin_broadcast_unauthorized"))

    # 1. Fetch latest rates
    try:
        rate_resp = supabase.table("bot_rates").select("buy_rate, sell_rate").order("updated_at", desc=True).limit(1).execute()
        if not rate_resp.data:
            return bot.reply_to(message, t(lang_s, "admin_broadcast_no_rates"))
        rate = rate_resp.data[0]
        buy_rate = _format_rate(rate["buy_rate"])
        sell_rate = _format_rate(rate["sell_rate"])
    except Exception as e:
        print(f"❌ Broadcast: failed to fetch rates: {e}")
        return bot.reply_to(message, t(lang_s, "admin_broadcast_rate_error", error=str(e)))

    # 2. Build caption
    now = datetime.now(UB_TZ)
    date_str = now.strftime("%Y/%m/%d")
    ub_time = now.strftime("%H:%M")
    msk_time = datetime.now(MOSCOW_TZ).strftime("%H:%M")

    caption = (
        f"💸 <b>{_ub_greeting()}!</b>\n"
        f"\n"
        f"📊 <b>ХАНШИЙН МЭДЭЭЛЭЛ. {date_str}, УБ: {ub_time} | МСК: {msk_time}</b>\n"
        f"\n"
        f"🔹 <b>Рубль авах</b>(РУБ-МНТ): <b>{buy_rate}</b>\n"
        f"🔹 <b>Рубль зарах</b>(МНТ-РУБ): <b>{sell_rate}</b>\n"
        f"\n"
        f"💬  Хэрэв танд апп-тай холбоотой ямар нэгэн асуудал гарвал @oyuns_finance хаягааp холбогдоно уу.\n"
        f"\n"
        f"⚡️<b>OYUNS ALL-IN-ONE</b> – Илүү хялбар, илүү найдвартай, илүү хурдан\n"
        f"\n"
        f"Өдрийг сайхан өнгөрүүлээрэй ☀️"
    )

    # 3. Fetch all user IDs (paginated)
    try:
        user_ids = _fetch_all_user_ids()
    except Exception as e:
        print(f"❌ Broadcast: failed to fetch users: {e}")
        return bot.reply_to(message, t(lang_s, "admin_broadcast_users_error", error=str(e)))

    if not user_ids:
        return bot.reply_to(message, t(lang_s, "admin_broadcast_no_users"))

    bot.reply_to(message, f"📡 Broadcast эхэллээ... ({len(user_ids)} хэрэглэгч)")

    # 4. Send photo to every user
    # 4. Send photo to every user with retry-aware batching
    success, failed = _run_broadcast_send_loop(user_ids, caption, context="Broadcast")

    bot.send_message(
        message.chat.id,
        f"✅ Broadcast дууслаа!\n📤 Амжилттай: {success}\n❌ Алдаатай: {failed}",
    )
    print(f"✅ Broadcast by {sender_id}: {success} sent, {failed} failed")


# ── Scheduled daily broadcast (10:00–11:00 MSK, once per day, batched) ──
_last_auto_broadcast_date = None          # tracks the date of the last auto-broadcast
BROADCAST_BATCH_SIZE = 15                 # users per batch
BROADCAST_BATCH_DELAY = 1.0               # seconds between batches

def _build_broadcast_caption() -> str | None:
    """Fetch rates and build the broadcast caption. Returns None on failure."""
    try:
        rate_resp = supabase.table("bot_rates").select("buy_rate, sell_rate").order("updated_at", desc=True).limit(1).execute()
        if not rate_resp.data:
            print("❌ AutoBroadcast: no rates found")
            return None
        rate = rate_resp.data[0]
        buy_rate = _format_rate(rate["buy_rate"])
        sell_rate = _format_rate(rate["sell_rate"])
    except Exception as e:
        print(f"❌ AutoBroadcast: failed to fetch rates: {e}")
        return None

    now = datetime.now(UB_TZ)
    date_str = now.strftime("%Y/%m/%d")
    ub_time = now.strftime("%H:%M")
    msk_time = datetime.now(MOSCOW_TZ).strftime("%H:%M")

    return (
        f"💸 <b>{_ub_greeting()}!</b>\n"
        f"\n"
        f"📊 <b>ХАНШИЙН МЭДЭЭЛЭЛ. {date_str}, УБ: {ub_time} | МСК: {msk_time}</b>\n"
        f"\n"
        f"🔹 <b>Рубль авах</b>(РУБ-МНТ): <b>{buy_rate}</b>\n"
        f"🔹 <b>Рубль зарах</b>(МНТ-РУБ): <b>{sell_rate}</b>\n"
        f"\n"
        f"💬  Хэрэв танд апп-тай холбоотой ямар нэгэн асуудал гарвал @oyuns_finance хаягааp холбогдоно уу.\n"
        f"\n"
        f"⚡️<b>OYUNS ALL-IN-ONE</b> – Илүү хялбар, илүү найдвартай, илүү хурдан\n"
        f"\n"
        f"Өдрийг сайхан өнгөрүүлээрэй ☀️"
    )

def _auto_broadcast_loop():
    """Background thread: check every 60s, send once between 10:00–11:00 MSK."""
    global _last_auto_broadcast_date
    while True:
        try:
            now_msk = datetime.now(MOSCOW_TZ)
            today = now_msk.date()

            # Only fire between 10:00 and 10:59 MSK, and only once per calendar day
            if 10 <= now_msk.hour < 11 and _last_auto_broadcast_date != today:
                _last_auto_broadcast_date = today
                print(f"📡 AutoBroadcast triggered at {now_msk.strftime('%H:%M')} MSK")

                caption = _build_broadcast_caption()
                if not caption:
                    time_module.sleep(60)
                    continue

                # Fetch all users (paginated)
                try:
                    user_ids = _fetch_all_user_ids()
                except Exception as e:
                    print(f"❌ AutoBroadcast: failed to fetch users: {e}")
                    time_module.sleep(60)
                    continue

                if not user_ids:
                    print("⚠️ AutoBroadcast: no users found")
                    time_module.sleep(60)
                    continue

                # Send in batches
                # Send in batches with retry-aware flood-control handling
                success, failed = _run_broadcast_send_loop(user_ids, caption, context="AutoBroadcast")

                print(f"✅ AutoBroadcast done: {success} sent, {failed} failed")

                # Notify admin about the result
                try:
                    bot.send_message(
                        1932946217,
                        f"📡 Автомат broadcast дууслаа ({now_msk.strftime('%H:%M')} MSK)\n"
                        f"📤 Амжилттай: {success}\n❌ Алдаатай: {failed}",
                    )
                except Exception:
                    pass

        except Exception as e:
            print(f"❌ AutoBroadcast loop error: {e}")

        time_module.sleep(60)  # check every 60 seconds


@bot.message_handler(commands=["testbroadcast"])
def test_broadcast_rates(message):
    """Test broadcast – sends the rate photo only to admins and the moderator."""
    sender_id = message.from_user.id
    lang_s = get_user_lang(sender_id)
    if sender_id not in ALLOWED_ADMINS and sender_id != MODERATOR_ID:
        return bot.reply_to(message, t(lang_s, "admin_broadcast_unauthorized"))

    # 1. Fetch latest rates
    try:
        rate_resp = supabase.table("bot_rates").select("buy_rate, sell_rate").order("updated_at", desc=True).limit(1).execute()
        if not rate_resp.data:
            return bot.reply_to(message, t(lang_s, "admin_broadcast_no_rates"))
        rate = rate_resp.data[0]
        buy_rate = _format_rate(rate["buy_rate"])
        sell_rate = _format_rate(rate["sell_rate"])
    except Exception as e:
        print(f"❌ TestBroadcast: failed to fetch rates: {e}")
        return bot.reply_to(message, t(lang_s, "admin_broadcast_rate_error", error=str(e)))

    # 2. Build caption
    now = datetime.now(UB_TZ)
    date_str = now.strftime("%Y/%m/%d")
    ub_time = now.strftime("%H:%M")
    msk_time = datetime.now(MOSCOW_TZ).strftime("%H:%M")

    caption = (
        f"💸 <b>{_ub_greeting()}!</b>\n"
        f"\n"
        f"📊 <b>ХАНШИЙН МЭДЭЭЛЭЛ. {date_str}, УБ: {ub_time} | МСК: {msk_time}</b>\n"
        f"\n"
        f"🔹 <b>Рубль авах</b>(РУБ-МНТ): <b>{buy_rate}</b>\n"
        f"🔹 <b>Рубль зарах</b>(МНТ-РУБ): <b>{sell_rate}</b>\n"
        f"\n"
        f"💬  Хэрэв танд апп-тай холбоотой ямар нэгэн асуудал гарвал @oyuns_finance хаягааp холбогдоно уу.\n"
        f"\n"
        f"⚡️<b>OYUNS ALL-IN-ONE</b> – Илүү хялбар, илүү найдвартай, илүү хурдан\n"
        f"\n"
        f"Өдрийг сайхан өнгөрүүлээрэй ☀️"
    )

    # 3. Send only to admins + moderator
    test_ids = list(ALLOWED_ADMINS) + [MODERATOR_ID]
    # Deduplicate
    test_ids = list(dict.fromkeys(test_ids))

    bot.reply_to(message, f"🧪 Test broadcast эхэллээ... ({len(test_ids)} хүн)")

    # 4. Send photo to test recipients with the same retry-aware sender
    success, failed = _run_broadcast_send_loop(test_ids, caption, context="TestBroadcast")

    bot.send_message(
        message.chat.id,
        f"✅ Test broadcast дууслаа!\n📤 Амжилттай: {success}\n❌ Алдаатай: {failed}",
    )
    print(f"✅ TestBroadcast by {sender_id}: {success} sent, {failed} failed")


@bot.message_handler(func=lambda m: True, content_types=['text'])
def handle_unknown_text(message):
    # only fire when we're not in the middle of a flow
    if get_state(message.chat.id):
        return

    lang = get_user_lang(message.chat.id)
    fallback_key = "unknown_pending" if has_active_webapp_requests(message.chat.id) else "unknown_general"
    bot.send_message(message.chat.id, t(lang, fallback_key))


# 🏃 Initialize and Run the Bot
def initialize_bot():
    """Load existing referral links from database into memory cache on startup"""

    # This bot receives updates through long polling (see run_bot below). Telegram
    # will not deliver those updates while a webhook is configured, even though
    # outgoing calls such as sendMessage/sendPhoto continue to work. Clear a
    # stale webhook at every start so commands and callback buttons keep working
    # after a deploy or a previous webhook-based configuration.
    try:
        webhook = bot.get_webhook_info()
        if webhook.url:
            print(f"⚠️ Removing existing Telegram webhook: {webhook.url}")
            bot.delete_webhook(drop_pending_updates=False)
            print("✅ Existing Telegram webhook removed; long polling is active")
    except Exception as e:
        # Do not prevent startup for a transient Telegram API error. infinity_polling
        # below will continue retrying the update connection.
        print(f"⚠️ Could not check/remove Telegram webhook: {e}")

    # ── Set /start command menu & web app menu button ──
    try:
        from telebot.types import BotCommand, BotCommandScopeDefault
        bot.set_my_commands(
            [BotCommand("start", "Эхлэх")],
            scope=BotCommandScopeDefault(),
        )
        # Set the "launch app" button next to the text field
        bot.set_chat_menu_button(
            menu_button=telebot.types.MenuButtonWebApp(
                text="OYUNS ALL-IN-ONE",
                web_app=WebAppInfo(url=WEBAPP_URL),
            )
        )
        print("✅ Bot command menu & web app button set")
    except Exception as e:
        print(f"⚠️ Failed to set bot menu: {e}")

    # ── Load referral links ──
    try:
        print("🔄 Loading referral links from database...")
        resp = supabase.table("referral_links").select("referrer_id, invite_link").eq("is_active", True).execute()
        if resp.data:
            for row in resp.data:
                referrer_id = row.get("referrer_id")
                invite_link = row.get("invite_link")
                if referrer_id and invite_link:
                    invite_link_to_referrer[invite_link] = referrer_id
                    referrer_to_invite_link[referrer_id] = invite_link
            print(f"✅ Loaded {len(resp.data)} active referral links into cache")
        else:
            print("ℹ️ No active referral links found in database")
    except Exception as e:
        print(f"⚠️ Failed to load referral links from database: {e}")

    # ── Start scheduled auto-broadcast thread ──
    broadcast_thread = threading.Thread(target=_auto_broadcast_loop, daemon=True)
    broadcast_thread.start()
    print("✅ Auto-broadcast scheduler started (10:00–11:00 MSK daily)")

def run_bot() -> None:
    """Initialize the bot and keep the incoming-update listener resilient."""
    if not BOT_TOKEN:
        raise RuntimeError("BOT_TOKEN is not configured; refusing to start the Telegram bot")

    print("🤖 Starting OYUNS ALL-IN-ONE Bot...")
    initialize_bot()
    print("✅ Bot initialized, starting long polling...")
    # infinity_polling reconnects after temporary Telegram/network failures. It
    # is required for commands and callback queries; outgoing notifications do
    # not exercise this update connection.
    bot.infinity_polling(timeout=30, long_polling_timeout=25)


if __name__ == "__main__":
    run_bot()
