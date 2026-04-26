#!/usr/bin/env python3
"""
One-time migration script: copies all files that exist in Supabase Storage
into MinIO, without touching the database (URLs were already updated by SQL).

Usage on VPS:
    cd /path/to/oyunswebapp
    python3 scripts/migrate_files_to_minio.py

Requires: boto3, supabase  (already in requirements.txt)
"""

import os
import io
import sys
import logging

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

BUCKETS = ["bills", "passports"]

# ── Clients ───────────────────────────────────────────────────────────────────
def get_supabase():
    if not SUPABASE_URL or not SUPABASE_KEY:
        log.error("SUPABASE_URL / SUPABASE_KEY not set")
        sys.exit(1)
    return create_client(SUPABASE_URL, SUPABASE_KEY)


def get_s3():
    if not S3_ACCESS_KEY or not S3_SECRET_KEY:
        log.error("S3_ACCESS_KEY / S3_SECRET_KEY not set")
        sys.exit(1)
    return boto3.client(
        "s3",
        endpoint_url=S3_ENDPOINT,
        aws_access_key_id=S3_ACCESS_KEY,
        aws_secret_access_key=S3_SECRET_KEY,
        region_name=S3_REGION,
        config=BotoConfig(signature_version="s3v4", s3={"addressing_style": "path"}),
    )


# ── Helpers ───────────────────────────────────────────────────────────────────
def list_supabase_files(sb, bucket: str) -> list[str]:
    """Recursively list every file path inside a Supabase bucket."""
    paths: list[str] = []

    def _recurse(prefix: str = ""):
        try:
            items = sb.storage.from_(bucket).list(prefix) or []
        except Exception as e:
            log.warning(f"  list({bucket}/{prefix}) failed: {e}")
            return
        for item in items:
            name = item.get("name", "")
            if not name:
                continue
            full = f"{prefix}{name}" if not prefix else f"{prefix}/{name}"
            # If item has no id it's a folder – recurse
            if item.get("id") is None:
                _recurse(full)
            else:
                paths.append(full)

    _recurse()
    return paths


def file_exists_in_minio(s3, bucket: str, key: str) -> bool:
    try:
        s3.head_object(Bucket=bucket, Key=key)
        return True
    except Exception:
        return False


def copy_file(sb, s3, bucket: str, path: str) -> bool:
    """Download from Supabase and upload to MinIO. Returns True on success."""
    try:
        data: bytes = sb.storage.from_(bucket).download(path)
    except Exception as e:
        log.error(f"  ✗ Download {bucket}/{path}: {e}")
        return False

    if not data:
        log.warning(f"  ✗ Empty file {bucket}/{path}, skipping")
        return False

    # Guess content-type from extension
    ext = path.rsplit(".", 1)[-1].lower() if "." in path else ""
    ct_map = {
        "jpg": "image/jpeg", "jpeg": "image/jpeg",
        "png": "image/png", "gif": "image/gif",
        "webp": "image/webp", "pdf": "application/pdf",
    }
    content_type = ct_map.get(ext, "application/octet-stream")

    try:
        s3.put_object(
            Bucket=bucket,
            Key=path,
            Body=io.BytesIO(data),
            ContentType=content_type,
            ContentLength=len(data),
        )
    except Exception as e:
        log.error(f"  ✗ Upload {bucket}/{path}: {e}")
        return False

    return True


# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    sb = get_supabase()
    s3 = get_s3()

    total_copied = 0
    total_skipped = 0
    total_failed = 0

    for bucket in BUCKETS:
        log.info(f"\n=== Bucket: {bucket} ===")

        # Ensure bucket exists in MinIO (create if missing)
        try:
            s3.head_bucket(Bucket=bucket)
        except Exception:
            log.info(f"  Creating bucket '{bucket}' in MinIO…")
            try:
                s3.create_bucket(Bucket=bucket)
            except Exception as e:
                log.error(f"  Failed to create bucket: {e}")
                continue

        files = list_supabase_files(sb, bucket)
        log.info(f"  Found {len(files)} files in Supabase/{bucket}")

        for path in files:
            if file_exists_in_minio(s3, bucket, path):
                log.info(f"  → skip (exists) {path}")
                total_skipped += 1
                continue

            log.info(f"  → copy {path} ({bucket})")
            ok = copy_file(sb, s3, bucket, path)
            if ok:
                total_copied += 1
                log.info(f"  ✓ copied {path}")
            else:
                total_failed += 1

    log.info(
        f"\n=== Done: {total_copied} copied, "
        f"{total_skipped} already existed, "
        f"{total_failed} failed ==="
    )


if __name__ == "__main__":
    main()
