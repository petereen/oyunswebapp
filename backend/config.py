import os
from dataclasses import dataclass
from functools import lru_cache


@dataclass
class Settings:
    supabase_url: str
    supabase_key: str
    bot_token: str
    admin_chat_id: str
    admin_panel_url: str | None = None
    user_panel_url: str | None = None
    admin_api_key: str | None = None
    storage_bucket_passports: str = "passports"
    storage_bucket_receipts: str = "bills"
    presigned_ttl_seconds: int = 900  # 15 minutes


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    supabase_url = os.getenv("SUPABASE_URL", "")
    supabase_key = os.getenv("SUPABASE_KEY", "")
    bot_token = os.getenv("BOT_TOKEN", "")
    admin_chat_id = os.getenv("ADMIN_CHAT_ID", "")
    admin_panel_url = os.getenv("ADMIN_PANEL_URL")
    user_panel_url = os.getenv("USER_PANEL_URL")
    admin_api_key = os.getenv("ADMIN_API_KEY")

    if not supabase_url or not supabase_key or not bot_token:
        raise RuntimeError("SUPABASE_URL, SUPABASE_KEY, and BOT_TOKEN must be set")

    if not admin_chat_id:
        raise RuntimeError("ADMIN_CHAT_ID must be set for safety-net notifications")

    return Settings(
        supabase_url=supabase_url,
        supabase_key=supabase_key,
        bot_token=bot_token,
        admin_chat_id=admin_chat_id,
        admin_panel_url=admin_panel_url,
        user_panel_url=user_panel_url,
        admin_api_key=admin_api_key,
    )
