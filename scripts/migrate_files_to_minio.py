#!/usr/bin/env python3
"""
Migration script v2: reads every image URL directly from the database,
extracts the bucket + path, checks if that EXACT file exists in MinIO,
and if not, fetches it from Supabase and uploads it.

This is more reliable than listing bucket contents because it works
from the actual database state (what URLs are referenced).

Usage on VPS:
    docker compose cp scripts/migrate_files_to_minio.py api:/tmp/migrate.py
    docker compose exec api python3 /tmp/migrate.py

Requires: boto3, supabase  (already in requirements.txt)
"""

import io
import json
import logging
import os
import sys
from urllib.parse import urlparse, unquote

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

import boto3
from botocore.config import Config as BotoConfig
from supabase import create_client

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
log = logging.getLogger(__name__)

# ── Config ────────────────────────────────────────────────────────────────────
SUPABASE_URL = os.getenv("SUPABASE_URL", "").strip()
SUPABASE_KEY = os.getenv("SUPABASE_KEY", "").strip()

S3_ENDPOINT   = os.getenv("S3_ENDPOINT_URL", "http://minio:9000").strip()
S3_ACCESS_KEY = os.getenv("S3_ACCESS_KEY", "").strip()
S3_SECRET_KEY = os.getenv("S3_SECRET_KEY", "").strip()
S3_REGION     = os.getenv("S3_REGION", "us-east-1").strip()

# Public MinIO base (so we can identify MinIO URLs in the DB).
# Also handles the case they still have old Supabase URLs.
MINIO_HOSTS = {"app.oyuns.mn"}
SUPABASE_HOST = "ldolpsylyatkxqsgxhkn.supabase.co"

CT_MAP = {
    "jpg": "image/jpeg", "jpeg": "image/jpeg",
    "png": "image/png", "gif": "image/gif",
    "webp": "image/webp", "pdf": "application/pdf",
}


# ── Clients ───────────────────────────────────────────────────────────────────
def get_supabase():
    if not SUPABASE_URL or not SUPABASE_KEY:
        log.error("SUPABASE_URL / SUPABASE_KEY not set"); sys.exit(1)
    return create_client(SUPABASE_URL, SUPABASE_KEY)


def get_s3():
    if not S3_ACCESS_KEY or not S3_SECRET_KEY:
        log.error("S3_ACCESS_KEY / S3_SECRET_KEY not set"); sys.exit(1)
    return boto3.client(
        "s3",
        endpoint_url=S3_ENDPOINT,
        aws_access_key_id=S3_ACCESS_KEY,
        aws_secret_access_key=S3_SECRET_KEY,
        region_name=S3_REGION,
        config=BotoConfig(signature_version="s3v4", s3={"addressing_style": "path"}),
    )


# ── URL parsing ───────────────────────────────────────────────────────────────
def parse_minio_url(url: str) -> tuple[str, str] | None:
    """
    Parse a MinIO URL like https://app.oyuns.mn:9443/bills/sell/foo.jpg
    Returns (bucket, key) or None if not a MinIO URL.
    """
    if not url:
        return None
    try:
        p = urlparse(url)
        if p.hostname not in MINIO_HOSTS:
            return None
        # path = /bills/sell/foo.jpg  →  parts = ['', 'bills', 'sell', 'foo.jpg']
        parts = unquote(p.path).split("/", 2)  # max 3 parts
        if len(parts) < 3:
            return None
        bucket = parts[1]
        key = parts[2].split("?")[0]  # strip query string
        return bucket, key
    except Exception:
        return None


def parse_supabase_url(url: str) -> tuple[str, str] | None:
    """
    Parse a legacy Supabase URL like
    https://<project>.supabase.co/storage/v1/object/public/<bucket>/<key>
    Returns (bucket, key) or None.
    """
    if not url or SUPABASE_HOST not in url:
        return None
    try:
        p = urlparse(url)
        # path = /storage/v1/object/public/bills/sell/foo.jpg
        path = unquote(p.path)
        marker = "/object/public/"
        idx = path.find(marker)
        if idx == -1:
            return None
        rest = path[idx + len(marker):]
        bucket, _, key = rest.partition("/")
        return bucket, key
    except Exception:
        return None


def collect_urls_from_db(sb) -> list[tuple[str, str, str]]:
    """
    Query every table/column that stores image URLs.
    Returns list of (source_label, bucket, key).
    """
    results: list[tuple[str, str, str]] = []

    def add(label: str, url: str):
        if not url:
            return
        parsed = parse_minio_url(url) or parse_supabase_url(url)
        if parsed:
            results.append((label, parsed[0], parsed[1]))

    def add_json_array(label: str, raw: str):
        """bill_url is sometimes stored as a JSON array of URLs."""
        if not raw:
            return
        if raw.startswith("["):
            try:
                urls = json.loads(raw)
                for u in urls:
                    add(label, u)
                return
            except Exception:
                pass
        add(label, raw)

    # transactions – receipt_id, bill_url
    rows = sb.table("transactions").select("invoice,receipt_id,bill_url").execute().data or []
    for r in rows:
        add(f"tx:{r.get('invoice')}/receipt_id", r.get("receipt_id"))
        add_json_array(f"tx:{r.get('invoice')}/bill_url", r.get("bill_url"))

    # users – passport_storage_url
    rows = sb.table("users").select("id,passport_storage_url").execute().data or []
    for r in rows:
        add(f"user:{r.get('id')}/passport", r.get("passport_storage_url"))

    # admin_bank_accounts – logo_url
    rows = sb.table("admin_bank_accounts").select("id,bank_name,logo_url").execute().data or []
    for r in rows:
        add(f"bank:{r.get('id')}/{r.get('bank_name')}/logo", r.get("logo_url"))

    # gifts – sender_receipt_url
    try:
        rows = sb.table("gifts").select("id,sender_receipt_url").execute().data or []
        for r in rows:
            add(f"gift:{r.get('id')}/receipt", r.get("sender_receipt_url"))
    except Exception:
        pass

    # fuel_orders – payment_receipt_url, pump_photo_url, approval_image_url
    try:
        rows = sb.table("fuel_orders").select(
            "id,payment_receipt_url,pump_photo_url,approval_image_url"
        ).execute().data or []
        for r in rows:
            add(f"fuel:{r.get('id')}/payment", r.get("payment_receipt_url"))
            add(f"fuel:{r.get('id')}/pump",    r.get("pump_photo_url"))
            add(f"fuel:{r.get('id')}/approval", r.get("approval_image_url"))
    except Exception:
        pass

    return results


# ── Core copy logic ───────────────────────────────────────────────────────────
def file_exists_in_minio(s3, bucket: str, key: str) -> bool:
    try:
        s3.head_object(Bucket=bucket, Key=key)
        return True
    except Exception:
        return False


def ensure_bucket(s3, bucket: str):
    try:
        s3.head_bucket(Bucket=bucket)
    except Exception:
        log.info(f"  Creating bucket '{bucket}' in MinIO…")
        s3.create_bucket(Bucket=bucket)


def copy_from_supabase(sb, s3, bucket: str, key: str) -> bool:
    try:
        data: bytes = sb.storage.from_(bucket).download(key)
    except Exception as e:
        log.error(f"  ✗ Supabase download {bucket}/{key}: {e}")
        return False

    if not data:
        log.warning(f"  ✗ Empty file {bucket}/{key}, skipping")
        return False

    ext = key.rsplit(".", 1)[-1].lower() if "." in key else ""
    content_type = CT_MAP.get(ext, "application/octet-stream")

    try:
        s3.put_object(
            Bucket=bucket,
            Key=key,
            Body=io.BytesIO(data),
            ContentType=content_type,
            ContentLength=len(data),
        )
    except Exception as e:
        log.error(f"  ✗ MinIO upload {bucket}/{key}: {e}")
        return False

    return True


# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    sb = get_supabase()
    s3 = get_s3()

    log.info("Collecting image URLs from database…")
    entries = collect_urls_from_db(sb)
    log.info(f"Found {len(entries)} image references in the database.\n")

    # Deduplicate by (bucket, key)
    seen: set[tuple[str, str]] = set()
    deduped = []
    for label, bucket, key in entries:
        if (bucket, key) not in seen:
            seen.add((bucket, key))
            deduped.append((label, bucket, key))

    log.info(f"{len(deduped)} unique files to verify.\n")

    ensured_buckets: set[str] = set()
    copied = skipped = failed = 0

    for label, bucket, key in deduped:
        if bucket not in ensured_buckets:
            ensure_bucket(s3, bucket)
            ensured_buckets.add(bucket)

        if file_exists_in_minio(s3, bucket, key):
            log.info(f"  ✓ exists  [{bucket}] {key}")
            skipped += 1
            continue

        log.info(f"  → missing [{bucket}] {key}  ({label})")
        ok = copy_from_supabase(sb, s3, bucket, key)
        if ok:
            log.info(f"  ✓ copied  [{bucket}] {key}")
            copied += 1
        else:
            log.warning(f"  ✗ FAILED  [{bucket}] {key}  — file may not exist in Supabase either")
            failed += 1

    log.info(f"\n=== Done: {copied} copied, {skipped} already in MinIO, {failed} not found anywhere ===")
    if failed:
        log.warning("Files marked FAILED do not exist in Supabase — those uploads were lost and must be re-submitted.")


if __name__ == "__main__":
    main()
