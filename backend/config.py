import os
from dataclasses import dataclass
from functools import lru_cache
from typing import List


@dataclass
class Settings:
    supabase_url: str
    supabase_key: str
    bot_token: str
    admin_chat_id: str
    admin_chat_ids: List[int]
    admin_user_ids: List[int]  # Telegram user IDs with admin access
    admin_panel_url: str | None = None
    user_panel_url: str | None = None
    admin_api_key: str | None = None
    storage_bucket_passports: str = "passports"
    storage_bucket_receipts: str = "bills"
    presigned_ttl_seconds: int = 900  # 15 minutes


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    # Strip to avoid hidden whitespace/newlines from env files
    supabase_url = os.getenv("SUPABASE_URL", "").strip()
    supabase_key = os.getenv("SUPABASE_KEY", "").strip()
    bot_token = os.getenv("BOT_TOKEN", "").strip()
    admin_chat_id = os.getenv("ADMIN_CHAT_ID", "").strip()
    admin_chat_ids_env = os.getenv("ADMIN_CHAT_IDS", "").strip()
    admin_user_ids_env = os.getenv("ADMIN_USER_IDS", "").strip()
    admin_panel_url = os.getenv("ADMIN_PANEL_URL")
    user_panel_url = os.getenv("USER_PANEL_URL")
    admin_api_key = os.getenv("ADMIN_API_KEY")

    if not supabase_url or not supabase_key or not bot_token:
        raise RuntimeError("SUPABASE_URL, SUPABASE_KEY, and BOT_TOKEN must be set")

    # Parse admin chat IDs (support multiple IDs)
    admin_chat_ids: List[int] = []
    if admin_chat_ids_env:
        try:
            admin_chat_ids = [int(x.strip()) for x in admin_chat_ids_env.split(",") if x.strip()]
        except ValueError:
            raise RuntimeError("ADMIN_CHAT_IDS must be a comma-separated list of integers")
    elif admin_chat_id:
        try:
            admin_chat_ids = [int(admin_chat_id)]
        except ValueError:
            raise RuntimeError("ADMIN_CHAT_ID must be an integer chat id")
    else:
        raise RuntimeError("ADMIN_CHAT_ID or ADMIN_CHAT_IDS must be set for safety-net notifications")

    # Parse admin user IDs (Telegram user IDs who can access admin features)
    admin_user_ids: List[int] = []
    if admin_user_ids_env:
        try:
            admin_user_ids = [int(x.strip()) for x in admin_user_ids_env.split(",") if x.strip()]
        except ValueError:
            raise RuntimeError("ADMIN_USER_IDS must be a comma-separated list of integers")
    else:
        # Default admin user IDs if not set in environment
        admin_user_ids = [1932946217, 1447446407, 5564298862, 1409343588, 6351681039]

    return Settings(
        supabase_url=supabase_url,
        supabase_key=supabase_key,
        bot_token=bot_token,
        admin_chat_id=admin_chat_id or str(admin_chat_ids[0]),
        admin_chat_ids=admin_chat_ids,
        admin_user_ids=admin_user_ids,
        admin_panel_url=admin_panel_url,
        user_panel_url=user_panel_url,
        admin_api_key=admin_api_key,
    )
