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

_admin_media_buffers: Dict[str, List[str]] = {}
_admin_media_flush_scheduled: Set[str] = set()

MOSCOW_TZ = ZoneInfo("Europe/Moscow")
MIN_RUB = 5000
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
WEBAPP_URL = os.getenv("WEBAPP_URL", "https://oyunswebapp.ddns.net")
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
CONTACT_SUPPORT = "📞 Холбоо барих: +976 7780 6060\n +7 (977) 801-91-43\n [https://t.me/oyuns_finance]"
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

NOT_WORKING_TEXT = (
    "⏳ Бид одоогоор ажиллахгүй байна. Та дараа манай ажлын цаг нээгдэхээр дахин оролдоно уу.\n"
    "📞 Тусламж: @oyuns_finance"
)
def ensure_admin_available(chat_id: int) -> bool:
    admin_id = get_current_admin_id()
    if not admin_id:
        bot.send_message(chat_id, NOT_WORKING_TEXT)
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
        text = (
            "📌 Санамж: Ээлж дуусах/шилжүүлсний дараа өөрийн банкны үлдэгдлийг "
            "OYUNS FINANCE дотоод системд бүртгэнэ үү.\n\n"
            "🔗 Систем: https://oyunsadmin.pages.dev/"
        )
        markup = InlineKeyboardMarkup()
        markup.add(InlineKeyboardButton(
            "📊 Банкны дансны үлдэгдэл бүртгэх",
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

#HEREGLEGCHIIN GEREE

def ask_terms_agreement(chat_id):
    markup = InlineKeyboardMarkup()
    markup.add(InlineKeyboardButton("📄 Хэрэглэгчийн гэрээ", url="https://oyunsfinance.com/oyuns-aio-telegram-bot-%d1%85%d1%8d%d1%80%d1%8d%d0%b3%d0%bb%d1%8d%d0%b3%d1%87%d0%b8%d0%b9%d0%bd-%d0%b3%d1%8d%d1%80%d1%8d%d1%8d/"))
    markup.add(InlineKeyboardButton("✅ Зөвшөөрч байна", callback_data="accept_terms"))
    bot.send_message(chat_id, "📜 Сайн байна уу, та OYUNS Finance бот ашиглахын өмнө [хэрэглэгчийн гэрээтэй](https://oyunsfinance.com/oyuns-aio-telegram-bot-%d1%85%d1%8d%d1%80%d1%8d%d0%b3%d0%bb%d1%8d%d0%b3%d1%87%d0%b8%d0%b9%d0%bd-%d0%b3%d1%8d%d1%80%d1%8d%d1%8d/) уншиж танилцана уу. Хэрвээ зөвшөөрч байвал дараах товчыг дарж үргэлжлүүлээрэй.", parse_mode="Markdown", reply_markup=markup)
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
    bot.answer_callback_query(call.id, "Та OYUNS Finance Telegram Bot-ын хэрэглэгчийн гэрээг зөвшөөрлөө.")
    bot.send_message(call.message.chat.id, "Баярлалаа! Та ийнхүү бидний үйлчилгээг ашиглах боломжтой боллоо.")
    def delayed_start():
        time_module.sleep(1.0)  # Let Supabase commit finish
        handle_start(call.message)

    threading.Thread(target=delayed_start).start()

@bot.message_handler(commands=['geree'])
def terms_handler(message):
  markup = InlineKeyboardMarkup()
  markup.add(InlineKeyboardButton("📄 Хэрэглэгчийн гэрээ:", url="https://oyunsfinance.com/oyuns-aio-telegram-bot-%d1%85%d1%8d%d1%80%d1%8d%d0%b3%d0%bb%d1%8d%d0%b3%d1%87%d0%b8%d0%b9%d0%bd-%d0%b3%d1%8d%d1%80%d1%8d%d1%8d/"))
  bot.send_message(message.chat.id, "📄 Та хэрэглэгчийн гэрээг эндээс уншина уу.", reply_markup=markup)
    
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
        return  # Admin биш бол чимээгүй

    current_admin_id = get_current_admin_id()
    if current_admin_id:
        bot.send_message(
            message.chat.id,
            f"👤 Одоогийн ээлж хариуцагч: [{current_admin_id}](tg://user?id={current_admin_id})",
            parse_mode="Markdown"
        )
    else:
        bot.send_message(message.chat.id, "❓ Одоогоор ээлж томилоогүй байна.")



def get_current_shift_config():
    admin_id = get_current_admin_id()
    if not admin_id:
        return None

    # Define each admin's bank details
    bank_info_by_admin = {
        5564298862: {
            "sberbank_rub": (
                "🏦 *Сбербанк*\n\n"
                "Картын дугаар: ``\n"
                "Утасны дугаар: ``\n"
                "Дансны нэр: **"
            ),
            "vtbbank_rub": (
                "🏦 *ВТБ*\n\n"
                "Картын дугаар: ``\n"
                "Утасны дугаар: ``\n"
                "Дансны нэр: **"
            ),
            "alphabank_rub": (
                "🏦 *Альфа*\n\n"
                "Картын дугаар: `2200 1529 1699 8639`\n"
                "Утасны дугаар: `+7 999 683 02 75`\n"
                "Дансны нэр: *Emuujin*"
            ),
            "bank_mnt": (
                "🏦 *ХААН БАНК*\n\n"
                "Дансны нэр: *Амгаланбаатар*\n"
                "Данс: `MN13000500 5403213664`"
            )
        },
        1932946217: {
            "sberbank_rub2": (
                "🏦 *СБЕРБАНК*\n\n"
                "Картын дугаар: `2202 2084 1034 6242`\n"
                "Утасны дугаар: `+7 996 437 18 92`\n"
                "Дансны нэр: *Анужин*"
            ),
            "sberbank_rub1": (
                "🏦 *СБЕРБАНК*\n\n"
                "Картын дугаар: `2202 2063 0354 3297`\n"
                "Утасны дугаар: `+7 999 686 78 93`\n"
                "Дансны нэр: *Анударь*"
            ),
            "vtbbank_rub": (
                "🏦 *ВТБ*\n\n"
                "Картын дугаар: ``\n"
                "Утасны дугаар: ``\n"
                "Дансны нэр: **"
            ),
            "alphabank_rub1": (
                "🏦 *АЛЬФА БАНК*\n\n"
                "Картын дугаар: `2200 1529 0483 3053`\n"
                "Утасны дугаар: `+7 950 096 92 87`\n"
                "Дансны нэр: *Тувшинжаргал Мунхзаяа*"
            ),
            "alphabank_rub2": (
                "🏦 *АЛЬФА БАНК*\n\n"
                "Картын дугаар: `2200 1529 9148 7847`\n"
                "Утасны дугаар: `+7 999 642 63 28`\n"
                "Дансны нэр: *Ачитбаатар*"
            ),
            "bank_mnt": (
                "🏦 *ХААН БАНК*\n\n"
                "Дансны нэр: *Амгаланбаатар*\n"
                "Данс: `MN13000500 5403213664`"
            )
        },

        1409343588: {
            "sberbank_rub2": (
                "🏦 *СБЕРБАНК*\n\n"
                "Картын дугаар: `2202 2084 1034 6242`\n"
                "Утасны дугаар: `+7 996 437 18 92`\n"
                "Дансны нэр: *Анужин*"
            ),
            "sberbank_rub1": (
                "🏦 *СБЕРБАНК*\n\n"
                "Картын дугаар: `2202 2063 0354 3297`\n"
                "Утасны дугаар: `+7 999 686 78 93`\n"
                "Дансны нэр: *Анударь*"
            ),
            "vtbbank_rub": (
                "🏦 *ВТБ*\n\n"
                "Картын дугаар: ``\n"
                "Утасны дугаар: ``\n"
                "Дансны нэр: **"
            ),
            "alphabank_rub1": (
                "🏦 *АЛЬФА БАНК*\n\n"
                "Картын дугаар: `2200 1529 0483 3053`\n"
                "Утасны дугаар: `+7 999 682 39 08`\n"
                "Дансны нэр: *Тувшинжаргал Мунхзаяа*"
            ),
            "alphabank_rub2": (
                "🏦 *АЛЬФА БАНК*\n\n"
                "Картын дугаар: `2200 1529 9148 7847`\n"
                "Утасны дугаар: `+7 999 642 63 28`\n"
                "Дансны нэр: *Ачитбаатар*"
            ),
            "bank_mnt": (
                "🏦 *ХААН БАНК*\n\n"
                "Дансны нэр: *Амгаланбаатар*\n"
                "Данс: `MN13000500 5403213664`"
            )
        }
    }

    if admin_id not in bank_info_by_admin:
        return None

    admin_data = bank_info_by_admin[admin_id]

    # only one bank for admin 5564298862
    if admin_id == 5564298862:
        rub_options = {
            "Альфа банк": admin_data["alphabank_rub"]
        }
        bank_rub = admin_data["sberbank_rub"]
    else:
        rub_options = {
            "Альфа": admin_data["alphabank_rub1"]
            
        }
        bank_rub = admin_data["sberbank_rub2"]  # choose default (or whichever you prefer)
    
    return {
        "operator_id": admin_id,
        "bank_rub": bank_rub,
        "bank_mnt": admin_data["bank_mnt"],
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
            current_admin_display = "❌ Ээлж хаалттай байна"
    except Exception as e:
        print(f"❌ Couldn't fetch chat info: {e}")
        current_admin_display = "❓ Тодорхойгүй"

    # Inline buttons
    markup = InlineKeyboardMarkup()

    for admin_id in ALLOWED_ADMINS:
        if admin_id != current_admin_id:
            try:
                admin_chat = bot.get_chat(admin_id)
                name = admin_chat.first_name
                if admin_chat.last_name:
                    name += f" {admin_chat.last_name}"
            except:
                name = str(admin_id)
            markup.add(InlineKeyboardButton(f"➡️ Ээлж шилжүүлэх: {name}", callback_data=f"shift_to_{admin_id}"))

    if current_admin_id:
        markup.add(InlineKeyboardButton("🔒 Ээлж хаах", callback_data="shift_close"))
    else:
        markup.add(InlineKeyboardButton("✅ Ээлж нээх", callback_data=f"shift_to_{message.from_user.id}"))

    bot.send_message(
        message.chat.id,
        f"👤 Одоогийн ээлж хариуцагч: {current_admin_display}",
        parse_mode="Markdown",
        reply_markup=markup
    )

@bot.callback_query_handler(func=lambda call: call.data.startswith("shift_to_"))
def transfer_shift(call):
    if call.from_user.id not in ALLOWED_ADMINS:
        return bot.answer_callback_query(call.id, "🚫 Зөвшөөрөлгүй!", show_alert=True)

    # Capture current (previous) admin before transfer
    previous_admin_id = get_current_admin_id()
    new_admin_id = int(call.data.replace("shift_to_", ""))
    success = set_current_admin_id(new_admin_id, performed_by_admin_id=call.from_user.id, is_automatic=False)
    if success:
        bot.edit_message_text(
            f"✅ Ээлжийг амжилттай шилжүүллээ: [{new_admin_id}](tg://user?id={new_admin_id})",
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
        return bot.answer_callback_query(call.id, "🚫 Зөвшөөрөлгүй!", show_alert=True)

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
        
        bot.edit_message_text(
            "🔒 Ээлж амжилттай хаагдлаа.",
            call.message.chat.id,
            call.message.message_id
        )
        # Prompt the closing admin to log their bank remainder
        if previous_admin_id:
            prompt_admin_bank_remainder(previous_admin_id, context="close")
    except Exception as e:
        print(f"❌ Failed to close shift: {e}")
        bot.answer_callback_query(call.id, "❌ Ээлж хаах үед алдаа гарлаа.")


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

# 🎁 Award gift for qualifying transactions
def award_gift_for_transaction(user_id: int, amount: float, currency_from: str, currency_to: str, rate: float):
    """Award a gift if transaction is >= 10,000 RUB in either direction."""
    try:
        # Ensure we have reference rates for correct RUB-equivalent calculation
        try:
            if not exchange_rates.get("BUY_RATE") or not exchange_rates.get("SELL_RATE"):
                fetch_exchange_rates()
        except Exception:
            pass

        buy_rate = float(exchange_rates.get("BUY_RATE") or 0)  # MNT per RUB when buying RUB (user sends MNT)
        sell_rate = float(exchange_rates.get("SELL_RATE") or 0)  # MNT per RUB when selling RUB (user sends RUB)

        # Calculate RUB equivalent for threshold and message
        rub_amount = 0.0
        if currency_from.upper() == "RUB":
            # RUB → MNT: use SELL rate (RUB * sell_rate gives MNT; keep RUB side as original amount)
            rub_amount = amount * (sell_rate or rate or 1)
        elif currency_to.upper() == "RUB":
            # MNT → RUB: convert MNT to RUB using BUY rate
            divisor = buy_rate or rate or 1
            rub_amount = amount / divisor
        
        # Award gift if >= 10,000 RUB
        if rub_amount >= 10000:
            user_resp = supabase.table("users").select("pending_gifts").eq("id", user_id).limit(1).execute()
            current_gifts = 0
            if user_resp.data:
                current_gifts = int(user_resp.data[0].get("pending_gifts") or 0)
            
            new_gifts = current_gifts + 1
            supabase.table("users").upsert({"id": user_id, "pending_gifts": new_gifts}).execute()
            
            # Notify user about the gift with button
            markup = InlineKeyboardMarkup()
            markup.add(InlineKeyboardButton("🎁 Бэлэг нээх", callback_data="open_gift"))
            markup.add(InlineKeyboardButton("🔙 Нүүр хуудас", callback_data="back_main"))
            
            bot.send_photo(
                user_id,
                photo="https://ldolpsylyatkxqsgxhkn.supabase.co/storage/v1/object/public/Oyuns%20Finance/bot_promo3.png",
                caption=
                f"🎁 Баяр хүргэе! Та 10'000 РУБ-ээс дээш гүйлгээ хийснээр шинэ оны бэлэг нээх эрх авлаа! 🎉\n\n"
                f"🎄 Та одоо {new_gifts} бэлэг нээх боломжтой байна.\n\n"
                f"🎅 Боломжит бэлгүүд:\n"
                f" • Мөнгөн шагналт\n"
                f" • Промокод(алт, мөнгө, хүрэл)\n"
                f" • Дахин бэлэг нээх эрх\n"
                f" • Шинэ жилийн мэндчилгээ\n\n"
                f"✨ Доорх товчийг дараад бэлгээ нээгээрэй.",
                parse_mode="Markdown",
                reply_markup=markup
            )
            print(f"🎁 Gift awarded to user {user_id} for {rub_amount:,.2f} RUB exchange. Total gifts: {new_gifts}")
            return True
        return False
    except Exception as e:
        print(f"❌ Error awarding gift: {e}")
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
def main_menu():
    markup = InlineKeyboardMarkup()
    # Add Web App button at the top
    markup.add(InlineKeyboardButton("🚀 OYUNS Finance App нээх", web_app=WebAppInfo(url=WEBAPP_URL)))
    
    markup.row_width = 2
    markup.add(
        InlineKeyboardButton("📊 Ханш", callback_data="exchange_rate"),
        InlineKeyboardButton("💱 Валют солих", callback_data="exchange_menu"),
        InlineKeyboardButton("👤 Хэрэглэгчийн тохиргоо", callback_data="user_profile"),
        InlineKeyboardButton("⭐ Бусад үйлчилгээ", callback_data="other_services"),
        InlineKeyboardButton("📝 Бүртгүүлэх", callback_data="start_registration"),
        InlineKeyboardButton("🤝 Найз урих", callback_data="invite_friend")
    )
    return markup

@bot.callback_query_handler(func=lambda call: call.data == "contact_support")
def contact_support_handler(call):
    bot.send_message(
        call.message.chat.id,
        "📞 *Холбоо барих мэдээлэл:*\n\n"
        "📱 +976 7780 6060\n"
        "📱 +7 (977) 801-91-43\n"
        "🔗 Telegram: [@oyuns_finance](https://t.me/oyuns_finance)",
        parse_mode="Markdown"
    )
@bot.callback_query_handler(func=lambda call: call.data == "restart_registration")
def restart_registration(call):
    user_id = call.message.chat.id
    bot.send_message(user_id, "🔁 Бүртгэлийг шинээр эхлүүлж байна...")
    update_user_session(user_id, {"state": "register_last_name"})
    bot.send_message(user_id, "👤 Та өөрийн овгоо оруулна уу:", reply_markup=cancel_markup())

    

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
    response = supabase.table("users").select("id").eq("id", user_id).execute()
    if not response.data:
        supabase.table("users").insert({"id": user_id}).execute()

    # 🧾 Now check if they’ve agreed
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
        "👋 Сайн байна уу? OYUNS Finance Bot-д тавтай морил!\nТа дараах үйлчилгээнүүдээс сонгон үйлчлүүлнэ үү:",

        reply_markup=main_menu()
    )


#----------------------OTHER SERVICES-----------------------------
FLIGHT_BOOKING_TG = "OYUNS_Finance"

# Other Services Menu
@bot.callback_query_handler(func=lambda call: call.data == "other_services")
def other_services_menu(call):
    markup = InlineKeyboardMarkup()
    markup.add(
        InlineKeyboardButton("✈️ Нислэг захиалга", callback_data="flight_booking"),
        InlineKeyboardButton("📱 Утасны дугаар цэнэглэх", callback_data="phone_topup"),
        InlineKeyboardButton("🔙 Буцах", callback_data="back_main")
    )
    bot.send_message(
        call.message.chat.id,
        "⭐ *Бусад үйлчилгээ*\n\nТа дараах үйлчилгээнүүдээс сонгоно уу:",
        reply_markup=markup,
        parse_mode="Markdown"
    )

@bot.callback_query_handler(func=lambda call: call.data == "flight_booking")
def flight_booking_info(call):
    kb = InlineKeyboardMarkup()
    kb.add(InlineKeyboardButton("📨 OYUNS FINANCE", url=f"https://t.me/{FLIGHT_BOOKING_TG}"))
    kb.add(InlineKeyboardButton("🔙 Буцах", callback_data="other_services"))

    bot.send_message(
        call.message.chat.id,
        "✈️ *OYUNS онгоцны тийз захиалга*\n\n"
        "Та нислэгийн тийз захиалахын тулд хэзээ, ямар чиглэлд нисэх тухай ерөнхий мэдээллээ дараах чатаар явуулж захиалаарай:\n\n"
        f"📨 [@{FLIGHT_BOOKING_TG}](https://t.me/{FLIGHT_BOOKING_TG})",
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
    user_id = call.message.chat.id
    
    # Check business hours and admin availability
    if not is_within_ub_business_hours():
        bot.answer_callback_query(call.id)
        bot.send_message(
            user_id,
            "⚠️ Бид Москвагийн цагаар 04:00-23:00 хооронд, Улаанбаатарын цагаар 09:00–04:00(дараа өдрийн) цагийн хооронд ажиллаж байна.",
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

    # Save the state
    update_user_session(user_id, {"state": "phone_topup_amount"})
    
    bot.answer_callback_query(call.id)
    bot.send_message(
        user_id,
        "📱 *Утасны дугаар цэнэглэх*\n\n"
        "💰 Та хэдэн РУБ-ээр цэнэглэх вэ?\n\n"
        "Мөнгөн дүнг оруулна уу. Жишээ нь: `500` эсвэл `1000`",
        parse_mode="Markdown"
    )

@bot.message_handler(func=lambda message: get_state(message.chat.id) == "phone_topup_amount")
def receive_topup_amount(message):
    user_id = message.chat.id
    
    try:
        if not message.text:
            bot.send_message(user_id, "❌ Мессеж хоосон байна. Дахин оролдоно уу.")
            return
        
        raw = re.sub(r"\D", "", message.text)
        
        if not raw or not raw.isdigit():
            bot.send_message(
                user_id,
                "❌ Зөвхөн тоон утга оруулна уу (жишээ: 500).",
                parse_mode="Markdown"
            )
            return
        
        amount = int(raw)
        
        if amount <= 0:
            bot.send_message(user_id, "❌ Дүн 0-ээс их байх ёстой.")
            return
        
        # Calculate MNT equivalent
        base_rate = exchange_rates.get("SELL_RATE")
        
        if not base_rate:
            # Try to fetch rates
            fetch_exchange_rates()
            base_rate = exchange_rates.get("BUY_RATE")
            
            if not base_rate:
                bot.send_message(user_id, "❌ Ханш татах үед алдаа гарлаа. Дахин оролдоно уу.")
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
            f"💰 Та {amount:,} РУБ-ээр цэнэглэх гэж байна.\n"
            f"💱 Төлөх дүн: *{int(mnt_amount):,} MNT*\n\n"
            "📱 Та цэнэглэх утасны дугаараа оруулна уу:\n\n"
            "Жишээ нь: `+79001234567` эсвэл `79001234567`",
            parse_mode="Markdown"
        )
        
    except Exception as e:
        print(f"❌ Error in receive_topup_amount: {e}")
        import traceback
        traceback.print_exc()
        bot.send_message(user_id, "❌ Алдаа гарлаа. Дахин оролдоно уу.")
        return

@bot.message_handler(func=lambda message: get_state(message.chat.id) == "phone_topup_phone_number")
def receive_topup_phone_number(message):
    user_id = message.chat.id
    if not ensure_exchange_available(user_id):
        return
    
    phone_number = message.text.strip()
    
    # Validate phone number format (basic validation)
    cleaned_phone = re.sub(r"[^\d+]", "", phone_number)
    if not cleaned_phone or len(cleaned_phone) < 10:
        bot.send_message(
            user_id,
            "❌ Утасны дугаар буруу байна. Дахин оруулна уу.\n\n"
            "Жишээ нь: `+79001234567` эсвэл `79001234567`",
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
    markup.add(InlineKeyboardButton("✏️ Бусад", callback_data="topup_telecom_custom"))
    markup.add(InlineKeyboardButton("🔙 Цуцлах", callback_data="other_services"))
    
    bot.send_message(
        user_id,
        f"📱 Утасны дугаар: `{cleaned_phone}`\n\n"
        "📡 Та аль үүрэн телефоны компаний дугаар цэнэглэх вэ?",
        reply_markup=markup,
        parse_mode="Markdown"
    )

@bot.callback_query_handler(func=lambda call: call.data.startswith("topup_telecom_"))
def receive_topup_telecom(call):
    user_id = call.message.chat.id
    if not ensure_exchange_available(user_id):
        bot.answer_callback_query(call.id)
        return
    
    telecom_key = call.data.replace("topup_telecom_", "")
    
    # Handle custom telecom input request
    if telecom_key == "custom":
        bot.answer_callback_query(call.id)
        update_user_session(user_id, {"state": "phone_topup_custom_telecom"})
        bot.send_message(
            user_id,
            "✏️ Та үүрэн телефоны оператороо бичнэ үү:\n\n"
            "Жишээ нь: `Tinkoff Mobile` эсвэл `Ростелеком`",
            parse_mode="Markdown"
        )
        return
    
    telecom_name = TELECOM_COMPANIES.get(telecom_key, telecom_key)
    
    session = get_user_session(user_id)
    if not session:
        bot.send_message(user_id, "⚠️ Гүйлгээний мэдээлэл олдсонгүй. Та эхнээс эхлэнэ үү.")
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
        f"📱 *Утасны дугаар цэнэглэлт*\n\n"
        f"💰 Цэнэглэх дүн: *{amount_rub:,} РУБ*\n"
        f"📱 Утасны дугаар: `{phone_number}`\n"
        f"📡 Оператор: *{telecom_name}*\n\n"
        f"💱 Төлөх дүн: *{int(amount_mnt):,} MNT*\n\n"
        "📸 Та дараах дансаар гүйлгээ хийсний дараа шилжүүлэг хийсэн баримтаа *зургаар* оруулна уу.\n\n"
        f"{BANK_DETAILS_MNT}\n\n"
        f"💰 Гүйлгээний дүн: *{int(amount_mnt):,} МНТ*\n"
        f"🧾 Гүйлгээний утга: `{invoice}`",
        parse_mode="Markdown"
    )

@bot.message_handler(func=lambda message: get_state(message.chat.id) == "phone_topup_custom_telecom")
def receive_custom_telecom(message):
    user_id = message.chat.id
    if not ensure_exchange_available(user_id):
        return
    
    custom_telecom = message.text.strip()
    
    # Validate input (not empty and reasonable length)
    if not custom_telecom or len(custom_telecom) > 50:
        bot.send_message(
            user_id,
            "❌ Операторын нэр хоосон эсвэл хэт урт байна. Дахин оруулна уу.\n\n"
            "Жишээ нь: `Tinkoff Mobile` эсвэл `Ростелеком`",
            parse_mode="Markdown"
        )
        return
    
    session = get_user_session(user_id)
    if not session:
        bot.send_message(user_id, "⚠️ Гүйлгээний мэдээлэл олдсонгүй. Та эхнээс эхлэнэ үү.")
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
        f"📱 *Утасны дугаар цэнэглэлт*\n\n"
        f"💰 Цэнэглэх дүн: *{amount_rub:,} РУБ*\n"
        f"📱 Утасны дугаар: `{phone_number}`\n"
        f"📡 Оператор: *{custom_telecom}*\n\n"
        f"💱 Төлөх дүн: *{int(amount_mnt):,} MNT*\n\n"
        "📸 Та дараах дансаар гүйлгээ хийсний дараа шилжүүлэг хийсэн баримтаа *зургаар* оруулна уу.\n\n"
        f"{BANK_DETAILS_MNT}\n\n"
        f"💰 Гүйлгээний дүн: *{int(amount_mnt):,} МНТ*\n"
        f"🧾 Гүйлгээний утга: `{invoice}`",
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
    
    caption = (
        f"🔔 УТАСНЫ ДУГААР ЦЭНЭГЛЭХ ХҮСЭЛТ 🔔\n\n"
        f"📌 Хүсэлтийн дугаар: `{invoice}`\n"
        f"👤 Үйлчлүүлэгч: {user_line}\n"
        f"💰 Цэнэглэх дүн: *{amount_rub:,} РУБ*\n"
        f"💱 Төлсөн дүн: *{int(amount_mnt):,} MNT*\n"
        f"📱 Утасны дугаар: `{phone_number}`\n"
        f"📡 Оператор: *{telecom}*\n\n"
        "✅ Гүйлгээг баталгаажуулах эсвэл татгалзах товчийг дарна уу."
    )
    
    markup = InlineKeyboardMarkup()
    markup.add(
        InlineKeyboardButton("✅ Баталгаажуулах", callback_data=f"confirm_{user_id}"),
        InlineKeyboardButton("❌ Татгалзах", callback_data=f"reject_{user_id}")
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
    DATETODAY = date.today().isoformat()
    markup = InlineKeyboardMarkup()
    markup.add(
        InlineKeyboardButton("Ханш тооцоолуур", callback_data="open_calculator"),
        InlineKeyboardButton("🔙 Буцах", callback_data="back_main")
    )
    bot.send_message(
        call.message.chat.id,
        f"💱 *Өнөөдрийн ханш* ({DATETODAY}):\n\n"
        f"🔸 АВАХ ХАНШ = `{exchange_rates['BUY_RATE']}` MNT\n"
        f"🔹 ЗАРАХ ХАНШ = `{exchange_rates['SELL_RATE']}` MNT",
        reply_markup=markup,
        parse_mode="Markdown"
    )

@bot.callback_query_handler(func=lambda call: call.data == "open_calculator")
def start_calculator(call):
    update_user_session(call.from_user.id, {"state": "calc_direction"})
    markup = InlineKeyboardMarkup()
    markup.add(
        InlineKeyboardButton("🇷🇺 RUB ➝ MNT", callback_data="calc_rub_mnt"),
        InlineKeyboardButton("🇲🇳 MNT ➝ RUB", callback_data="calc_mnt_rub"),
        InlineKeyboardButton("🔙 Буцах", callback_data="back_main")
    )
    bot.send_message(call.message.chat.id, "🖩 Аль чиглэлээр ханш тооцоолох вэ?", reply_markup=markup)

@bot.callback_query_handler(func=lambda call: call.data.startswith("calc_"))
def ask_amount(call):
    direction = call.data
    user_id = call.from_user.id

    if direction == "calc_rub_mnt":
        update_user_session(user_id, {"state": "calc_rub_mnt_amount"})
        bot.send_message(user_id, "💵 Тооцоолох *RUB* мөнгөн дүнгээ оруулна уу?", parse_mode="Markdown")
    elif direction == "calc_mnt_rub":
        update_user_session(user_id, {"state": "calc_mnt_rub_amount"})
        bot.send_message(user_id, "💵 Тооцоолох *MNT* мөнгөн дүнгээ оруулна уу?", parse_mode="Markdown")

@bot.message_handler(func=lambda m: get_state(m.chat.id) in ["calc_rub_mnt_amount", "calc_mnt_rub_amount"])
def perform_calculation(message):
    fetch_exchange_rates()
    user_id = message.chat.id
    session = get_user_session(user_id)
    state = session["state"] if session else None
    raw     = message.text.replace(",", "").strip()
    try:
        amount = float(raw)
    except ValueError:
        bot.send_message(
            user_id,
            "❌ Зөвхөн тоон утга оруулна уу (жишээ: 50 000 эсвэл 50,000).",
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
            f"📌 {amount} RUB ≈ `{converted} MNT`\n💱 Ханш: {rate}",
            parse_mode="Markdown"
        )

    else:  # calc_mnt_rub_amount
        rate      = exchange_rates["SELL_RATE"]
        converted = round(amount / rate, 2)
        bot.send_message(
            user_id,
            f"📌 {amount} MNT ≈ `{converted} RUB`\n💱 Ханш: {rate}",
            parse_mode="Markdown"
        )

    # 3) Only now clear the state so they don’t get stuck
    clear_state(user_id)


# --------------------------------HEREGLEGCHIIN TOHIRGOO-----------------------
@bot.callback_query_handler(func=lambda call: call.data == "user_profile")
def profile_menu(call):
    user_id = call.message.chat.id
    response = supabase.table("users").select("*").eq("id", user_id).execute()

    if not response.data:
        bot.send_message(user_id, "❗ Та эхлээд /register команд ашиглан бүртгүүлнэ үү.")
        return

    user = response.data[0]
    is_verified = user.get("verified", False)

    # Fetch user's active promo codes
    promo_codes_response = supabase.table("promo_codes").select("code, discount, created_at").eq("user_id", user_id).eq("active", True).execute()
    promo_codes = promo_codes_response.data if promo_codes_response.data else []
    
    # 📋 User Summary Text
    text = (
        f"👤 Таны мэдээлэл:\n\n"
        f"👤 Овог: {user.get('last_name', '-')}\n"
        f"👤 Нэр: {user.get('first_name', '-')}\n"
        f"� Имэйл: {user.get('email', '-')}\n"
        f"📞 Монгол утас: {user.get('phone_mnt', '-')}\n"
        f"📞 Орос утас: {user.get('phone', '-')}\n"
        f"🪪 Паспортын дугаар: {user.get('registration_number', '-')}\n"
        f"🏦 Монгол банк: {user.get('bank_mnt', '-')}\n"
        f"🇷🇺 Орос банк: {user.get('bank_rub', '-')}\n"
        f"📷 Паспорт зураг: {'🟢 Байгаа' if user.get('passport_file_id') else '🔴 Байхгүй'}\n"
        f"\n📤 Баталгаажуулах хүсэлт: {'Илгээсэн' if user.get('ready_for_verification') else 'Илгээгүй'}\n"
        f"📎 Баталгаажсан: {'✅ Тийм' if is_verified else '❌ Үгүй'}"
    )
    
    # Add promo codes section (collect buttons so user can copy codes easily)
    promo_buttons = []
    if promo_codes:
        text += f"\n\n🎟️ Таны промокодууд:\n"
        for promo in promo_codes:
            discount = promo.get('discount', 0)
            created_at = promo.get('created_at', '')
            if created_at:
                try:
                    # Format date for display
                    promo_date = datetime.fromisoformat(created_at.replace('Z', '+00:00')).strftime('%Y-%m-%d')
                except:
                    promo_date = created_at[:10] if len(created_at) >= 10 else created_at
            else:
                promo_date = 'N/A'
            code_escaped = sanitize_markdown(promo.get('code', ''))
            text += f"  • `{code_escaped}` - {discount} MNT хөнгөлөлт (үүссэн огноо: {promo_date})\n"
            # prepare a copy button for this promo code (callback includes code)
            promo_buttons.append(InlineKeyboardButton(f"📋 Хуулах {promo.get('code')}", callback_data=f"copy_promo_{promo.get('code')}") )
    else:
        text += f"\n\n🎟️ Промокод: Байхгүй"
    
    # Add referral status section
    referral_status = get_user_referral_status(user_id)
    accepted_count = referral_status["accepted"]
    pending_count = referral_status["pending"]
    total_count = referral_status["total"]
    
    if total_count == 0:
        referral_status_text = "Найз уриагүй"
    elif pending_count > 0:
        referral_status_text = f"Хүлээгдэж буй ({pending_count} найз)"
    elif accepted_count >= REFERRAL_REQUIRED_COUNT:
        referral_status_text = f"✅ Амжилттай ({accepted_count}/{REFERRAL_REQUIRED_COUNT})"
    else:
        referral_status_text = f"Хүлээгдэж буй ({accepted_count}/{REFERRAL_REQUIRED_COUNT})"
    
    text += f"\n\n👥 Найз урих статус: {referral_status_text}"

    # 📌 Markup (Edit / Continue Registration)
    markup = InlineKeyboardMarkup()

    # Disable editing of reg/passport if verified (optional)
    markup.add(
        InlineKeyboardButton("👤 Овог өөрчлөх", callback_data="edit_last_name"),
        InlineKeyboardButton("👤 Нэр өөрчлөх", callback_data="edit_first_name"),
        InlineKeyboardButton("📞 Утас өөрчлөх", callback_data="edit_phone")
    )

    if not is_verified:
        markup.add(
            InlineKeyboardButton("🪪 Паспортын дугаар", callback_data="edit_registration_number"),
            InlineKeyboardButton("📷 Паспорт зураг", callback_data="upload_passport")
        )

    markup.add(
        InlineKeyboardButton("🇲🇳 Монгол банк", callback_data="edit_bank_mnt"),
        InlineKeyboardButton("🇷🇺 Орос банк", callback_data="edit_bank_rub"),
        InlineKeyboardButton("📤 Баталгаажуулах хүсэлт илгээх", callback_data="submit_verification"),
        InlineKeyboardButton("📜 Гүйлгээний түүх", callback_data="txn_history_1"),
        InlineKeyboardButton("🔙 Буцах", callback_data="back_main")
    )

    # add promo copy buttons if any (each on its own row)
    for b in promo_buttons:
        markup.add(b)

    bot.send_message(user_id, text, reply_markup=markup, parse_mode="Markdown")

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
    status_icon = {"pending": "🕒", "successful": "✅", "rejected": "❌"}
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

        caption = (
            f"🆕 Шинэ баталгаажуулах хүсэлт ирлээ!\n\n"
            f"👤 Хэрэглэгч: [{user_id}](tg://user?id={user_id})\n"
            f"👤 Нэр: {user.get('last_name')} {user.get('first_name')}\n"
            f"📞 Утас: {user.get('phone')}\n"
            f"🪪 Паспортын дугаар: {user.get('registration_number')}\n"
            f"🏦 Монгол банк: {user.get('bank_mnt')}\n"
            f"🇷🇺 Орос банк: {user.get('bank_rub')}"
        )

        markup = InlineKeyboardMarkup()
        markup.add(
            InlineKeyboardButton("✅ Баталгаажуулах", callback_data=f"verify_{user_id}"),
            InlineKeyboardButton("❌ Цуцлах", callback_data=f"rejectuser_{user_id}")
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
                        caption + "\n⚠️ Паспорт зураг оруулаагүй байна!",
                        parse_mode="Markdown",
                        reply_markup=markup
                    )
            except Exception as e:
                print(f"❌ Failed to notify operator {op_id}: {e}")
        if passport_file_id:
            bot.send_photo(operator_id, passport_file_id, caption=caption, parse_mode="Markdown", reply_markup=markup)
        else:
            bot.send_message(operator_id, caption + "\n⚠️ Паспорт зураг оруулаагүй байна!", parse_mode="Markdown", reply_markup=markup)

    except Exception as e:
        print(f"❌ Failed to send verification alert: {e}")


@bot.callback_query_handler(func=lambda call: call.data == "start_registration")
def start_registration_from_menu(call):
    call.message.text = "/register"  # fake the message to reuse the handler
    register(call.message)

@bot.callback_query_handler(func=lambda call: call.data == "submit_verification")
def submit_verification(call):
    user_id = call.message.chat.id

    # ✅ Fetch user info
    response = supabase.table("users").select("*").eq("id", user_id).execute()
    user = response.data[0] if response.data else None

    if not user:
        bot.send_message(user_id, "❌ Таны бүртгэлийн мэдээлэл олдсонгүй. Та эхлээд бүртгүүлнэ үү.")
        return

    required_fields = [
        'first_name', 'last_name', 'phone',
        'bank_mnt', 'passport_file_id',
        'registration_number'
    ]

    missing = [f for f in required_fields if not str(user.get(f)).strip()]
    if missing:
        bot.send_message(user_id, (
            "⚠️ Та мэдээллээ бүрэн оруулаагүй байна.\n\n"
            "Дараах мэдээлэл дутуу байж болзошгүй:\n" +
            "\n".join([f"• {field}" for field in missing]) +
            "\n\n📌 'Хэрэглэгчийн тохиргоо' хэсгээс мэдээллээ бүрэн бөглөнө үү."
        ))
        return

    # ✅ Update status in DB
    supabase.table("users").update({
        "ready_for_verification": True
    }).eq("id", user_id).execute()

    bot.send_message(user_id, "✅ Таны мэдээлэл амжилттай илгээгдлээ. Админ баталгаажуулахыг хүлээнэ үү.")

    # 🔔 Alert the operator (or schedule it)
    send_verification_alert_to_operator(user_id, user)


@bot.callback_query_handler(func=lambda call: call.data.startswith("edit_"))
def edit_profile_field(call):
    user_id = call.message.chat.id
    field = call.data.replace("edit_", "")

    # 🛡️ Check if verified
    response = supabase.table("users").select("verified").eq("id", user_id).execute()
    user = response.data[0] if response.data else {}

    is_verified = user.get("verified", False)

    # 👮‍♂️ Lock certain fields if verified
    if is_verified and field in ["passport", "registration_number"]:
        bot.send_message(user_id, f"⚠️ Энэ мэдээллийг баталгаажсан хэрэглэгч дахин өөрчлөх боломжгүй.\n✉️ Өөрчлөхийг хүсвэл админтай холбогдоно уу: {CONTACT_SUPPORT}")
        return

    update_user_session(user_id, {"state": f"editing_{field}"})

    field_names = {
        "first_name": "📝 Та өөрийн нэрээ оруулна уу:",
        "last_name": "📝 Та өөрийн овгоо оруулна уу:",
        "phone": "📞 Утасны дугаараа оруулна уу:",
        "registration_number": "🪪 Та өөрийн паспортын дугаарыг оруулна уу (жишээ нь: E1234560):",
        "bank_mnt": "🏦 Монгол дахь банкны мэдээлэл (Банк, Дансны IBAN дугаар, Данс зэмшэгчийн нэр):",
        "bank_rub": "🏦 ОХУ дахь банкны мэдээлэл (Банк, Утасны дугаар, Картын дугаар, Карт эзэмшэгчийн нэр):"
    }

    bot.send_message(user_id, field_names.get(field, "📝 Мэдээлэл оруулна уу:"))
@bot.message_handler(func=lambda m: isinstance(get_state(m.chat.id), str) and get_state(m.chat.id).startswith("editing_"))

def save_profile_update(message):
    user_id = message.chat.id
    session = get_user_session(user_id)
    state = session.get("state", "")
    field = state.replace("editing_", "")
    value = message.text.strip()

    # Format validation for banking info
    if field == "bank_mnt":
        parts = [x.strip() for x in value.split(",")]
        if len(parts) != 3:
            bot.send_message(user_id,
                "❌ Та дараах форматаар монгол дансны мэдээллээ оруулна уу:\n"
                "`Банк, Дансны IBAN дугаар, Данс зэмшэгчийн нэр`", parse_mode="Markdown")
            return

    elif field == "registration_number":
      if not re.match(r'^[A-Za-z0-9]+$', text):
        bot.send_message(user_id, "❌ Паспортын дугаар буруу байна. Жишээ: `E2853960`", parse_mode="Markdown")
        return

    elif field == "bank_rub":
        parts = [x.strip() for x in value.split(",")]
        if len(parts) != 4:
            bot.send_message(user_id,
                "❌ Та дараах форматаар орос дансны мэдээллээ оруулна уу:\n"
                "`Банк, Утасны дугаар, Картын дугаар, Карт эзэмшэгчийн нэр`", parse_mode="Markdown")
            return

    try:
        # Update Supabase
        supabase.table("users").upsert({
            "id": user_id,
            field: value,
            "updated_at": datetime.now().isoformat()
        }).execute()

        bot.send_message(user_id, f"✅ Таны *{field.replace('_', ' ')}* шинэчлэгдлээ.", parse_mode="Markdown")
    except Exception as e:
        print(f"❌ Supabase error: {e}")
        bot.send_message(user_id, "❌ Error updating your profile. Please try again later.")

    clear_state(user_id)

@bot.message_handler(func=lambda m: get_state(m.chat.id) == "awaiting_bank")
def get_bank(message):
    user_profiles[message.chat.id]["bank"] = message.text
    update_user_session(message.chat.id, {"state": "waiting_for_bank"})
    bot.send_message(message.chat.id, "🪪 Паспортын зургаа илгээнэ үү:")


# ℹ️ How to Use Button Handler
@bot.callback_query_handler(func=lambda call: call.data == "how_to_use")
def how_to_use(call):
    markup = InlineKeyboardMarkup()
    markup.add(InlineKeyboardButton("🔙 Буцах", callback_data="back_main"))

    bot.send_message(
        call.message.chat.id, "Та энэхүү ботын тусламжтай ханшийн өдөр тутмын мэдээлэл авах, рубль болон төгрөгийн ханш хөрвүүлэн солиулах боломжтой\n\n"
                              "📖 Бот ашиглах заавар:\n\n"
                              "1️⃣ Хэрэглэгчийн бүртгэл үүсгэх. Та */register* команд ашиглан хэрэглэгчийн бүртгэл үүсгэх боломжтой.\n\n"
                              "2️⃣ Хэрэглэгчийн бүртгэл баталгаажуулах. Та хэрэглэгчийн бүртгэл үүсгэх явцад бүртгэлээ баталгаажуулах товч дарах эсвэл хэрэглэгчийн тохиргоо цэст буй бүртгэл баталгаажуулах товч дарснаар бүртгэлээ баталгаажуулах хүсэлт илгээх боломжтой.\n\n"
                              "3️⃣ Админ таны мэдээллийг тодорхой хугацааны дараа бүрэн зөв эсэхийг шалгаад баталгаажуулна. Админ баталгаажуулсан тохиолдолд танд мэдэгдэл ирнэ.\n\n"
                              "4️⃣ Ийнхүү та хэрэглэгчийн бүртгэлээ баталгаажуулсан бол ханш солих боломжтой болно. Ингэхдээ */start* команд ашиглан 💱 *Валют солих* товч дээр дарна.\n\n"
                              "5️⃣ Ханш солих чиглэлээ сонгоно.\n\n"
                              "6️⃣ Та ямар дүнгээр солиулахаа сонгох эсвэл өөрийн хүссэн дүнгээ оруулна.\n\n"
                              "7️⃣ Солих дүнгээ оруулсаны дараа ханш хөрвүүлсэн байдлаар харагдах бөгөөд танд илгээсэн дансны мэдээллийн дагуу гүйлгээ хийнэ. Гүйлгээ хийсний дараа гүйлгээний баримтыг зурган хэлбэрээр бот руу илгээнэ.\n\n"
                              "8️⃣ Oyuns Finance бот зураг хүлээж авсаны дараа та өөрийн дансны мэдээллийг бот руу илгээснээр админ таны гүйлгээний хүсэлтийг баталгаажуулах боломжтой болно.\n\n"
                              "9️⃣ Админ таны хүсэлтийг хүлээн авч хэсэг хугацааны дараа таны гүйлгээг баталгаажуулна. Баталгаажсанаас хэсэг хугацааны дараа админ таны хүсэлтийн дагуу гүйлгээ хйиж гүйлгээний баримтыг танд ботоор дамжуулан илгээх болно\n\n"
                              "*Баяр хүргэе!* Та ийнхүү амжилттай ханшаа солиуллаа!\n\n\n"
                              "📞 *Холбоо барих:*\n"
                              "+976 7780 6060\n"
                              "+7 (977) 801-91-43\n"
                              "[Telegram: @oyuns_finance](https://t.me/oyuns_finance)",
                              parse_mode="Markdown",
                              reply_markup=markup
    )


@bot.callback_query_handler(func=lambda call: call.data == "exchange_menu")
def exchange_menu(call):
    user_id = call.message.chat.id
    update_user_session(user_id, {"state": ""})
    # Check if user exists and verified
    response = supabase.table("users").select("verified").eq("id", user_id).execute()
    user = response.data[0] if response.data else None

    if not user or not user.get("verified"):
        bot.send_message(user_id, "⚠️ Та бүртгэлээ баталгаажуулсны дараа валют солих боломжтой.\n📌 Та эхлээд /start товч даран бүртгүүлэх функц сонгох эсвэл /register команд ашиглан бүртгүүлнэ үү.")
        return
    
    config = get_current_shift_config()

    markup = InlineKeyboardMarkup()
    markup.row_width = 2
    markup.add(
        InlineKeyboardButton("🇲🇳 МНТ → РУБ", callback_data="SELL_RATE"),
        InlineKeyboardButton("🇷🇺 РУБ → МНТ", callback_data="BUY_RATE"),
        InlineKeyboardButton("🔙 Буцах", callback_data="back_main")
    )
    bot.send_message(call.message.chat.id, "💱 Та валют солих чиглэлээ сонгоно уу:", reply_markup=markup)




def show_common_rub_amounts(user_id):
    try:
        markup = InlineKeyboardMarkup()
        markup.add(
            InlineKeyboardButton("1,000 РУБ", callback_data="amount_rub_1000"),
            InlineKeyboardButton("5,000 РУБ", callback_data="amount_rub_5000"),
            InlineKeyboardButton("10,000 РУБ", callback_data="amount_rub_10000"),
            InlineKeyboardButton("20,000 РУБ", callback_data="amount_rub_20000"),
            InlineKeyboardButton("30,000 РУБ", callback_data="amount_rub_30000"),
            InlineKeyboardButton("✏️ Хүссэн дүнгээ бичих", callback_data="custom_rub"),
            InlineKeyboardButton("🔙 Буцах", callback_data="exchange_menu")
        )
        bot.send_message(user_id, "💰 Та хэдэн РУБ солиулах вэ:", reply_markup=markup)
    except Exception as e:
        print(f"❌ Error in show_common_rub_amounts: {e}")
        import traceback
        traceback.print_exc()
        bot.send_message(user_id, "❌ Алдаа гарлаа. Дахин оролдоно уу.")


def show_common_mnt_amounts(user_id):
    markup = InlineKeyboardMarkup()
    markup.add(
        InlineKeyboardButton("250,000 MNT", callback_data="amount_mnt_250000"),
        InlineKeyboardButton("500,000 MNT", callback_data="amount_mnt_500000"),
        InlineKeyboardButton("1,000,000 MNT", callback_data="amount_mnt_1000000"),
        InlineKeyboardButton("3,000,000 MNT", callback_data="amount_mnt_3000000"),
        InlineKeyboardButton("5,000,000 MNT", callback_data="amount_mnt_5000000"),
        InlineKeyboardButton("✏️ Хүссэн дүнгээ бичих", callback_data="custom_mnt"),
        InlineKeyboardButton("🔙 Буцах", callback_data="exchange_menu")
    )
    bot.send_message(user_id, "💰 Та хэдэн МНТ солиулах вэ:", reply_markup=markup)



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
            "⚠️ Бид Москвагийн цагаар 04:00-23:00 хооронд, Улаанбаатарын цагаар 09:00–04:00(дараа өдрийн) цагийн хооронд ажиллаж байна.",
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
            "⚠️ Бид Москвагийн цагаар 04:00-23:00 хооронд, Улаанбаатарын цагаар 09:00–04:00(дараа өдрийн) цагийн хооронд ажиллаж байна.",
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
        bot.send_message(call.message.chat.id, "🎟️ Та промокодоо оруулна уу:")
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
        bot.send_message(user_id, "❌ Буруу промокод байна. Дахин оролдоно уу.")
        return

    # Save discount and promo code in session
    update_user_session(user_id, {
        "promo_discount": discount,
        "promo_code": promo_code
    })


    clear_state(user_id)
    bot.send_message(user_id, f"✅ Промокод амжилттай! Хөнгөлөлт: {discount} MNT")

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
    chat_id = call.message.chat.id
    user_id = call.from_user.id

    try:
        user_resp = supabase.table("users").select("pending_gifts").eq("id", user_id).limit(1).execute()
        user_row = user_resp.data[0] if user_resp.data else None
        pending_gifts = int(user_row.get("pending_gifts") or 0) if user_row else 0

        if pending_gifts <= 0:
            bot.answer_callback_query(call.id, "🎁 Нээх бэлэг байхгүй байна. Та ₽10'000-ээс дээш мөнгөн дүн солиулаад бэлэг нээх эрх аваарай.", show_alert=True)
            bot.send_message(chat_id, "🎄 Та ₽10'000-ээс дээш мөнгөн дүн солиулаад бэлэг нээх эрх аваарай. Ирж буй 2026 онд тань аз жаргал хүсье. ✨")
            return

        outcome = choose_gift_outcome()

        if outcome == "spin_again":
            bot.answer_callback_query(call.id)
            bot.send_message(chat_id, "🎄 Ойрхон байлаа! Танд дахин эргүүлэх эрх олгож байна. 🎲")
            return

        if outcome == "cash_prize_1000":
            prize_amount = 1000
            new_pending = max(pending_gifts - 1, 0)
            supabase.table("users").upsert({"id": user_id, "pending_gifts": new_pending}).execute()
            bot.answer_callback_query(call.id)
            bot.send_message(chat_id, f"🎉 ТАНД БАЯР ХҮРГЭЕ 🎉\n\n 💸 Та {prize_amount} ₽ мөнгөн шагнал хожлоо. Тантай удахгүй мөнгөн шагналыг баталгаажуулж холбогдох болно. 🥳")

            # Notify admins with user contact info
            try:
                info_resp = supabase.table("users").select("first_name, last_name, phone").eq("id", user_id).limit(1).execute()
                info = info_resp.data[0] if info_resp.data else {}
                first_name = info.get("first_name", "") or "-"
                last_name = info.get("last_name", "") or "-"
                phone = info.get("phone", "") or "-"

                admin_message = (
                    "🎉 ШИНЭ ЖИЛИЙН МӨНГӨН ШАГНАЛ!\n\n"
                    f"👤 ID: {user_id}\n"
                    f"👥 Нэр: {first_name} {last_name}\n"
                    f"📞 Утас: {phone}\n"
                    f"💵 Мөнгөн дүн: {prize_amount} ₽\n\n"
                    "Мөнгөн шагналыг баталгаажуулан олгоно уу."
                )

                for admin_id in [1920453419, 1932946217]:
                    try:
                        bot.send_message(admin_id, admin_message)
                    except Exception as inner_e:
                        print(f"❌ Failed to notify admin {admin_id}: {inner_e}")
            except Exception as e:
                print(f"❌ Error sending cash prize admin notification: {e}")
            return

        promo_map = {
            "promo_0_5": (0.5, "🥇 Алтан"),
            "promo_0_3": (0.3, "🥈 Мөнгөн"),
            "promo_0_2": (0.2, "🥉 Хүрэл"),
        }

        if outcome in promo_map:
            discount, promo_tier = promo_map[outcome]
            promo_code = generate_promo_code()
            created = create_promo_code_in_db(promo_code, user_id=user_id, discount=discount, source="new_year_gift")
            if not created:
                bot.answer_callback_query(call.id, "⚠️ Алдаа гарлаа. Дахин оролдоод үзээрэй.", show_alert=True)
                bot.send_message(chat_id, "😔 Уучлаарай, таны бэлгийг хүргэхэд явцад алдаа гарлаа. Та дахин оролдоно уу, бид таны бэлгийг бэлдэж байна. 🎁")
                return

            new_pending = max(pending_gifts - 1, 0)
            supabase.table("users").upsert({"id": user_id, "pending_gifts": new_pending}).execute()
            caption = (
                f"🎉 ТАНД БАЯР ХҮРГЭЕ 🎉\n"
                f"ТА {promo_tier} ПРОМОКОДЫН БЭЛЭГ ХОЖЛОО.\n"
                f"🎟️ Промокод: `{sanitize_markdown(promo_code)}` /промокодыг урамшуулалт хөтөлбөр дуусахаас өмнө ашиглаарай/\n"
                f"💰 Хөнгөлөлт: {discount} MNT\n"
                "🎄Улиран өнгөрч буй 2025 онд биднийг сонгон үйлчлүүлсэн хэрэглэгч танд чин сэтгэлийн талархал илэрхийлье. Шинэ оны баярын мэнд хүргэе!\n"
            )
            bot.answer_callback_query(call.id)
            bot.send_animation(chat_id, FESTIVE_GIF_URL, caption=caption, parse_mode="Markdown")
            return

        if outcome == "no_prize":
            new_pending = max(pending_gifts - 1, 0)
            supabase.table("users").upsert({"id": user_id, "pending_gifts": new_pending}).execute()
            bot.answer_callback_query(call.id)
            bot.send_message(
                chat_id,
                "✨ШИНЭ ЖИЛИЙН МЭНДЧИЛГЭЭ🎄\n\n"
                "Улиран өнгөрч буй 2025 онд биднийг сонгон үйлчлүүлсэн хэрэглэгч танд чин сэтгэлийн талархал илэрхийлье.\nУгтан авч буй шинэ он танд урам зориг, амжилт бүтээл, аз жаргалын дээдийг бэлэглэг.\n\nШинэ оны мэнд хүргэе!\n\n"
                "🎁 Та OYUNS FINANCE BOT-оор 10,000 руб-ээс дээш мөнгөө солиулаад дахин бэлэг хожоорой."
            )
            return

    except Exception as e:
        print(f"❌ Error in open_gift handler: {e}")
        bot.answer_callback_query(call.id)
        bot.send_message(chat_id, "⚠️ Алдаа гарлаа. Дахин оролдоод үзээрэй! 🎄")


@bot.callback_query_handler(func=lambda call: call.data.startswith("confirm_referral:"))
def confirm_referral_callback(call):
    # Only the moderator should confirm
    try:
        if call.from_user.id != MODERATOR_ID:
            bot.answer_callback_query(call.id, "❌ Та энэ үйлдлийг хийх эрхгүй.", show_alert=True)
            return

        parts = call.data.split(":")
        if len(parts) < 2:
            bot.answer_callback_query(call.id, "❌ Буруу callback data.", show_alert=True)
            return

        user_id = int(parts[1])
        pending = pending_referral_confirmations.get(call.message.message_id)
        if not pending or pending.get("user_id") != user_id:
            bot.answer_callback_query(call.id, "❌ Энэ хүсэлтийг олж чадсангүй буюу нь өөр хэрэглэгчийнх байна.", show_alert=True)
            return

        # Ensure this message is mapped to a pending request
        pending = pending_referral_confirmations.get(call.message.message_id)
        if not pending or pending.get("user_id") != user_id:
            bot.answer_callback_query(call.id, "❌ Энэ хүсэлтийг олж чадсангүй буюу нь өөр хэрэглэгчийнх байна.", show_alert=True)
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

        bot.answer_callback_query(call.id, "✅ Баталгаажуулсан. Промокодууд олгогдлоо.")
    except Exception as e:
        print(f"❌ confirm_referral error: {e}")
        bot.answer_callback_query(call.id, "❌ Баталгаажуулах үед алдаа гарлаа.", show_alert=True)


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
        if call.from_user.id != MODERATOR_ID:
            bot.answer_callback_query(call.id, "❌ Та энэ үйлдлийг хийх эрхгүй.", show_alert=True)
            return

        parts = call.data.split(":")
        if len(parts) < 2:
            bot.answer_callback_query(call.id, "❌ Буруу callback data.", show_alert=True)
            return

        user_id = int(parts[1])
        # Notify user about rejection
        try:
            bot.send_message(user_id, "❌ Таны уриалгыг баталгаажуулахаар админ татгалзлаа. Дахин оролдоно уу.")
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

        bot.answer_callback_query(call.id, "❌ Урилга татгалзсан.")
    except Exception as e:
        print(f"❌ reject_referral error: {e}")
        bot.answer_callback_query(call.id, "❌ Татгалзах үед алдаа гарлаа.", show_alert=True)


# 💰 Handle Common Amount Selection
@bot.callback_query_handler(func=lambda call: call.data.startswith("amount_"))
def selected_common_amount(call):
    user_id = call.message.chat.id
    if not ensure_exchange_available(user_id):
        bot.answer_callback_query(call.id)
        return
    currency, amount = call.data.split("_")[1], int(call.data.split("_")[2])
    invoice = generate_invoice()
    # Get base rate and promo discount
    base_rate = exchange_rates["BUY_RATE"] if currency == "rub" else exchange_rates["SELL_RATE"]
    session = get_user_session(user_id)
    promo     = session.get("promo_discount", 0.0)

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

    # enforce 1 000 RUB-min on MNT→RUB
    if currency == "mnt":
        # final_rate is MNT per 1 RUB, so to get MIN_RUB you need MIN_RUB * final_rate MNT
        min_mnt = ceil(MIN_RUB * final_rate)
        if amount < min_mnt:
            return bot.send_message(
                user_id,
                f"❌ Та солих доод хэмжээ буюу {MIN_RUB:,} RUB-тэй тэнцүү ({min_mnt:,} MNT) солих ёстой.\n"
                f"Та дор хаяж *{min_mnt:,} MNT* солиулна уу.",
                parse_mode="Markdown"
            )

    # save to db
    update_user_session(user_id, {
        "amount":        amount,
        "currency_from": currency,
        "currency_to":   "mnt" if currency=="rub" else "rub",
        "invoice":       invoice,
        "rate":          final_rate,
        "state":         "waiting_for_receipt"
    })

    if currency == "rub":
        # Show RUB bank options
        markup = InlineKeyboardMarkup()
        rub_bank_options = get_current_shift_config().get("rub_bank_options", {})
        for bank in rub_bank_options:
            markup.add(InlineKeyboardButton(bank, callback_data=f"rubmnt_bank_{bank}"))

        bot.send_message(
            user_id,
            "💳 Та аль банкаар РУБ-ээ илгээх вэ?\n"
            "⬇️ Дараах боломжит банкнуудаас сонгон гүйлгээ хийх банкны мэдээллээ авна уу:",
            reply_markup=markup
        )
    else:
        # MNT → RUB flow
        exchanged = amount / final_rate
        message_text = f"💱 {amount:,} MNT → {round(exchanged, 2):,} RUB"

        bot.send_message(
            user_id,
            f"*{message_text}*\n\n"
            "📸Та дараах дансаар гүйлгээ хийсний дараа шилжүүлэг хийсэн баримтаа *зургаар* оруулна уу.\n\n"
            f"{BANK_DETAILS_MNT}\n\n"
            f"💰 Гүйлгээний дүн: *{amount:,} МНТ*\n"
            f"🧾 Гүйлгээний утга: `{invoice}`",
            parse_mode="Markdown"
        )



# ✏️ Handle Custom Amount Entry
@bot.callback_query_handler(func=lambda call: call.data.startswith("custom_"))
def custom_amount(call):
    user_id = call.message.chat.id
    if not ensure_exchange_available(user_id):
        bot.answer_callback_query(call.id)
        return
    currency = call.data.split("_")[1]
    update_user_session(call.message.chat.id, {"state": f"custom_amount_{currency}"})

    bot.send_message(call.message.chat.id, "💰 Та солиулах дүнгээ оруулна уу:")

# 🏦 Receive Custom Amount
@bot.message_handler(func=lambda message: isinstance(get_state(message.chat.id), str) and get_state(message.chat.id).startswith("custom_amount_"))
def receive_custom_amount(message):
    user_id = message.chat.id
    if not ensure_exchange_available(user_id):
        bot.answer_callback_query(call.id)
        return    
    session = get_user_session(user_id)
    state = session.get("state", "")
    currency = state.split("_")[2] if state else None
    invoice = generate_invoice()
    raw = re.sub(r"\D", "", message.text)
    if not raw.isdigit():
        bot.send_message(
            user_id,
            "❌ Зөвхөн тоон утга оруулна уу (жишээ: 50000).",
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


        currency_from = currency
        currency_to = "mnt" if currency == "rub" else "rub"

        if currency=="mnt":
            min_mnt = ceil(MIN_RUB * final_rate)
            if amount < min_mnt:
                return bot.send_message(
                    user_id,
                    f"❌ Та солих доод хэмжээ буюу {MIN_RUB:,} RUB-тэй тэнцүү ({min_mnt:,} MNT) солих ёстой.\n"
                    f"Та дор хаяж *{min_mnt:,} MNT* солиулна уу.",
                    parse_mode="Markdown"
                )

        # Save session
        update_user_session(user_id, {
            "state": "waiting_for_receipt",
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

            markup = InlineKeyboardMarkup()
            rub_bank_options = get_current_shift_config().get("rub_bank_options", {})
            for bank_key in rub_bank_options:
                markup.add(InlineKeyboardButton(bank_key, callback_data=f"rubmnt_bank_{bank_key}"))

            bot.send_message(
                user_id,
                f"*{message_text}*\n\n"
                "🏦 Та RUB илгээх банкаа сонгоно уу:",
                parse_mode="Markdown",
                reply_markup=markup
            )
        else:
            exchanged = amount / final_rate
            message_text = f"💱 {amount:,} MNT → {round(exchanged, 2):,} RUB"

            bot.send_message(
                user_id,
                f"*{message_text}*\n\n"
                "📸 Та дараах дансаар гүйлгээ хийсний дараа шилжүүлэг хийсэн баримтаа *зургаар* оруулна уу.\n\n"
                f"{BANK_DETAILS_MNT}\n\n"
                f"💰 Гүйлгээний дүн: *{amount:,} МНТ*\n"
                f"🧾 Гүйлгээний утга: `{invoice}`",
                parse_mode="Markdown"
            )
    except ValueError:
        # This will catch both non-positive numbers (raised above)
        # and any int(…) failures (though digits-only check handles most)
        bot.send_message(user_id, "❌ Зөвхөн тоон утга оруулна уу.")
        update_user_session(user_id, {"state": state})
        return



@bot.callback_query_handler(func=lambda call: call.data.startswith("rubmnt_bank_"))
def handle_rub_mnt_bank_selection(call):
    user_id = call.message.chat.id
    if not ensure_exchange_available(user_id):
        bot.answer_callback_query(call.id)
        return
    selected_bank = call.data.replace("rubmnt_bank_", "")

    # Store selected bank in session
    update_user_session(user_id, {
        "selected_rub_bank": selected_bank,
    })

    rub_bank_options = get_current_shift_config().get("rub_bank_options", {})
    bank_details = rub_bank_options.get(selected_bank, "❌ Банк олдсонгүй.")
    if bank_details.startswith("❌"):
        bot.send_message(user_id, bank_details)
        return

    session = get_user_session(user_id)
    if not session:
        bot.send_message(user_id, "⚠️ Гүйлгээний мэдээлэл олдсонгүй. Та эхнээс эхлэнэ үү.")
        return
    amount = session.get("amount")
    invoice = session.get("invoice")
    final_rate = session.get("rate")

    exchanged = amount * final_rate
    message_text = f"💱 {amount:,} RUB → {int(exchanged):,} MNT"

    bot.send_message(
        user_id,
        f"*{message_text}*\n\n"
        "📸Та дараах дансаар гүйлгээ хийсний дараа шилжүүлэг хийсэн баримтаа *зургаар* оруулна уу.\n\n"
        f"{bank_details}\n\n"
        f"💰 Гүйлгээний дүн: *{amount:,} РУБ*\n"
        f"🧾 Гүйлгээний утга: `{invoice}`",
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
    update_user_session(user_id, {"state": "waiting_for_receipt"})
    if get_state(user_id) == "waiting_for_bank":
        bot.send_message(user_id, "❗ Та одоогоор дансны мэдээлэл оруулах горимд байхгүй байна. Та ижил мөнгөн дүнгээр дахин ханш солиулах хүсэлт үүсгээд гүйлгээ хийсэн баримтаа дахин илгээгээрэй.")
        return

    try:
        response = supabase.table("users").select("bank_mnt, bank_rub").eq("id", user_id).execute()
        user = response.data[0] if response.data else None

        if not user:
            bot.send_message(user_id, "❗ Таны бүртгэл олдсонгүй.")
            return
        session = get_user_session(user_id)
        if not session:
            bot.send_message(user_id, "⚠️ Гүйлгээний мэдээлэл олдсонгүй. Та эхнээс эхлэнэ үү.")
            return



        currency_from = session["currency_from"]

        if currency_from == "rub":
            bank_info = user.get("bank_mnt", "").strip()
            expected_fields = 3
            format_note = "📌 Жишээ: Хаан Банк, MN01 0015 00 500XXXXXXX, Бат"
        else:
            bank_info = user.get("bank_rub", "").strip()
            expected_fields = 4
            format_note = "📌 Жишээ: Сбербанк, +79001234567, 1234567812345678, Бат"

        if not bank_info:
            bot.send_message(user_id, "⚠️ Та энэ төрлийн дансны мэдээллээ хадгалаагүй байна.\n 'Профайл тохиргоо' хэсгээс оруулна уу.")
            return

        parts = [p.strip() for p in bank_info.split(",")]
        if len(parts) != expected_fields or any(not p for p in parts):
            bot.send_message(user_id, f"⚠️ Хадгалсан дансны мэдээлэл алдаатай байна.\n{format_note}")
            return

        # ✅ Show Preview and ask for confirmation
        markup = InlineKeyboardMarkup()
        markup.add(
            InlineKeyboardButton("✅ Баталгаажуулах", callback_data=f"confirm_saved_bank"),
            InlineKeyboardButton("❌ Цуцлах", callback_data="cancel_saved_bank")
        )

        bot.send_message(user_id,
                         f"📎 Та дараах хадгалсан дансны мэдээллийг ашиглах гэж байна:\n\n`{bank_info}`\n\n"
                         "Та зөв эсэхийг шалгаад үргэлжлүүлэх эсэхээ сонгоно уу.",
                         reply_markup=markup,
                         parse_mode="Markdown")
        update_user_session(user_id, {"state": "previewing_saved_bank"})
        user_profiles[user_id] = {"preview_bank_info": bank_info}

    except Exception as e:
        print(f"❌ Error using saved bank: {e}")
        bot.send_message(user_id, "❌ Дансны мэдээллийг татах үед алдаа гарлаа.")


@bot.callback_query_handler(func=lambda call: call.data in ["confirm_saved_bank", "cancel_saved_bank"])
def handle_preview_decision(call):
    user_id = call.message.chat.id
    if not ensure_exchange_available(user_id):
        bot.answer_callback_query(call.id)
        return
    if call.data == "cancel_saved_bank":
        update_user_session(user_id, {"state": "waiting_for_bank"})

        bot.send_message(user_id, "❌ Хадгалсан дансны мэдээллийг ашиглах үйлдэл цуцлагдлаа.")
        return

    # If confirmed
    bank_info = user_profiles.get(user_id, {}).get("preview_bank_info")
    if not bank_info:
        bot.send_message(user_id, "❗ Мэдээлэл олдсонгүй. Та ижил мөнгөн дүнгээр дахин валют солих хүсэлт үүсгээд гүйлгээ хийсэн баримтаа дахин илгээгээрэй.")
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
        bot.answer_callback_query(call.id)
        return
    bank_details = message.text.strip()

    # ✅ Step 1: Check if session exists
    session = get_user_session(user_id)
    if not session:
        bot.send_message(user_id, "⚠️ Гүйлгээний мэдээлэл олдсонгүй. Та эхнээс эхлэнэ үү.")
        return

    invoice = session.get("invoice")
    if not invoice:
        bot.send_message(user_id, "❗ Хүсэлтийн дугаар алга байна. Шинээр эхэлнэ үү.")
        return

    # ✅ Step 2: Validate bank format (must be 4 parts)
    currency_to = session.get("currency_to")
    expected_fields = 3 if currency_to == "mnt" else 4

    parts = [p.strip() for p in bank_details.split(",")]
    if len(parts) != expected_fields or any(not p for p in parts):
        bot.send_message(
            user_id,
            f"⚠️ Та банкны мэдээллээ зөв оруулна уу! Таслал тэмдэгээр тусгаарлаж оруулах ёстойг анхаарна уу.\n\n"
            f"📌 Жишээ нь:\n"
            + ("`Хаан Банк, MN01 0015 00 500XXXXXXX, Бат`\n\n" if expected_fields == 3 else
               "`Сбербанк, 79001234567, 5469123412341234, Бат`\n\n")
            + "Банкны нэр, Утасны дугаар, Карт/IBAN дугаар, Данс эзэмшэгчийн нэр - гэсэн дарааллаар таслалаар тусгаарлан бичнэ үү.",
            parse_mode="Markdown"
        )
        return

    # ✅ Step 3: Ensure receipt has been received (i.e. pending_transactions initialized)
    if user_id not in pending_transactions or not pending_transactions[user_id].get("receipt_id"):
        bot.send_message(user_id, "📸 Та эхлээд шилжүүлгийн баримтаа зургаар илгээнэ үү.")
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
            bot.send_message(user_id, "✅ Банкны мэдээлэл хүлээн авлаа!\n⏱️ Таны хүсэлт их хэмжээний гүйлгээ тул ердийн гүйлгээнээс бага зэрэг удах болохыг анхаарна уу. Админ таны гүйлгээг баталгаажуулах хүртэл та хүлээнэ үү.")
        else:
            bot.send_message(user_id, "✅ Банкны мэдээлэл хүлээн авлаа!\nАдмин таны гүйлгээг баталгаажуулах хүртэл та хүлээнэ үү.")
    except Exception as e:
        print(f"❌ Operator notify error: {e}")
        bot.send_message(user_id, "❗ Админд мэдэгдэж чадсангүй. Та дахин оролдоно уу.")



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

    # 📝 Save caption to reuse
    caption = (
        f"🔔 ШИНЭ ХҮСЭЛТ 🔔\n\n"
        f"📌 Хүсэлтийн дугаар: `{invoice}`\n"
        f"👤 Үйлчлүүлэгч: {user_line}\n"
        f"💰 Гүйлгээ: *{amount} {currency_from} → {currency_to}*\n"
        f"💱 Хөрвүүлсэн дүн: *{converted} {currency_to}*\n"
        f"🏦 Дансны мэдээлэл: `{bank_details}`\n\n"
        "✅ Гүйлгээг баталгаажуулах эсвэл татгалзах товчийг дарна у|у."
    )

    markup = InlineKeyboardMarkup()
    markup.add(
        InlineKeyboardButton("✅ Баталгаажуулах", callback_data=f"confirm_{user_id}"),
        InlineKeyboardButton("❌ Татгалзах", callback_data=f"reject_{user_id}")
    )
    operator_id = get_current_shift_operator_id()
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


@bot.callback_query_handler(func=lambda call: call.data.startswith("confirm_") or call.data.startswith("reject_") or call.data.startswith("pending_") or call.data.startswith("refresh_"))
def handle_transaction_action(call):
    if call.from_user.id not in ALLOWED_ADMINS:
        bot.answer_callback_query(call.id, "🚫 Зөвшөөрөлгүй хэрэглэгч!", show_alert=True)
        return

    action, user_id_str = call.data.split("_", 1)
    is_confirmed = action == "confirm"
    is_pending = action == "pending"
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
            bot.answer_callback_query(call.id, "🔄 Статус шинэчлэгдлээ.", show_alert=True)
        else:
            bot.answer_callback_query(call.id, "❌ Invoice олдсонгүй.", show_alert=True)
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
            bot.answer_callback_query(call.id, "❌ Хүсэлтийн дугаар олдсонгүй.", show_alert=True)
            return
    
    resp = supabase.table("transactions") \
                   .select("status") \
                   .eq("invoice", invoice) \
                   .limit(1) \
                   .execute()
    current_status = resp.data[0]["status"] if resp.data else None

    if not is_pending and current_status != "pending":
        # if it's already successful or rejected, tell the admin
        return bot.answer_callback_query(
            call.id,
            "❗ Энэ гүйлгээ аль хэдийн баталгаажсан эсвэл цуцлагдсан байна.",
            show_alert=True
        )
    # 2️⃣ Get transaction from Supabase
    response = supabase.table("transactions").select("*").eq("invoice", invoice).limit(1).execute()
    if not response.data:
        bot.answer_callback_query(call.id, "❌ Гүйлгээ датабазаас олдсонгүй.", show_alert=True)
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
    if is_pending:
        # Notify user about status change to pending
        bot.send_message(
            user_id,
            f"🔄 Таны `{invoice}` дугаартай гүйлгээ дахин шалгагдах төлөвт орууллаа.\n"
            f"⏳ Админ таны гүйлгээг дахин шалгаж, удахгүй хариу өгөх болно.",
            parse_mode="Markdown"
        )
        bot.answer_callback_query(call.id, "✅ Гүйлгээ pending төлөвт орууллаа.", show_alert=True)
    elif is_confirmed:
        # ✅ Calculate how much to send
        converted = round(amount * rate if currency_from == "RUB" else amount / rate, 2)

        # ✅ Notify user
        bot.send_message(
            user_id,
            f"✅ Таны `{invoice}` дугаартай гүйлгээ баталгаажлаа!\n"
            f"💸 Админ таны данс руу тун удахгүй шилжүүлэг хийх болно.",
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
                bank_info = (
                    f"📌 Хүсэлтийн дугаар: `{invoice}`\n"
                    f"📤 *Цэнэглэх дүн:* `{converted} RUB`\n\n"
                    f"📱 Утас: `{sanitize_markdown(phone)}`\n"
                    f"📡 Оператор: *{sanitize_markdown(telecom)}*\n\n"
                    f"Ханш: *{rate}*\n\n"
                    f"📲 Утасны дугаар цэнэглээд баталгаажуулсан баримтыг reply эсвэл caption хэсэгт invoice id-тай хамт илгээнэ үү."
                )
            elif currency_to == "MNT" and len(parts) >= 3:
                bank, iban, name = parts[:3]
                bank_info = (
                    f"📌 Хүсэлтийн дугаар: `{invoice}`\n"
                    f"📤 *Шилжүүлэх дүн:* `{converted} MNT`\n\n"
                    f"{bank}\n"
                    f"`{iban}`\n"
                    f"{name}\n\n"
                    f"Ханш: *{rate}*\n\n"
                    f"Энэхүү мессежд зургаар *REPLY* хийх эсвэл *CAPTION* хэсэгт invoice id-г бичиж хамт илгээнэ үү."
                )
            elif currency_to == "RUB" and len(parts) >= 4:
                bank, phone, card, name = parts[:4]
                bank_info = (
                    f"📌 Хүсэлтийн дугаар: `{invoice}`\n"
                    f"📤 *Шилжүүлэх дүн:* `{converted} RUB`\n\n"
                    f"{bank}\n"
                    f"`{phone}`\n"
                    f"`{card}`\n"
                    f"{name}\n\n"
                    f"Ханш: *{rate}*\n\n"
                    f"Энэхүү мессежд зургаар *REPLY* хийх эсвэл *CAPTION* хэсэгт invoice id-г бичиж хамт илгээнэ үү."
                )

            if not bank_info:
                raise ValueError("Unsupported bank details format")

            msg = bot.send_message(call.message.chat.id, bank_info, parse_mode="Markdown")
        except Exception as e:
            print(f"❌ Error formatting bank details: {e}")
            bot.send_message(call.message.chat.id, "⚠️ Дансны мэдээлэл формат буруу байна.")

    else:
        # Ask for rejection comment
        update_user_session(call.from_user.id, {"state": f"awaiting_tx_rejection_comment|{invoice}|{user_id}"})
        bot.send_message(call.from_user.id, f"📝 Та `{invoice}` гүйлгээг цуцлах шалтгаанаа бичнэ үү:", parse_mode="Markdown")


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
        bot.send_message(admin_id, "❌ Алдаа: Хүсэлтийн төлөв олдсонгүй.")
        return
    
    # Extract invoice and user_id from state
    # Format: "awaiting_tx_rejection_comment|INVOICE|USERID"
    state_parts = state.replace("awaiting_tx_rejection_comment|", "").split("|")
    
    if len(state_parts) < 2:
        bot.send_message(admin_id, "❌ Алдаа: Хүсэлтийн мэдээлэл буруу байна.")
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
        bot.send_message(
            admin_id,
            f"❌ `{invoice}` дугаартай гүйлгээ амжилттай цуцлагдлаа.",
            parse_mode="Markdown"
        )

        bot.send_message(
            user_id,
            f"❌ Таны `{invoice}` дугаартай гүйлгээг баталгаажуулах боломжгүй байна.\n"
            f"📌 Шалтгаан: _{comment}_\n\n{CONTACT_SUPPORT}",
            parse_mode="Markdown"
        )
        update_user_session(user_id, {"invoice": None})

    except Exception as e:
        print(f"❌ Rejection DB error: {e}")
        bot.send_message(admin_id, "❌ Гүйлгээ цуцлах үед алдаа гарлаа.")
    finally:
        clear_state(admin_id)
        pending_transactions.pop(user_id, None)

# 🔙 Back to Main Menu
@bot.callback_query_handler(func=lambda call: call.data == "back_main")
def back_main(call):
    bot.send_message(call.message.chat.id, "👋 Нүүр хуудас руу буцах", reply_markup=main_menu())

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

        text = (
            f"📝 Найз урьсан хүсэлт\n\n"
            f"Хэрэглэгч: {display_name} (id: {user_id})\n"
            f"Урилга хүлээж авсан хэрэглэгчийн тоо: {accepted_count} найз\n"
            f"Промокодууд: {to_award} ширхэг\n\n"
            f"Хянаж баталгаажуулснаар хэрэглэгчид промокод олгоно.\n\nУрилга явуулсан телеграм хаягууд:\n{list_text}")

        markup = InlineKeyboardMarkup()
        markup.add(InlineKeyboardButton("✅ Баталгаажуулах", callback_data=f"confirm_referral:{user_id}"))
        markup.add(InlineKeyboardButton("❌ Татгалзах", callback_data=f"reject_referral:{user_id}"))

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
        f"Та {REFERRAL_REQUIRED_COUNT} найзаа OYUNS FINANCE сувагт уриад промокод авах боломжтой.\n\n"
        f"✅ Одоогийн статус: Та {accepted_count}/{REFERRAL_REQUIRED_COUNT} найзаа урьсан байна.\n\n"
        f"📋 Заавар:\n\n"
        f"1️⃣ Та найзуудаа OYUNS FINANCE сувагт дараах линкээр урина уу:\n"
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
        f"Сайн уу! Би чамайг OYUNS FINANCE сувагт нэгдэхийг урьж байна.\n\n"
        f"Доорх линкээр телеграм сувагт нэгдээрэй.\n\n"
        f"📰 Өдөр тутмын санхүүгийн мэдээлэл\n"
        f"💱 Валютын ханш\n"
        f"🤖 OYUNS Finance Telegram ботын мэдээлэл\n\n"
        f"👉 {channel_link}\n\n"
        f"OYUNS FINANCE – Илүү хурдан, илүү хялбар"
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
            f"1️⃣ Эхлээд OYUNS FINANCE сувагт нэгдэнэ үү:\n"
            f"👉 {channel_link}\n\n"
            f"2️⃣ Нэгдсэний дараа доорх **'✅ Би нэгдсэн'** товчийг дарж баталгаажуулна уу.\n\n"
            f"📌 Зөвхөн сувагт нэгдсэн тохиолдолд таны урьсан найз промокод авах боломжтой болно."
        )
        
        markup = InlineKeyboardMarkup()
        markup.add(InlineKeyboardButton("📢 Oyuns Finance суваг", url=channel_link))
        markup.add(InlineKeyboardButton("✅ Би нэгдсэн", callback_data="verify_channel_join"))
        
        bot.send_message(user_id, text, parse_mode="Markdown", reply_markup=markup)
        print(f"✅ Prompted user {user_id} to join channel (referred by {referrer_id})")
        
    except Exception as e:
        print(f"❌ Failed to prompt channel join for user {user_id}: {e}")
        # Fallback: just show main menu
        bot.send_message(user_id, "👋 Сайн уу! OYUNS Finance ботод тавтай морил.", reply_markup=main_menu())


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
        markup.add(InlineKeyboardButton("📢 Oyuns Finance суваг", url=channel_link))
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
    if admin_id not in ALLOWED_ADMINS:
        bot.send_message(message.chat.id, "❌ Та энэ командыг ашиглах эрхгүй байна.")
        return

    parts = message.text.strip().split()
    if len(parts) < 2:
        bot.send_message(message.chat.id, "❌ Хэрэглэгчийн ID болон хөнгөлөх үнийн дүнг оруулна уу. Жишээ: /promocode 123456789 0.3")
        return

    try:
        user_id = int(parts[1])
    except ValueError:
        bot.send_message(message.chat.id, "❌ Зөв ID оруулна уу. Жишээ: /promocode 123456789 0.3")
        return

    # Optional discount argument
    discount = 0.2
    if len(parts) >= 3:
        try:
            discount = float(parts[2])
        except ValueError:
            bot.send_message(message.chat.id, "❌ Хөнгөлөлтийн хэмжээг тоогоор оруулна уу. Жишээ: /promocode 123456789 0.3")
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
            bot.send_message(message.chat.id, f"✅ Промокод `{promo_code}` ({discount}) амжилттай {user_id} хэрэглэгчд олгогдлоо.")
        else:
            bot.send_message(message.chat.id, "❌ Промокод үүсгэхэд алдаа гарлаа.")
    except Exception as e:
        bot.send_message(message.chat.id, f"❌ Промокод үүсгэхэд алдаа гарлаа: {e}")





def payment_receipt(message):
    user_id = message.chat.id
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
        bot.send_message(user_id, "⚠️ Гүйлгээний мэдээлэл олдсонгүй. Та эхнээс эхлэнэ үү.")
        return
    currency_to = session.get("currency_to") if session else "mnt"

    # 📌 Instructions based on destination currency
    if currency_to == "mnt":
        instructions = (
            "📌 Та өөрийн *монгол банкны* мэдээллийг дараах форматаар явуулна уу:\n"
            "👉 `Банк, IBAN дансны дугаар, Данс эзэмшэгчийн нэр` \n\n ⚠️ Та өөрийн нэр дээр бүртгэлтэй данснаас шилжүүлэг хийгээгүй тохиолдолд таны гүйлгээ буцаагдах болохыг анхаарна уу!"
        )
    else:
        instructions = (
            "📌 Та өөрийн *орос банкны* мэдээллийг дараах форматаар явуулна уу:\n"
            "👉 `Банк, Утасны дугаар, Картын дугаар, Карт эзэмшэгчийн нэр` \n\n ⚠️ Та өөрийн нэр дээр бүртгэлтэй данснаас шилжүүлэг хийгээгүй тохиолдолд таны гүйлгээ буцаагдах болохыг анхаарна уу!"
        )

    markup = InlineKeyboardMarkup()
    markup.add(
        InlineKeyboardButton("💾 Хадгалсан дансны мэдээллээ ашиглах", callback_data="use_saved_bank")
    )

    bot.send_message(
        user_id,
        f"✅ Хүлээж авлаа!\n📌 Хүсэлтийн дугаар: `{invoice}`\n\n"
        f"{instructions}\n\n"
        "📎 Эсвэл хадгалсан мэдээллээ ашиглах бол доорх товчийг дарна уу.",
        reply_markup=markup,
        parse_mode="Markdown"
    )
@bot.callback_query_handler(func=lambda call: call.data == "review_registration")
def handle_review_registration(call):
    user_id = call.message.chat.id
    review_registration(user_id)

def review_registration(user_id):
    response = supabase.table("users").select("*").eq("id", user_id).execute()
    user = response.data[0] if response.data else {}

    text = (
        "📋 **Бүртгэлийн мэдээлэл шалгах:**\n\n"
        f"👤 Овог: {user.get('last_name', '-')}\n"
        f"👤 Нэр: {user.get('first_name', '-')}\n"
        f"📞 Утас: {user.get('phone', '-')}\n"
        f"🪪 Паспортын дугаар: {user.get('registration_number', '-')}\n"
        f"🏦 Монгол банк: {user.get('bank_mnt', '-')}\n"
        f"🇷🇺 Орос банк: {user.get('bank_rub', '-')}\n"
        f"📷 Паспорт зураг: {'🟢 Байгаа' if user.get('passport_file_id') else '🔴 Байхгүй'}"
    )

    markup = InlineKeyboardMarkup()
    markup.add(
        InlineKeyboardButton("📤 Баталгаажуулах хүсэлт илгээх", callback_data="submit_verification"),
        InlineKeyboardButton("🔙 Буцах", callback_data="back_main")
    )

    bot.send_message(user_id, text, parse_mode="Markdown", reply_markup=markup)


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
        return bot.reply_to(message, "🚫 Зөвшөөрөгдөөгүй хэрэглэгч!")

    parts = message.text.split(maxsplit=1)
    if len(parts) != 2 or not is_valid_invoice_format(parts[1]):
        return bot.reply_to(message, "❗ Формат: /batalgaajuulah <YYYYMMDD_HHMMSS> эсвэл <YYYYMMDD-HHMMSS-XX>")
    invoice = parts[1]

    # Fetch txn
    resp = supabase.table("transactions") \
        .select("status,amount,currency_from,currency_to,rate,bank_details,bill_url") \
        .eq("invoice", invoice) \
        .single() \
        .execute()
    if not resp.data:
        return bot.reply_to(message, f"❌ `{invoice}` гүйлгээ олдсонгүй.", parse_mode="Markdown")
    txn = resp.data

    if txn["status"] != "rejected":
        return bot.reply_to(
            message,
            f"❗ `{invoice}` төлөв нь `{txn['status']}`, дахин баталгаажуулах боломжгүй.",
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
        caption = (
            f"📌 Хүсэлтийн дугаар: `{invoice}`\n"
            f"📤 *Шилжүүлэх дүн:* `{conv} MNT`\n\n"
            f"{bank}\n"
            f"`{iban}`\n"
            f"{name}\n\n"
            f"Ханш: *{rate}*\n\n"
            f"Энэхүү мессежд зургаар *REPLY* хийх эсвэл *CAPTION* хэсэгт invoice id-г бичиж хамт илгээнэ үү."
        )
    else:
        bank, phone, card, name = [x.strip() for x in bd.split(",")]
        caption = (
            f"📌 Хүсэлтийн дугаар: `{invoice}`\n"
            f"📤 *Шилжүүлэх дүн:* `{conv} RUB`\n\n"
            f"{bank}\n"
            f"`{phone}`\n"
            f"`{card}`\n"
            f"{name}\n\n"
            f"Ханш: *{rate}*\n\n"
            f"Энэхүү мессежд зургаар *REPLY* хийх эсвэл *CAPTION* хэсэгт invoice id-г бичиж хамт илгээнэ үү."
        )

    # Attach public link
    if url:
        caption += f"\n\n📎 [Баримт харах]({url})"

    bot.send_message(admin_id, caption, parse_mode="Markdown")

# ✅ Admin command to show transaction status and manage it
@bot.message_handler(commands=['status'])
def cmd_status(message):
    admin_id = message.chat.id
    if admin_id not in ALLOWED_ADMINS:
        return bot.reply_to(message, "🚫 Зөвшөөрөгдөөгүй хэрэглэгч!")

    parts = message.text.split(maxsplit=1)
    if len(parts) != 2 or not is_valid_invoice_format(parts[1]):
        return bot.reply_to(message, "❗ Формат: /status <YYYYMMDD_HHMMSS> эсвэл <YYYYMMDD-HHMMSS-XX>")
    invoice = parts[1]

    # Fetch txn
    resp = supabase.table("transactions") \
        .select("*") \
        .eq("invoice", invoice) \
        .single() \
        .execute()
    if not resp.data:
        return bot.reply_to(message, f"❌ `{invoice}` гүйлгээ олдсонгүй.", parse_mode="Markdown")
    txn = resp.data

    # Build status message
    status_emoji = {
        "pending": "⏳",
        "successful": "✅", 
        "rejected": "❌"
    }
    
    status_text = {
        "pending": "Хүлээгдэж буй",
        "successful": "Амжилттай",
        "rejected": "Цуцлагдсан"
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

    message_text = (
        f"{emoji} **Гүйлгээний мэдээлэл**\n\n"
        f"📌 **Дугаар:** `{invoice}`\n"
        f"📊 **Төлөв:** {status_name}\n"
        f"💰 **Дүн:** {amt} {currency_from} → {converted} {currency_to}\n"
        f"📈 **Ханш:** {rate}\n"
        f"👤 **Хэрэглэгч ID:** {txn['user_id']}\n"
        f"🕐 **Үүсгэсэн:** {txn.get('timestamp', 'N/A')[:19] if txn.get('timestamp') else 'N/A'}\n"
    )

    if txn.get("completed_at"):
        message_text += f"✅ **Дууссан:** {txn['completed_at'][:19]}\n"
    if txn.get("completed_by_admin"):
        message_text += f"👨‍💼 **Баталгаажуулсан:** {txn['completed_by_admin']}\n"
    if txn.get("admin_comment"):
        message_text += f"💬 **Тайлбар:** {txn['admin_comment']}\n"

    # Add action buttons based on current status
    markup = InlineKeyboardMarkup()
    if status == "pending":
        # Pending transactions can be confirmed or rejected
        markup.add(
            InlineKeyboardButton("✅ Баталгаажуулах", callback_data=f"confirm_{txn['user_id']}"),
            InlineKeyboardButton("❌ Цуцлах", callback_data=f"reject_{txn['user_id']}")
        )
    elif status == "successful":
        # Successful transactions can be moved back to pending or rejected
        markup.add(
            InlineKeyboardButton("🔄 Pending рүү буцаах", callback_data=f"pending_{txn['user_id']}")
        )
    elif status == "rejected":
        # Rejected transactions can be moved back to pending or confirmed
        markup.add(
            InlineKeyboardButton("🔄 Pending рүү буцаах", callback_data=f"pending_{txn['user_id']}")
        )

    bot.reply_to(message, message_text, parse_mode="Markdown", reply_markup=markup)

def _send_rating_prompt(user_id: int):
    kb = InlineKeyboardMarkup()
    for i in range(1, 6):
        kb.add(InlineKeyboardButton("⭐" * i, callback_data=f"rate_{i}"))
    kb.add(InlineKeyboardButton("✍️ Санал хүсэлт бичих", callback_data="write_feedback"))
    bot.send_message(user_id, "🤔 Та бидний энэхүү үйлчилгээг ашиглахад хэр хялбар байсан бэ?", reply_markup=kb)

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
        f"📨 `{invoice}` дугаартай гүйлгээний баримт хэрэглэгч рүү амжилттай илгээгдлээ.",
        parse_mode="Markdown"
    )
@bot.message_handler(content_types=['photo'])
def handle_passport_or_receipt(message):
    user_id = message.chat.id
    photo_id = message.photo[-1].file_id
    state = get_state(user_id)
    admin_id = user_id  # for clarity

    # --- 1) PASSPORT UPLOAD FLOW (for new-user registration) ---
    if state in ["waiting_for_passport", "register_passport"]:
        try:
            file_info = bot.get_file(photo_id)
            file_url  = f"https://api.telegram.org/file/bot{BOT_TOKEN}/{file_info.file_path}"
            resp      = requests.get(file_url)
            resp.raise_for_status()

            file_name = f"{user_id}_{datetime.now().strftime('%Y%m%d%H%M%S')}.jpg"
            with tempfile.NamedTemporaryFile(delete=False, suffix=".jpg") as tmp:
                tmp.write(resp.content)
                temp_path = tmp.name

            supabase.storage.from_("passports").upload(
                file_name,
                temp_path,
                {"content-type": "image/jpeg", "x-upsert": "true"}
            )
            public_url = supabase.storage.from_("passports").get_public_url(file_name)

            supabase.table("users").update({
                "passport_file_id": photo_id,
                "passport_storage_url": public_url
            }).eq("id", user_id).execute()

            bot.send_message(user_id, "🪪 Паспортын зураг амжилттай хадгалагдлаа!")
            if state == "register_passport":
                bot.send_message(
                    user_id,
                    "🎉 Бүртгэл дууслаа!\n📋 Та бүртгэлийн мэдээллээ дахин шалгаад баталгаажуулах хүсэлт илгээнэ үү 👇",
                    reply_markup=InlineKeyboardMarkup().add(
                        InlineKeyboardButton("📋 Мэдээлэл шалгах", callback_data="review_registration")
                    )
                )
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

            supabase.storage.from_("bills").upload(
                file_name,
                temp_path,
                {"content-type": "image/jpeg", "x-upsert": "true"}
            )
            bill_url = supabase.storage.from_("bills").get_public_url(file_name)

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

            bot.send_message(user_id, "✅ Гүйлгээний баримт амжилттай хадгалагдлаа!")
        except Exception as e:
            print(f"❌ Receipt upload error: {e}")
            bot.send_message(user_id, f"❌ Баримт хадгалах үед алдаа гарлаа: {e}")
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
            
            supabase.storage.from_("bills").upload(
                file_name,
                temp_path,
                {"content-type": "image/jpeg", "x-upsert": "true"}
            )
            bill_url = supabase.storage.from_("bills").get_public_url(file_name)
            
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
            
            bot.send_message(user_id, "✅ Гүйлгээний баримт амжилттай хадгалагдлаа!")
            
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
            
            bot.send_message(user_id, "✅ Таны хүсэлтийг админ руу илгээлээ!\nАдмин таны гүйлгээг баталгаажуулах хүртэл та хүлээнэ үү.")
            
            clear_state(user_id)
            
        except Exception as e:
            print(f"❌ Phone topup receipt upload error: {e}")
            bot.send_message(user_id, f"❌ Баримт хадгалах үед алдаа гарлаа: {e}")
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

def cancel_markup():
    markup = InlineKeyboardMarkup()
    markup.add(InlineKeyboardButton("❌ Цуцлах", callback_data="cancel_registration"))
    return markup

def restart_registration_markup():
    markup = InlineKeyboardMarkup()
    markup.add(InlineKeyboardButton("🔁 Бүртгэл дахин эхлүүлэх", callback_data="restart_registration"))
    return markup


@bot.callback_query_handler(func=lambda call: call.data == "cancel_registration")
def cancel_registration(call):
    user_id = call.message.chat.id
    clear_state(user_id)
    bot.send_message(user_id, "🚫 Бүртгэлийн үйлдэл цуцлагдлаа.")

#REGISTRATION FORM

@bot.message_handler(commands=['register'])
def register(message):
    user_id = message.chat.id
    if not has_agreed_terms(user_id):
        ask_terms_agreement(message.chat.id)
        return
    # Check if user is already verified
    response = supabase.table("users").select("verified").eq("id", user_id).execute()
    user = response.data[0] if response.data else None

    if user and user.get("verified"):
        bot.send_message(user_id, "✅ Та аль хэдийн бүртгүүлсэн байна. Хувийн мэдээлэл өөрчлөхийг хүсвэл хэрэглэгчийн тохиргоо цэсийг ашиглана уу.")
        return

    # Insert placeholder user if not exists
    if not user:
        supabase.table("users").upsert({"id": user_id}).execute()

    bot.send_message(user_id, "Та бүртгэлийн форм эхлүүлж байна.\n\n Бид таны хувийн мэдээллийг чандлан хадгалах бөгөөд энэхүү мэдээллүүд нь хэрэглэгчийн санхүүгийн аюулгүй байдлыг хангах, болзошгүй луйвраас сэргийлэх зорилготой юм. Эдгээрээс бусад зорилгоор таны мэдээллийг бид ашиглахгүй болно.\n\n📋 Та өөрийн дараах мэдээллүүдийг оруулна уу...")
    update_user_session(user_id, {"state": "register_last_name"})

    bot.send_message(user_id, "👤 Та өөрийн овгоо оруулна уу:", reply_markup=cancel_markup())

@bot.callback_query_handler(func=lambda c: c.data == "enter_rub")
def handle_rub_choice(c):
    user_id = c.message.chat.id
    # Move straight to entering RUB info
    update_user_session(user_id, {"state": "register_bank_rub"})
    bot.send_message(
        user_id,
        "🏦 Орос банкны мэдээллээ дараах форматаар таслал тэмдэг ашиглан оруулна уу:\n"
        "Банк, Орос утасны дугаар, Картын дугаар, Карт эзэмшэгчийн нэр",
        parse_mode="Markdown",
        reply_markup=cancel_markup()
    )
    bot.answer_callback_query(c.id)

@bot.message_handler(func=lambda m: get_state(m.chat.id) in [
    "register_last_name",
    "register_first_name",
    "register_phone",
    "register_reg",
    "register_bank_mnt",
    "register_bank_rub",
    "register_passport"
])

def handle_registration_sequence(message):
    user_id = message.chat.id
    session = get_user_session(user_id)
    state = session["state"] if session else None
    text = message.text.strip()

    if state == "register_last_name":
        supabase.table("users").upsert({"id": user_id, "last_name": text}).execute()
        update_user_session(user_id, {"state": "register_first_name"})
        bot.send_message(user_id, "👤 Та өөрийн нэрээ оруулна уу:", reply_markup=cancel_markup())

    elif state == "register_first_name":
        supabase.table("users").upsert({"id": user_id, "first_name": text}).execute()
        update_user_session(user_id, {"state": "register_phone"})
        bot.send_message(user_id, "📞 Утасны дугаараа оруулна уу:", reply_markup=cancel_markup())

    elif state == "register_phone":
        supabase.table("users").upsert({"id": user_id, "phone": text}).execute()
        update_user_session(user_id, {"state": "register_reg"})
        bot.send_message(user_id, "🪪 Паспортын дугаараа оруулна уу (жишээ нь: E1234560):", reply_markup=cancel_markup())

    elif state == "register_reg":
        # Remove spaces before validating
        clean_text = text.replace(" ", "")
    
        # Check only letters and numbers (spaces ignored)
        if not re.fullmatch(r'[A-Za-z0-9]+', clean_text):
            msg = bot.send_message(
                user_id,
                "❌ Паспортын дугаар буруу байна. Зөвхөн A–Z болон 0–9 тэмдэгт зөвшөөрнө. Жишээ нь: E1234560",
                reply_markup=cancel_markup()
            )
            bot.register_next_step_handler(msg, handle_registration_sequence)
            return
                
        supabase.table("users").upsert({"id": user_id, "registration_number": text}).execute()
        update_user_session(user_id, {"state": "register_bank_mnt"})
        bot.send_message(user_id, "🏦 Монгол банкны мэдээллээ дараах форматаар таслал тэмдэг ашиглан оруулна уу (Банк, IBAN дансны дугаар, Данс эзэмшэгчийн нэр):", reply_markup=cancel_markup())

    elif state == "register_bank_mnt":
        parts = [x.strip() for x in text.split(",")]
        if len(parts) != 3:
            bot.send_message(user_id,
                "❌ Зөв формат: Банк, IBAN дансны дугаар, Данс эзэмшэгчийн нэр",
                reply_markup=cancel_markup())
            return

        # Save MNT info
        supabase.table("users").upsert({"id": user_id, "bank_mnt": text}).execute()

        # **Now require RUB info immediately**
        update_user_session(user_id, {"state": "register_bank_rub"})
        bot.send_message(
            user_id,
            "📌 Орос банкны мэдээллээ дараах форматаар таслал тэмдэг ашиглан оруулна уу:\n"
            "`Банк, Утасны дугаар, Картын дугаар, Карт эзэмшэгчийн нэр`",
            reply_markup=cancel_markup()
        )

    elif state == "register_bank_rub":
        parts = [x.strip() for x in text.split(",")]
        if len(parts) != 4:
            bot.send_message(
                user_id,
                "❌ Зөв формат: Банк, Утасны дугаар, Картын дугаар, Карт эзэмшэгчийн нэр",
                reply_markup=cancel_markup()
            )
            return
        supabase.table("users").upsert({"id": user_id, "bank_rub": text}).execute()
        update_user_session(user_id, {"state": "register_passport"})
        bot.send_message(user_id, "📷 Та паспортын эхний хуудасны зургаа илгээнэ үү:", reply_markup=cancel_markup())

    elif state == "register_passport":
        bot.send_message(user_id, "❌ Та зураг илгээнэ үү, текст биш.", reply_markup=cancel_markup())
        clear_state(user_id)



@bot.callback_query_handler(func=lambda call: call.data == "cancel_registration")
def cancel_registration(call):
    user_id = call.message.chat.id
    clear_state(user_id)  # Clear current state

    # Optional: delete unverified user data
    supabase.table("users").delete().eq("id", user_id).execute()

    bot.send_message(user_id, "🚫 Бүртгэлийн үйл явц цуцлагдлаа.", reply_markup=restart_registration_markup())



@bot.message_handler(commands=['hereglegch'])
def show_pending_users(message):
    try:
        user_id = message.from_user.id
        print("🆔 Admin requesting:", user_id)

        if user_id not in ALLOWED_ADMINS:
            bot.send_message(message.chat.id, "🚫 Зөвшөөрөлгүй хэрэглэгч байна.")
            return

        response = supabase.table("users").select("*").eq("verified", False).eq("ready_for_verification", True).execute()
        users = response.data

        print("🗂 Pending user data:", users)

        if not users:
            bot.send_message(message.chat.id, "📭 Одоогоор баталгаажуулах хүсэлт илгээсэн хэрэглэгч байхгүй байна.")
            return

        for user in users:
            text = (
                f"👤 Хэрэглэгчийн мэдээлэл:\n\n"
                f"👤 Овог: {user.get('last_name', '-')}\n"
                f"👤 Нэр: {user.get('first_name', '-')}\n"
                f"� Имэйл: {user.get('email', '-')}\n"
                f"📞 Монгол утас: {user.get('phone_mnt', '-')}\n"
                f"📞 Орос утас: {user.get('phone', '-')}\n"
                f"🪪 Паспортын дугаар: {user.get('registration_number', '-')}\n"
                f"🏦 Монгол банк: {user.get('bank_mnt', '-')}\n"
                f"🇷🇺 Орос банк: {user.get('bank_rub', '-')}\n"
            )

            markup = InlineKeyboardMarkup()
            markup.add(
                InlineKeyboardButton("✅ Баталгаажуулах", callback_data=f"verify_{user['id']}"),
                InlineKeyboardButton("❌ Цуцлах", callback_data=f"rejectuser_{user['id']}")
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
                    bot.send_message(message.chat.id, text + "\n⚠️ Паспортын зургийг татаж чадсангүй.", reply_markup=markup)
                    print(f"❌ Error downloading image from Supabase: {e}")
            else:
                bot.send_message(message.chat.id, text + "\n⚠️ Паспорт зураг оруулаагүй байна!", reply_markup=markup)

    except Exception as e:
        import traceback
        traceback.print_exc()
        bot.send_message(message.chat.id, f"❌ Алдаа гарлаа: {e}")

@bot.callback_query_handler(func=lambda call: call.data.startswith("verify_"))
def verify_user(call):
    user_id = int(call.data.replace("verify_", ""))
    try:
        supabase.table("users").update({"verified": True}).eq("id", user_id).execute()
        bot.send_message(call.message.chat.id, f"✅ Хэрэглэгч [{user_id}](tg://user?id={user_id}) баталгаажлаа.", parse_mode="Markdown")
        bot.send_message(user_id, "🎉 Таны бүртгэл амжилттай баталгаажлаа!")

        # 🧹 Delete the original message with buttons
        bot.delete_message(call.message.chat.id, call.message.message_id)

    except Exception as e:
        print(f"❌ Error verifying user: {e}")
        bot.send_message(call.message.chat.id, "❌ Баталгаажуулах үед алдаа гарлаа.")

@bot.callback_query_handler(func=lambda call: call.data.startswith("rejectuser_"))
def reject_user_with_reason_prompt(call):
    user_id = int(call.data.replace("rejectuser_", ""))
    admin_id = call.from_user.id
    update_user_session(admin_id, {"state": f"awaiting_rejection_comment_{user_id}"})

    bot.send_message(admin_id, f"✍️ `{user_id}` хэрэглэгчийн бүртгэлийг цуцлах шалтгаанаа бичнэ үү:", parse_mode="Markdown")

@bot.message_handler(func=lambda m: get_state(m.chat.id).startswith("awaiting_rejection_comment_"))
def handle_rejection_comment(message):
    admin_id = message.chat.id
    text = message.text.strip()
    state = get_state(admin_id)
    try:
        user_id = int(state.split("_")[-1])
    except (ValueError, AttributeError, IndexError):
        bot.send_message(admin_id, "⚠️ Уучлаарай, хэрэглэгчийн мэдээллийг уншиж чадсангүй.")
        return

    # Save to DB
    supabase.table("users").update({
        "ready_for_verification": False,
    }).eq("id", user_id).execute()

    # Notify both parties
    bot.send_message(admin_id, f"❌ Хэрэглэгч `{user_id}` бүртгэл цуцлагдлаа.", parse_mode="Markdown")
    bot.send_message(
        user_id,
        f"⚠️ Таны бүртгэлийг баталгаажуулах боломжгүй байна.\n📌 Шалтгаан: _{text}_\n\n Та шаардлагатай бол мэдээллээ 👤 *Хэрэглэгчийн тохиргоо* хэсэгт засаж дахин илгээнэ үү.\n\n📞 Тусламж хэрэгтэй бол дараах хаягаар холбогдоно уу:\n+976 7780 6060\n+7 (977) 801-91-43\n📨 [@oyuns_finance](https://t.me/oyuns_finance)",
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

    caption = (
        f"🔔 БАТАЛГААЖААГҮЙ ХҮСЭЛТ 🔔\n\n"
        f"📌 Хүсэлтийн дугаар: `{invoice}`\n"
        f"👤 Үйлчлүүлэгч: {user_line}\n"
        f"💰 Гүйлгээ: *{amount} {currency_from.upper()} → {currency_to.upper()}*\n"
        f"💱 Хөрвүүлсэн дүн: *{converted} {currency_to.upper()}*\n"
        f"🏦 Дансны мэдээлэл: `{bank_details}`\n\n"
        "✅ Гүйлгээг баталгаажуулах эсвэл татгалзах товчийг дарна уу."
    )

    markup = InlineKeyboardMarkup()
    markup.add(
        InlineKeyboardButton("✅ Баталгаажуулах", callback_data=f"confirm_{user_id}"),
        InlineKeyboardButton("❌ Татгалзах", callback_data=f"reject_{user_id}")
    )

    return caption, markup
@bot.message_handler(commands=['guilgee'])
def show_pending_transactions(message):
    if message.from_user.id not in ALLOWED_ADMINS:
        bot.send_message(message.chat.id, "🚫 Зөвшөөрөлгүй хэрэглэгч байна.")
        return

    response = supabase.table("transactions").select("*").eq("status", "pending").execute()
    transactions = response.data

    if not transactions:
        bot.send_message(message.chat.id, "📭 Баталгаажаагүй гүйлгээ алга байна.")
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
                bill_url = supabase.storage.from_("bills").get_public_url(file_name)

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
                    bot.send_message(message.chat.id, caption + f"\n📎 [Баримт харах]({bill_url})", parse_mode="Markdown", reply_markup=markup)
                else:
                    bot.send_message(message.chat.id, caption + "\n⚠️ Баримтын зураг олдсонгүй.", parse_mode="Markdown", reply_markup=markup)
        else:
            if bill_url:
                bot.send_message(message.chat.id, caption + f"\n📎 [Баримт харах]({bill_url})", parse_mode="Markdown", reply_markup=markup)
            else:
                bot.send_message(message.chat.id, caption + "\n⚠️ Гүйлгээний баримт байхгүй байна.", parse_mode="Markdown", reply_markup=markup)


@bot.message_handler(commands=["haih"])
def find_user_or_invoice(message):
    admin_id = message.from_user.id
    if admin_id not in ALLOWED_ADMINS:
        return bot.reply_to(message, "🚫 Зөвшөөрөлгүй хэрэглэгч байна.")

    args = message.text.split(maxsplit=1)
    if len(args) != 2:
        return bot.reply_to(message, "❌ Зөв формат: /haih <user_id|invoice_id>")

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
            return bot.reply_to(message, "❌ Дата хайх үед алдаа гарлаа.")

        if not resp.data:
            return bot.reply_to(message, f"❌ `{invoice}` дугаартай гүйлгээ олдсонгүй.", parse_mode="Markdown")

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
            display_name = tg_name or db_name or "Нэр_байхгүй"
            quick_line = f"<code>{display_name} — {username} — {user_id}</code>"
            
            lines = [
                "👤 <b>Хэрэглэгчийн мэдээлэл:</b>\n",
                f"📋 <b>Хуулах:</b> {quick_line}\n"
            ]
            
            # Detailed info
            if db_name:
                lines.append(f"📛 Нэр (DB): {db_name}")
            if tg_name:
                lines.append(f"📛 Нэр (TG): {tg_name}")
            if tg_user and tg_user.username:
                lines.append(f"🔗 Username: @{tg_user.username}")
            lines.append(f"🆔 ID: <code>{user_id}</code>")
            
            # DB info
            if db_user:
                lines.append("")
                lines.append(f"✅ Баталгаажсан: {'Тийм' if db_user.get('verified') else 'Үгүй'}")
                if db_user.get("phone"):
                    lines.append(f"📞 Утас: {db_user.get('phone')}")
                if db_user.get("bank_rub"):
                    lines.append(f"🏦 RUB данс: {db_user.get('bank_rub')}")
                if db_user.get("bank_mnt"):
                    lines.append(f"🏦 MNT данс: {db_user.get('bank_mnt')}")
            
            # Get transaction count
            try:
                tx_resp = supabase.table("transactions").select("id", count="exact").eq("user_id", user_id).execute()
                tx_count = tx_resp.count if tx_resp.count else 0
                lines.append(f"\n📊 Нийт гүйлгээ: {tx_count}")
            except:
                pass
            
            text = "\n".join(lines)
            return bot.send_message(message.chat.id, text, parse_mode="HTML")
        else:
            return bot.reply_to(message, f"❌ <code>{user_id}</code> хэрэглэгчийн мэдээлэл олдсонгүй.\n\nБотонд бүртгэлгүй эсвэл буруу ID байна.", parse_mode="HTML")
    else:
        # neither invoice nor pure-digit
        return bot.reply_to(message, "❌ Зөв формат: /haih <user_id|invoice_id>")

@bot.message_handler(commands=["message"])
def send_message_to_user(message):
    """Admin command to send a message to a user by their Telegram user_id.
    Usage: /message [user_id] [message]
    """
    admin_id = message.from_user.id
    if admin_id not in ALLOWED_ADMINS:
        return bot.reply_to(message, "🚫 Зөвшөөрөлгүй хэрэглэгч байна.")
    
    args = message.text.split(maxsplit=2)
    if len(args) < 3:
        return bot.reply_to(
            message, 
            "❌ Зөв формат: /message <user_id> <message>\n\n"
            "Жишээ нь: /message 123456789 Сайн байна уу?"
        )
    
    try:
        user_id = int(args[1])
    except ValueError:
        return bot.reply_to(message, "❌ User ID буруу байна. Зөвхөн тоо оруулна уу.")
    
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
                f"❌ Хэрэглэгч `{user_id}` бот-ыг блоклосон эсвэл устгасан байна.",
                parse_mode="Markdown"
            )
        elif e.error_code == 400:
            bot.reply_to(
                message, 
                f"❌ Хэрэглэгч `{user_id}` олдсонгүй эсвэл чат эхлүүлээгүй байна.",
                parse_mode="Markdown"
            )
        else:
            bot.reply_to(message, f"❌ Мессеж илгээх үед алдаа гарлаа: {e}")
        print(f"❌ Failed to send message from admin {admin_id} to user {user_id}: {e}")
    except Exception as e:
        bot.reply_to(message, f"❌ Алдаа гарлаа: {e}")
        print(f"❌ Error in send_message_to_user: {e}")

@bot.message_handler(func=lambda m: True, content_types=['text'])
def handle_unknown_text(message):
    # only fire when we're not in the middle of a flow
    if not get_state(message.chat.id):
        bot.send_message(
            message.chat.id,
            "🕹️ Та */start* команд ашиглан үйлчилгээний цэснээс сонгон өөрт хэрэгтэй үйлчилгээгээ авна уу, эсвэл OYUNS SUPPORT чат руу хандаарай:\n"
            f"{CONTACT_SUPPORT}",
            parse_mode="Markdown"
        )


# 🏃 Initialize and Run the Bot
def initialize_bot():
    """Load existing referral links from database into memory cache on startup"""
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

# Initialize bot on startup
print("🤖 Starting OYUNS Finance Bot...")
initialize_bot()
print("✅ Bot initialized, starting polling...")
bot.polling(none_stop=True)
