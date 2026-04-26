import logging
from functools import lru_cache
from urllib.parse import quote, urlparse, urlunparse

import boto3
from botocore.config import Config as BotoConfig
from supabase import Client

try:
    from .config import get_settings
except ImportError:
    from config import get_settings

logger = logging.getLogger("uvicorn.error")


def _normalize_path(path: str) -> str:
    return path.lstrip("/")


def _quote_path(path: str) -> str:
    return quote(_normalize_path(path), safe="/-_.~")


def _is_s3_backend() -> bool:
    return get_settings().storage_backend == "s3"


@lru_cache(maxsize=2)
def _get_s3_client(use_presign_endpoint: bool) -> boto3.client:
    settings = get_settings()
    endpoint_url = settings.s3_endpoint_url
    if use_presign_endpoint and settings.s3_presign_endpoint_url:
        endpoint_url = settings.s3_presign_endpoint_url

    return boto3.client(
        "s3",
        endpoint_url=endpoint_url,
        aws_access_key_id=settings.s3_access_key,
        aws_secret_access_key=settings.s3_secret_key,
        region_name=settings.s3_region,
        config=BotoConfig(
            signature_version="s3v4",
            s3={"addressing_style": settings.s3_addressing_style},
        ),
    )


def _build_s3_public_url(bucket: str, path: str) -> str:
    settings = get_settings()
    base_url = (settings.s3_public_base_url or settings.s3_endpoint_url or "").rstrip("/")
    if not base_url:
        raise RuntimeError("S3 public URL is not configured")

    quoted_path = _quote_path(path)
    if settings.s3_addressing_style == "virtual":
        parsed = urlparse(base_url)
        netloc = f"{bucket}.{parsed.netloc}"
        return urlunparse(parsed._replace(netloc=netloc, path=f"/{quoted_path}"))

    return f"{base_url}/{bucket}/{quoted_path}"


def presign_upload(client: Client, bucket: str, path: str, content_type: str | None = None, expires_in: int | None = None) -> tuple[str, int]:
    settings = get_settings()
    ttl = expires_in or settings.presigned_ttl_seconds
    normalized_path = _normalize_path(path)

    if _is_s3_backend():
        try:
            # We must explicitly add ContentType so browser JS Fetch doesn't trigger MinIO Signature errors
            params = {"Bucket": bucket, "Key": normalized_path}
            if content_type:
                params["ContentType"] = content_type

            signed_url = _get_s3_client(True).generate_presigned_url(
                "put_object",
                Params=params,
                ExpiresIn=ttl,
                HttpMethod="PUT",
            )
        except Exception as e:
            logger.error(f"S3 presign exception for {bucket}/{normalized_path}: {e}")
            raise RuntimeError(f"S3/MinIO presign failed for '{bucket}/{normalized_path}'. Details: {e}")

        return signed_url, ttl
    
    try:
        # Supabase Python SDK: create_signed_upload_url(path) - no TTL param
        response = client.storage.from_(bucket).create_signed_upload_url(normalized_path)
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
    normalized_path = _normalize_path(path)
    if _is_s3_backend():
        return _build_s3_public_url(bucket, normalized_path)
    return client.storage.from_(bucket).get_public_url(normalized_path)


def upload_file(
    client: Client,
    bucket: str,
    path: str,
    local_path: str,
    content_type: str | None = None,
) -> str:
    normalized_path = _normalize_path(path)

    if _is_s3_backend():
        s3_client = _get_s3_client(False)
        extra_args = {"ContentType": content_type} if content_type else None
        try:
            if extra_args:
                s3_client.upload_file(local_path, bucket, normalized_path, ExtraArgs=extra_args)
            else:
                s3_client.upload_file(local_path, bucket, normalized_path)
        except Exception as e:
            logger.error(f"S3 upload exception for {bucket}/{normalized_path}: {e}")
            raise RuntimeError(f"S3/MinIO upload failed for '{bucket}/{normalized_path}'. Details: {e}")
        return public_url(client, bucket, normalized_path)

    options = {"x-upsert": "true"}
    if content_type:
        options["content-type"] = content_type

    try:
        client.storage.from_(bucket).upload(normalized_path, local_path, options)
    except Exception as e:
        logger.error(f"Storage upload exception for {bucket}/{normalized_path}: {e}")
        raise RuntimeError(f"Storage upload failed for '{bucket}/{normalized_path}'. Details: {e}")

    return public_url(client, bucket, normalized_path)
