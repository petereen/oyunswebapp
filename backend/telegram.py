import requests
import logging
import json

from config import get_settings

logger = logging.getLogger("uvicorn.error")


def send_admin_notification(text: str, photo_url: str | None = None, reply_markup: dict | None = None) -> None:
    settings = get_settings()
    # Send to all configured admin chat IDs
    for chat_id in settings.admin_chat_ids:
        logger.info(f"Sending admin notification to chat_id={chat_id}")
        
        if photo_url:
            # Send as photo with caption
            payload = {"chat_id": chat_id, "photo": photo_url, "caption": text, "parse_mode": "HTML"}
            if reply_markup:
                payload["reply_markup"] = reply_markup
            try:
                response = requests.post(
                    f"https://api.telegram.org/bot{settings.bot_token}/sendPhoto",
                    json=payload,
                    timeout=15,
                )
                logger.info(f"Admin photo notification response to {chat_id}: {response.status_code}")
                if response.status_code != 200:
                    logger.error(f"Telegram API error for {chat_id}: {response.text}")
            except Exception as e:
                logger.error(f"Failed to send admin photo notification to {chat_id}: {e}")
        else:
            # Send as text message
            payload = {"chat_id": chat_id, "text": text, "parse_mode": "HTML"}
            if reply_markup:
                payload["reply_markup"] = reply_markup
            try:
                response = requests.post(
                    f"https://api.telegram.org/bot{settings.bot_token}/sendMessage",
                    json=payload,
                    timeout=10,
                )
                logger.info(f"Admin notification response to {chat_id}: {response.status_code}")
                if response.status_code != 200:
                    logger.error(f"Telegram API error for {chat_id}: {response.text}")
            except Exception as e:
                logger.error(f"Failed to send admin notification to {chat_id}: {e}")


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


def send_user_photo(user_id: int, photo_url: str, caption: str | None = None, reply_markup: dict | None = None) -> bool:
    """Send a photo to user via Telegram. Returns True if successful."""
    settings = get_settings()
    logger.info(f"Sending photo to user_id={user_id}, photo_url={photo_url[:100]}...")
    
    payload = {"chat_id": user_id, "photo": photo_url}
    if caption:
        payload["caption"] = caption
        payload["parse_mode"] = "HTML"
    if reply_markup:
        payload["reply_markup"] = reply_markup
    
    try:
        response = requests.post(
            f"https://api.telegram.org/bot{settings.bot_token}/sendPhoto",
            json=payload,
            timeout=15,
        )
        logger.info(f"Photo send response to {user_id}: {response.status_code}")
        if response.status_code != 200:
            logger.error(f"Telegram API error sending photo to {user_id}: {response.text}")
            return False
        return True
    except Exception as e:
        logger.error(f"Failed to send photo to user {user_id}: {e}")
        return False


def send_user_photos(user_id: int, photo_urls: list[str], caption: str | None = None) -> bool:
    """Send multiple photos as a media group to user via Telegram. Returns True if successful."""
    if not photo_urls:
        return False
    
    # If only one photo, use sendPhoto instead
    if len(photo_urls) == 1:
        return send_user_photo(user_id, photo_urls[0], caption)
    
    settings = get_settings()
    logger.info(f"Sending {len(photo_urls)} photos as media group to user_id={user_id}")
    
    # Build media array - caption goes on first photo only
    media = []
    for i, url in enumerate(photo_urls):
        media_item = {"type": "photo", "media": url}
        if i == 0 and caption:
            media_item["caption"] = caption
            media_item["parse_mode"] = "HTML"
        media.append(media_item)
    
    payload = {
        "chat_id": user_id,
        "media": media
    }
    
    try:
        response = requests.post(
            f"https://api.telegram.org/bot{settings.bot_token}/sendMediaGroup",
            json=payload,
            timeout=30,
        )
        logger.info(f"Media group send response to {user_id}: {response.status_code}")
        if response.status_code != 200:
            logger.error(f"Telegram API error sending media group to {user_id}: {response.text}")
            return False
        return True
    except Exception as e:
        logger.error(f"Failed to send media group to user {user_id}: {e}")
        return False
