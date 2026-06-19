import os
from dataclasses import dataclass
from functools import lru_cache
from typing import List

# Load .env file if present (local development)
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass


@dataclass
class Settings:
    supabase_url: str
    supabase_key: str
    supabase_key_source: str
    bot_token: str
    admin_chat_id: str
    admin_chat_ids: List[int]
    admin_user_ids: List[int]  # Telegram user IDs with admin access
    jwt_secret: str
    admin_panel_url: str | None = None
    user_panel_url: str | None = None
    webapp_url: str | None = None  # Telegram Mini App URL
    telegram_login_client_id: str | None = None
    telegram_login_client_secret: str | None = None
    telegram_login_nonce_ttl_seconds: int = 300
    admin_api_key: str | None = None
    storage_bucket_passports: str = "passports"
    storage_bucket_receipts: str = "bills"
    presigned_ttl_seconds: int = 900  # 15 minutes
    dev_mode: bool = False
    # Fuel service settings
    fuel_admin_api_key: str | None = None
    fuel_admin_user_ids: List[int] | None = None
    fuel_admin_chat_ids: List[int] | None = None
    # Standalone Oyuns Sags admin settings
    oyuns_sags_admin_api_key: str | None = None
    # Standalone analytics dashboard (no Telegram auth)
    dashboard_api_key: str | None = None
    # Google Sheets black-rate (а ханш) integration for the profit calculator
    google_sheets_service_account_file: str | None = None
    black_rate_spreadsheet_id: str | None = None
    black_rate_sheet_name: str = "Sheet1"
    black_rate_date_column: str = "B"
    black_rate_rate_column: str = "I"
    black_rate_header_rows: int = 1
    # Optional: only treat a row as a rate row when this column equals this value
    # (e.g. column E "Төлөв" == "Ханш"). Leave the column empty to disable.
    black_rate_status_column: str | None = "E"
    black_rate_status_value: str = "Ханш"

    @property
    def admin_ids(self) -> List[int]:
        """Alias for admin_user_ids"""
        return self.admin_user_ids


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    # Strip to avoid hidden whitespace/newlines from env files and potential quote wrappers
    supabase_url = os.getenv("SUPABASE_URL", "").strip().strip('"').strip("'")
    supabase_service_role_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip().strip('"').strip("'")
    supabase_public_key = os.getenv("SUPABASE_KEY", "").strip().strip('"').strip("'")
    supabase_key = supabase_service_role_key or supabase_public_key
    supabase_key_source = "SUPABASE_SERVICE_ROLE_KEY" if supabase_service_role_key else "SUPABASE_KEY"
    bot_token = os.getenv("BOT_TOKEN", "").strip().strip('"').strip("'")
    admin_chat_id = os.getenv("ADMIN_CHAT_ID", "").strip().strip('"').strip("'")
    admin_chat_ids_env = os.getenv("ADMIN_CHAT_IDS", "").strip().strip('"').strip("'")
    admin_user_ids_env = os.getenv("ADMIN_USER_IDS", "").strip().strip('"').strip("'")
    admin_panel_url = os.getenv("ADMIN_PANEL_URL")
    user_panel_url = os.getenv("USER_PANEL_URL")
    webapp_url = os.getenv("WEBAPP_URL")  # Telegram Mini App URL
    telegram_login_client_id = os.getenv("TELEGRAM_LOGIN_CLIENT_ID", "").strip().strip('"').strip("'") or None
    telegram_login_client_secret = os.getenv("TELEGRAM_LOGIN_CLIENT_SECRET", "").strip().strip('"').strip("'") or None
    telegram_login_nonce_ttl_raw = os.getenv("TELEGRAM_LOGIN_NONCE_TTL_SECONDS", "300").strip().strip('"').strip("'")
    admin_api_key = os.getenv("ADMIN_API_KEY")
    jwt_secret = os.getenv("JWT_SECRET", "").strip().strip('"').strip("'")
    # DEV MODE: Telegram auth bypass - defaults to FALSE for production safety
    dev_mode = os.getenv("DEV_MODE", "false").lower() == "true"

    # Fuel service env vars
    fuel_admin_api_key = os.getenv("FUEL_ADMIN_API_KEY")
    fuel_admin_user_ids_env = os.getenv("FUEL_ADMIN_USER_IDS", "").strip().strip('"').strip("'")
    fuel_admin_chat_ids_env = os.getenv("FUEL_ADMIN_CHAT_IDS", "").strip().strip('"').strip("'")
    oyuns_sags_admin_api_key = os.getenv("OYUNS_SAGS_ADMIN_API_KEY", "oyuns-sags-admin-key-2026")
    dashboard_api_key = os.getenv("DASHBOARD_API_KEY", "oyuns-dashboard-2026")

    # Google Sheets black-rate integration (profit calculator)
    google_sheets_service_account_file = (
        os.getenv("GOOGLE_SHEETS_SERVICE_ACCOUNT_FILE", "").strip().strip('"').strip("'")
        or os.getenv("GOOGLE_APPLICATION_CREDENTIALS", "").strip().strip('"').strip("'")
        or None
    )
    black_rate_spreadsheet_id = os.getenv("BLACK_RATE_SPREADSHEET_ID", "").strip().strip('"').strip("'") or None
    black_rate_sheet_name = os.getenv("BLACK_RATE_SHEET_NAME", "Sheet1").strip().strip('"').strip("'") or "Sheet1"
    black_rate_date_column = os.getenv("BLACK_RATE_DATE_COLUMN", "B").strip().strip('"').strip("'") or "B"
    black_rate_rate_column = os.getenv("BLACK_RATE_RATE_COLUMN", "I").strip().strip('"').strip("'") or "I"
    try:
        black_rate_header_rows = int(os.getenv("BLACK_RATE_HEADER_ROWS", "1").strip().strip('"').strip("'") or "1")
    except ValueError:
        black_rate_header_rows = 1
    black_rate_status_column = os.getenv("BLACK_RATE_STATUS_COLUMN", "E").strip().strip('"').strip("'") or None
    black_rate_status_value = os.getenv("BLACK_RATE_STATUS_VALUE", "Ханш").strip().strip('"').strip("'")

    if not supabase_url or not supabase_key or not bot_token:
        raise RuntimeError("SUPABASE_URL, BOT_TOKEN, and either SUPABASE_SERVICE_ROLE_KEY or SUPABASE_KEY must be set")
    
    if not jwt_secret:
        raise RuntimeError("JWT_SECRET must be set for secure authentication")

    try:
        telegram_login_nonce_ttl_seconds = int(telegram_login_nonce_ttl_raw)
    except ValueError as exc:
        raise RuntimeError("TELEGRAM_LOGIN_NONCE_TTL_SECONDS must be an integer") from exc

    if telegram_login_nonce_ttl_seconds <= 0:
        raise RuntimeError("TELEGRAM_LOGIN_NONCE_TTL_SECONDS must be greater than 0")

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

    # Parse fuel admin user IDs
    fuel_admin_user_ids: List[int] | None = None
    if fuel_admin_user_ids_env:
        try:
            fuel_admin_user_ids = [int(x.strip()) for x in fuel_admin_user_ids_env.split(",") if x.strip()]
        except ValueError:
            raise RuntimeError("FUEL_ADMIN_USER_IDS must be a comma-separated list of integers")

    # Parse fuel admin chat IDs
    fuel_admin_chat_ids: List[int] | None = None
    if fuel_admin_chat_ids_env:
        try:
            fuel_admin_chat_ids = [int(x.strip()) for x in fuel_admin_chat_ids_env.split(",") if x.strip()]
        except ValueError:
            raise RuntimeError("FUEL_ADMIN_CHAT_IDS must be a comma-separated list of integers")

    return Settings(
        supabase_url=supabase_url,
        supabase_key=supabase_key,
        supabase_key_source=supabase_key_source,
        bot_token=bot_token,
        admin_chat_id=admin_chat_id or str(admin_chat_ids[0]),
        admin_chat_ids=admin_chat_ids,
        admin_user_ids=admin_user_ids,
        jwt_secret=jwt_secret,
        admin_panel_url=admin_panel_url,
        user_panel_url=user_panel_url,
        webapp_url=webapp_url,
        telegram_login_client_id=telegram_login_client_id,
        telegram_login_client_secret=telegram_login_client_secret,
        telegram_login_nonce_ttl_seconds=telegram_login_nonce_ttl_seconds,
        admin_api_key=admin_api_key,
        dev_mode=dev_mode,
        fuel_admin_api_key=fuel_admin_api_key,
        fuel_admin_user_ids=fuel_admin_user_ids,
        fuel_admin_chat_ids=fuel_admin_chat_ids,
        oyuns_sags_admin_api_key=oyuns_sags_admin_api_key,
        dashboard_api_key=dashboard_api_key,
        google_sheets_service_account_file=google_sheets_service_account_file,
        black_rate_spreadsheet_id=black_rate_spreadsheet_id,
        black_rate_sheet_name=black_rate_sheet_name,
        black_rate_date_column=black_rate_date_column,
        black_rate_rate_column=black_rate_rate_column,
        black_rate_header_rows=black_rate_header_rows,
        black_rate_status_column=black_rate_status_column,
        black_rate_status_value=black_rate_status_value,
    )
