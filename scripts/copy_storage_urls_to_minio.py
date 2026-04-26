import argparse
import csv
import sys
from pathlib import Path
from typing import Iterable
from urllib.parse import unquote

import boto3
import requests
from botocore.config import Config as BotoConfig
from botocore.exceptions import ClientError


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Copy Supabase public storage objects to MinIO/S3.")
    parser.add_argument("--input-csv", required=True, help="CSV exported from the SQL query in MINIO_STORAGE_MIGRATION.md")
    parser.add_argument("--endpoint-url", required=True, help="MinIO/S3 endpoint, e.g. https://app.oyuns.mn:9443")
    parser.add_argument("--access-key", required=True, help="MinIO access key")
    parser.add_argument("--secret-key", required=True, help="MinIO secret key")
    parser.add_argument("--region", default="us-east-1", help="S3 region")
    parser.add_argument("--addressing-style", default="path", choices=["path", "virtual"], help="S3 addressing style")
    parser.add_argument("--timeout", type=int, default=120, help="HTTP timeout per object in seconds")
    parser.add_argument("--skip-existing", action="store_true", help="Skip upload when the object already exists in MinIO")
    parser.add_argument("--dry-run", action="store_true", help="Print what would be copied without uploading")
    parser.add_argument("--failed-csv", default="failed-storage-urls.csv", help="Write failures to this CSV file")
    return parser.parse_args()


def make_s3_client(args: argparse.Namespace):
    return boto3.client(
        "s3",
        endpoint_url=args.endpoint_url,
        aws_access_key_id=args.access_key,
        aws_secret_access_key=args.secret_key,
        region_name=args.region,
        config=BotoConfig(signature_version="s3v4", s3={"addressing_style": args.addressing_style}),
    )


def read_rows(path: str) -> list[dict[str, str]]:
    with open(path, newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        required = {"old_url", "bucket", "object_key"}
        if not reader.fieldnames or not required.issubset(set(reader.fieldnames)):
            raise RuntimeError(f"CSV must include columns: {', '.join(sorted(required))}")
        return list(reader)


def object_exists(s3_client, bucket: str, object_key: str) -> bool:
    try:
        s3_client.head_object(Bucket=bucket, Key=object_key)
        return True
    except ClientError as exc:
        error_code = str(exc.response.get("Error", {}).get("Code", ""))
        if error_code in {"404", "NoSuchKey", "NotFound"}:
            return False
        raise


def iter_unique(rows: Iterable[dict[str, str]]) -> Iterable[dict[str, str]]:
    seen: set[tuple[str, str, str]] = set()
    for row in rows:
        old_url = (row.get("old_url") or "").strip()
        bucket = (row.get("bucket") or "").strip()
        object_key = unquote((row.get("object_key") or "").lstrip("/"))
        if not old_url or not bucket or not object_key:
            continue
        key = (old_url, bucket, object_key)
        if key in seen:
            continue
        seen.add(key)
        yield {
            **row,
            "old_url": old_url,
            "bucket": bucket,
            "object_key": object_key,
        }


def main() -> int:
    args = parse_args()
    rows = read_rows(args.input_csv)
    s3_client = make_s3_client(args)
    failures: list[dict[str, str]] = []

    total = 0
    copied = 0
    skipped = 0

    with requests.Session() as session:
        for row in iter_unique(rows):
            total += 1
            old_url = row["old_url"]
            bucket = row["bucket"]
            object_key = row["object_key"]
            source_table = row.get("source_table", "")
            source_column = row.get("source_column", "")
            row_id = row.get("row_id", "")

            try:
                if args.skip_existing and object_exists(s3_client, bucket, object_key):
                    skipped += 1
                    print(f"skip-existing {bucket}/{object_key}")
                    continue

                if args.dry_run:
                    print(f"dry-run {bucket}/{object_key} <- {old_url}")
                    continue

                response = session.get(old_url, stream=True, timeout=args.timeout)
                response.raise_for_status()

                extra_args = {}
                content_type = response.headers.get("Content-Type")
                if content_type:
                    extra_args["ContentType"] = content_type

                response.raw.decode_content = True
                if extra_args:
                    s3_client.upload_fileobj(response.raw, bucket, object_key, ExtraArgs=extra_args)
                else:
                    s3_client.upload_fileobj(response.raw, bucket, object_key)

                copied += 1
                print(f"copied {bucket}/{object_key}")
            except Exception as exc:
                failures.append(
                    {
                        "source_table": source_table,
                        "source_column": source_column,
                        "row_id": row_id,
                        "old_url": old_url,
                        "bucket": bucket,
                        "object_key": object_key,
                        "error": str(exc),
                    }
                )
                print(f"failed {bucket}/{object_key}: {exc}", file=sys.stderr)

    print(f"summary total={total} copied={copied} skipped={skipped} failed={len(failures)}")

    if failures:
        failed_path = Path(args.failed_csv)
        with failed_path.open("w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(
                handle,
                fieldnames=["source_table", "source_column", "row_id", "old_url", "bucket", "object_key", "error"],
            )
            writer.writeheader()
            writer.writerows(failures)
        print(f"wrote failures to {failed_path}", file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())