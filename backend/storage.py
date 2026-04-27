from supabase import Client
import logging

from config import get_settings

logger = logging.getLogger("uvicorn.error")


def presign_upload(client: Client, bucket: str, path: str, expires_in: int | None = None) -> tuple[str, int]:
    settings = get_settings()
    ttl = expires_in or settings.presigned_ttl_seconds
    
    try:
        # Supabase Python SDK: create_signed_upload_url(path) - no TTL param
        response = client.storage.from_(bucket).create_signed_upload_url(path)
    except Exception as e:
        logger.error(f"Storage Exception for {bucket}/{path}: {e}")
        # Common error: bucket not found or permissions
        raise RuntimeError(f"Storage operation failed. Check if bucket '{bucket}' exists. Details: {e}")

    # response structure: {"signed_url": "...", "path": "...", "token": "..."}
    signed_url = None
    if isinstance(response, dict):
        signed_url = response.get("signed_url") or response.get("signedUrl")
    
    if not signed_url and isinstance(response, str):
         signed_url = response

    if not signed_url:
        logger.error(f"Invalid storage response: {response}")
        raise RuntimeError(f"Failed to obtain signed URL. Response: {response}")
        
    return signed_url, ttl


def public_url(client: Client, bucket: str, path: str) -> str:
    return client.storage.from_(bucket).get_public_url(path)
