import requests
import logging
import json

from config import get_settings

logger = logging.getLogger("uvicorn.error")


def send_admin_notification(text: str, reply_markup: dict | None = None) -> None:
    settings = get_settings()
    logger.info(f"Sending admin notification to chat_id={settings.admin_chat_id}")
    
    # Build payload - reply_markup should NOT be json.dumps when using json= in requests
    payload = {"chat_id": settings.admin_chat_id, "text": text, "parse_mode": "HTML"}
    if reply_markup:
        payload["reply_markup"] = reply_markup
    
    try:
        response = requests.post(
            f"https://api.telegram.org/bot{settings.bot_token}/sendMessage",
            json=payload,
            timeout=10,
        )
        logger.info(f"Admin notification response: {response.status_code} - {response.text[:200]}")
        if response.status_code != 200:
            logger.error(f"Telegram API error: {response.text}")
    except Exception as e:
        logger.error(f"Failed to send admin notification: {e}")


def send_user_notification(user_id: int, text: str, reply_markup: dict | None = None) -> None:
    settings = get_settings()
    logger.info(f"Sending user notification to user_id={user_id}")
    
    payload = {"chat_id": user_id, "text": text, "parse_mode": "HTML"}
    if reply_markup:
        payload["reply_markup"] = reply_markup
    
    try:
        response = requests.post(
            f"https://api.telegram.org/bot{settings.bot_token}/sendMessage",
            json=payload,
            timeout=10,
        )
        logger.info(f"User notification response to {user_id}: {response.status_code}")
        if response.status_code != 200:
            logger.error(f"Telegram API error for user {user_id}: {response.text}")
    except Exception as e:
        logger.error(f"Failed to send user notification to {user_id}: {e}")


def send_user_photo(user_id: int, photo_url: str, caption: str | None = None) -> None:
    """Send a photo to user via Telegram."""
    settings = get_settings()
    payload = {"chat_id": user_id, "photo": photo_url}
    if caption:
        payload["caption"] = caption
        payload["parse_mode"] = "HTML"
    requests.post(
        f"https://api.telegram.org/bot{settings.bot_token}/sendPhoto",
        json=payload,
        timeout=15,
    )
