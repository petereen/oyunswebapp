# MinIO Storage Migration

This runbook moves only object storage to your VPS.

- Database stays on Supabase.
- API and legacy bot switch to MinIO-compatible S3 storage.
- Existing DB rows that store full Supabase storage URLs must be rewritten to the new MinIO public base URL.

## What Changed In Code

The app now supports a storage backend switch:

- `STORAGE_BACKEND=supabase` keeps current behavior.
- `STORAGE_BACKEND=s3` uses MinIO or any S3-compatible object store.

Touched code:

- `backend/storage.py` now supports S3-compatible presigned uploads and server-side uploads.
- `oyunsbot.py` now uses the shared storage helper, so bot uploads move with the same env switch.

## 1. Deploy MinIO On The VPS

Use MinIO behind HTTPS. For the fastest cutover, keep buckets public-read so your current URL-based data model still works.

This repo now includes `minio` and `minio-init` services in `docker-compose.yml`.

Install and initialize them with:

```bash
docker compose up -d minio
docker compose run --rm minio-init
```

If you want to see the raw service shape, it is equivalent to:

```yaml
services:
  minio:
    image: quay.io/minio/minio:latest
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: ${MINIO_ROOT_USER}
      MINIO_ROOT_PASSWORD: ${MINIO_ROOT_PASSWORD}
    volumes:
      - ./minio/data:/data
    restart: unless-stopped
```

Recommended domains:

- `https://s3.your-domain.com` for the S3 API
- `https://minio.your-domain.com` for the MinIO console

If you expose MinIO through Nginx, route the API domain to port `9000` and the console domain to port `9001`.

If you do not have a separate `s3.` subdomain, use the same app domain with different HTTPS ports instead:

- `https://app.oyuns.mn:9443` for the S3 API
- `https://app.oyuns.mn:9444` for the MinIO console

That is safer than trying to serve MinIO behind a path prefix like `/s3`. Presigned S3 URLs are signed against the full request path, so path-prefix proxying is easy to break.

## 2. Create Buckets

This repo currently needs these upload buckets:

- `passports`
- `bills`

Do not run `mc` directly on the VPS unless you installed the MinIO client on the host.
This repo already includes `mc` inside the `minio-init` container, so use that.

Create the buckets with:

```bash
docker compose run --rm minio-init
```

If you want to run `mc` commands manually, run them through the container:

```bash
docker compose run --rm minio-init /bin/sh -c '
until mc alias set local http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD"; do sleep 2; done
mc mb --ignore-existing local/passports
mc mb --ignore-existing local/bills
'
```

For immediate compatibility with the current app, allow public downloads:

```bash
docker compose run --rm minio-init /bin/sh -c '
until mc alias set local http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD"; do sleep 2; done
mc anonymous set download local/passports
mc anonymous set download local/bills
'
```

## 3. Configure Browser CORS

The frontend uploads directly from the browser using presigned `PUT` URLs, so MinIO needs CORS.

For this repo, the recommended immediate fix is to let Nginx handle CORS on the MinIO API port `9443`.
That avoids the `mc cors set ... decoding xml: EOF` issue entirely.

Create `minio-cors.json`:

```json
{
  "CORSRules": [
    {
      "AllowedOrigins": ["https://your-app-domain.com"],
      "AllowedMethods": ["GET", "PUT", "POST", "HEAD"],
      "AllowedHeaders": ["*"],
      "ExposeHeaders": ["ETag"],
      "MaxAgeSeconds": 3000
    }
  ]
}
```

Apply it:

```bash
docker compose run --rm minio-init /bin/sh -c '
until mc alias set local http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD"; do sleep 2; done
mc cors set local/passports /config/cors.json
mc cors set local/bills /config/cors.json
mc cors info local/passports
mc cors info local/bills
'
```

If `mc cors set` keeps failing with `decoding xml: EOF`, skip the bucket-level CORS step and rely on the Nginx proxy CORS headers in `nginx/conf.d/app.conf`.
After updating Nginx, restart it:

```bash
docker compose up -d nginx
```

If you prefer having `mc` available directly on the VPS host, install it first:

```bash
curl -L https://dl.min.io/client/mc/release/linux-amd64/mc -o /usr/local/bin/mc
chmod +x /usr/local/bin/mc
mc --version
```

## 4. App Environment Variables

Keep your current Supabase DB settings. Only add the storage variables below.

```env
STORAGE_BACKEND=s3
S3_ENDPOINT_URL=https://s3.your-domain.com
S3_PRESIGN_ENDPOINT_URL=https://s3.your-domain.com
S3_PUBLIC_BASE_URL=https://s3.your-domain.com
S3_ACCESS_KEY=replace-with-minio-access-key
S3_SECRET_KEY=replace-with-minio-secret-key
S3_REGION=us-east-1
S3_ADDRESSING_STYLE=path
```

If you are reusing the existing app domain without a dedicated `s3.` subdomain, use:

```env
STORAGE_BACKEND=s3
S3_ENDPOINT_URL=https://app.oyuns.mn:9443
S3_PRESIGN_ENDPOINT_URL=https://app.oyuns.mn:9443
S3_PUBLIC_BASE_URL=https://app.oyuns.mn:9443
S3_ACCESS_KEY=replace-with-minio-access-key
S3_SECRET_KEY=replace-with-minio-secret-key
S3_REGION=us-east-1
S3_ADDRESSING_STYLE=path
```

Notes:

- `S3_ENDPOINT_URL` is used by the API and legacy bot for server-side uploads.
- `S3_PRESIGN_ENDPOINT_URL` is the URL baked into browser-upload presigned links.
- `S3_PUBLIC_BASE_URL` is the base used to build the stored public URLs.
- Keep `S3_ADDRESSING_STYLE=path` unless you deliberately configure virtual-host-style bucket routing.

## 5. Migrate Existing Objects

Because this app stores full public URLs in the database, the migration has two separate steps:

1. Copy the objects from Supabase Storage to MinIO.
2. Rewrite the stored URLs in the database to point to the new MinIO base URL.

Use the steps below in order.

### 5.0. Safety Backup

Before changing anything, take a database backup or at minimum export the affected columns:

- `users.passport_storage_url`
- `transactions.bill_url`
- `transactions.receipt_id`
- `transactions.admin_bill_url`
- `admin_bank_accounts.logo_url`
- `fuel_admin_bank_accounts.logo_url`
- `gifts.sender_receipt_url`
- `gifts.admin_bill_url`
- `gifts.gift_card_url` if you also move the `gift_card` bucket

### 5.1. Export All Existing Storage URLs From Supabase

Run this query in the Supabase SQL editor and export the result as CSV.
Name it something like `storage-urls-export.csv`.

Replace these placeholders first:

- `https://<your-project>.supabase.co/storage/v1/object/public/`
- `https://app.oyuns.mn:9443/` or your actual MinIO public base URL

```sql
WITH settings AS (
  SELECT
    'https://<your-project>.supabase.co/storage/v1/object/public/'::text AS old_base,
    'https://app.oyuns.mn:9443/'::text AS new_base
),
raw_urls AS (
  SELECT 'users'::text AS source_table, 'passport_storage_url'::text AS source_column, id::text AS row_id, passport_storage_url AS old_url
  FROM public.users
  WHERE passport_storage_url LIKE 'https://%/storage/v1/object/public/%'

  UNION ALL

  SELECT 'transactions', 'bill_url', id::text, bill_url
  FROM public.transactions
  WHERE bill_url LIKE 'https://%/storage/v1/object/public/%'

  UNION ALL

  SELECT 'transactions', 'bill_url', t.id::text, elem.value
  FROM public.transactions t,
       LATERAL jsonb_array_elements_text(t.bill_url::jsonb) AS elem(value)
  WHERE t.bill_url LIKE '[%'

  UNION ALL

  SELECT 'transactions', 'receipt_id', id::text, receipt_id
  FROM public.transactions
  WHERE receipt_id LIKE 'https://%/storage/v1/object/public/%'

  UNION ALL

  SELECT 'transactions', 'admin_bill_url', id::text, admin_bill_url
  FROM public.transactions
  WHERE admin_bill_url LIKE 'https://%/storage/v1/object/public/%'

  UNION ALL

  SELECT 'transactions', 'admin_bill_url', t.id::text, elem.value
  FROM public.transactions t,
       LATERAL jsonb_array_elements_text(t.admin_bill_url::jsonb) AS elem(value)
  WHERE t.admin_bill_url LIKE '[%'

  UNION ALL

  SELECT 'admin_bank_accounts', 'logo_url', id::text, logo_url
  FROM public.admin_bank_accounts
  WHERE logo_url LIKE 'https://%/storage/v1/object/public/%'

  UNION ALL

  SELECT 'fuel_admin_bank_accounts', 'logo_url', id::text, logo_url
  FROM public.fuel_admin_bank_accounts
  WHERE logo_url LIKE 'https://%/storage/v1/object/public/%'

  UNION ALL

  SELECT 'gifts', 'sender_receipt_url', id::text, sender_receipt_url
  FROM public.gifts
  WHERE sender_receipt_url LIKE 'https://%/storage/v1/object/public/%'

  UNION ALL

  SELECT 'gifts', 'admin_bill_url', id::text, admin_bill_url
  FROM public.gifts
  WHERE admin_bill_url LIKE 'https://%/storage/v1/object/public/%'

  UNION ALL

  SELECT 'gifts', 'admin_bill_url', g.id::text, elem.value
  FROM public.gifts g,
       LATERAL jsonb_array_elements_text(g.admin_bill_url::jsonb) AS elem(value)
  WHERE g.admin_bill_url LIKE '[%'

  UNION ALL

  SELECT 'gifts', 'gift_card_url', id::text, gift_card_url
  FROM public.gifts
  WHERE gift_card_url LIKE 'https://%/storage/v1/object/public/%'
),
normalized AS (
  SELECT DISTINCT
    source_table,
    source_column,
    row_id,
    old_url,
    REPLACE(old_url, settings.old_base, '') AS relative_path,
    settings.new_base
  FROM raw_urls
  CROSS JOIN settings
  WHERE old_url IS NOT NULL
),
parsed AS (
  SELECT
    source_table,
    source_column,
    row_id,
    old_url,
    split_part(relative_path, '/', 1) AS bucket,
    substring(relative_path FROM length(split_part(relative_path, '/', 1)) + 2) AS object_key,
    new_base || relative_path AS new_url
  FROM normalized
)
SELECT *
FROM parsed
ORDER BY bucket, object_key, source_table, source_column, row_id;
```

### 5.2. Check What Will Be Migrated

Before copying files, inspect the export with these checks in Supabase:

```sql
SELECT 'users.passport_storage_url' AS source, COUNT(*)
FROM public.users
WHERE passport_storage_url LIKE 'https://%/storage/v1/object/public/%'

UNION ALL

SELECT 'transactions.bill_url', COUNT(*)
FROM public.transactions
WHERE bill_url LIKE '%https://%/storage/v1/object/public/%'

UNION ALL

SELECT 'transactions.receipt_id', COUNT(*)
FROM public.transactions
WHERE receipt_id LIKE 'https://%/storage/v1/object/public/%'

UNION ALL

SELECT 'transactions.admin_bill_url', COUNT(*)
FROM public.transactions
WHERE admin_bill_url LIKE '%https://%/storage/v1/object/public/%'

UNION ALL

SELECT 'admin_bank_accounts.logo_url', COUNT(*)
FROM public.admin_bank_accounts
WHERE logo_url LIKE 'https://%/storage/v1/object/public/%'

UNION ALL

SELECT 'fuel_admin_bank_accounts.logo_url', COUNT(*)
FROM public.fuel_admin_bank_accounts
WHERE logo_url LIKE 'https://%/storage/v1/object/public/%'

UNION ALL

SELECT 'gifts.sender_receipt_url', COUNT(*)
FROM public.gifts
WHERE sender_receipt_url LIKE 'https://%/storage/v1/object/public/%'

UNION ALL

SELECT 'gifts.admin_bill_url', COUNT(*)
FROM public.gifts
WHERE admin_bill_url LIKE '%https://%/storage/v1/object/public/%'

UNION ALL

SELECT 'gifts.gift_card_url', COUNT(*)
FROM public.gifts
WHERE gift_card_url LIKE 'https://%/storage/v1/object/public/%';
```

### 5.1. Copy Objects

Copy the exported URLs with the helper script in this repo:

```bash
python scripts/copy_storage_urls_to_minio.py \
  --input-csv storage-urls-export.csv \
  --endpoint-url https://app.oyuns.mn:9443 \
  --access-key "$S3_ACCESS_KEY" \
  --secret-key "$S3_SECRET_KEY" \
  --skip-existing
```

Dry run first if you want to verify the object list without uploading:

```bash
python scripts/copy_storage_urls_to_minio.py \
  --input-csv storage-urls-export.csv \
  --endpoint-url https://app.oyuns.mn:9443 \
  --access-key "$S3_ACCESS_KEY" \
  --secret-key "$S3_SECRET_KEY" \
  --skip-existing \
  --dry-run
```

If the script reports failures, it writes them to `failed-storage-urls.csv`.

Minimum buckets to copy for the immediate fix:

- `passports`
- `bills`

Optional additional buckets if you want a full storage cutover:

- `gift_card`

When copying, preserve the same object keys. The current code already generates stable paths such as:

- `passports/<filename>`
- `bills/<filename>`
- `bills/bank-logos/<filename>`

After the copy completes, rerun the export query from step `5.1` and verify that every `old_url` now loads from the corresponding `new_url`.

## 6. Rewrite Stored URLs In Supabase DB

Replace the old Supabase public URL prefix:

```text
https://<your-project>.supabase.co/storage/v1/object/public
```

with the new MinIO public base URL:

```text
https://s3.your-domain.com
```

If you are reusing the main app domain without a dedicated `s3.` subdomain, replace it with:

```text
https://app.oyuns.mn:9443
```

Columns that need rewriting for the immediate storage cutover:

- `users.passport_storage_url`
- `transactions.bill_url`
- `transactions.receipt_id` when it contains a URL instead of a Telegram file id
- `transactions.admin_bill_url`
- `admin_bank_accounts.logo_url`
- `fuel_admin_bank_accounts.logo_url`
- `gifts.sender_receipt_url`
- `gifts.admin_bill_url`
- `gifts.gift_card_url` if you also migrate the `gift_card` bucket

Run the rewrite only after the files are already in MinIO.

SQL template:

```sql
UPDATE users
SET passport_storage_url = REPLACE(
  passport_storage_url,
  'https://ldolpsylyatkxqsgxhkn.supabase.co/storage/v1/object/public/passports/',
  'https://app.oyuns.mn:9443/passports/'
)
WHERE passport_storage_url LIKE 'https://ldolpsylyatkxqsgxhkn.supabase.co/storage/v1/object/public/passports/%';

UPDATE transactions
SET bill_url = REPLACE(
  bill_url,
  'https://ldolpsylyatkxqsgxhkn.supabase.co/storage/v1/object/public/bills/',
  'https://app.oyuns.mn:9443/bills/'
)
WHERE bill_url LIKE '%https://ldolpsylyatkxqsgxhkn.supabase.co/storage/v1/object/public/bills/%';

UPDATE transactions
SET receipt_id = REPLACE(
  receipt_id,
  'https://ldolpsylyatkxqsgxhkn.supabase.co/storage/v1/object/public/bills/',
  'https://app.oyuns.mn:9443/bills/'
)
WHERE receipt_id LIKE 'https://ldolpsylyatkxqsgxhkn.supabase.co/storage/v1/object/public/bills/%';

UPDATE transactions
SET admin_bill_url = REPLACE(
  admin_bill_url,
  'https://ldolpsylyatkxqsgxhkn.supabase.co/storage/v1/object/public/bills/',
  'https://app.oyuns.mn:9443/bills/'
)
WHERE admin_bill_url LIKE '%https://ldolpsylyatkxqsgxhkn.supabase.co/storage/v1/object/public/bills/%';

UPDATE admin_bank_accounts
SET logo_url = REPLACE(
  logo_url,
  'https://ldolpsylyatkxqsgxhkn.supabase.co/storage/v1/object/public/bills/',
  'https://app.oyuns.mn:9443/bills/'
)
WHERE logo_url LIKE 'https://ldolpsylyatkxqsgxhkn.supabase.co/storage/v1/object/public/bills/%';

UPDATE fuel_admin_bank_accounts
SET logo_url = REPLACE(
  logo_url,
  'https://ldolpsylyatkxqsgxhkn.supabase.co/storage/v1/object/public/bills/',
  'https://app.oyuns.mn:9443/bills/'
)
WHERE logo_url LIKE 'https://ldolpsylyatkxqsgxhkn.supabase.co/storage/v1/object/public/bills/%';

UPDATE gifts
SET sender_receipt_url = REPLACE(
  sender_receipt_url,
  'https://ldolpsylyatkxqsgxhkn.supabase.co/storage/v1/object/public/bills/',
  'https://app.oyuns.mn:9443/bills/'
)
WHERE sender_receipt_url LIKE 'https://ldolpsylyatkxqsgxhkn.supabase.co/storage/v1/object/public/bills/%';

UPDATE gifts
SET admin_bill_url = REPLACE(
  admin_bill_url,
  'https://ldolpsylyatkxqsgxhkn.supabase.co/storage/v1/object/public/bills/',
  'https://app.oyuns.mn:9443/bills/'
)
WHERE admin_bill_url LIKE '%https://ldolpsylyatkxqsgxhkn.supabase.co/storage/v1/object/public/bills/%';

UPDATE gifts
SET gift_card_url = REPLACE(
  gift_card_url,
  'https://ldolpsylyatkxqsgxhkn.supabase.co/storage/v1/object/public/gift_card/',
  'https://app.oyuns.mn:9443/gift_card/'
)
WHERE gift_card_url LIKE 'https://ldolpsylyatkxqsgxhkn.supabase.co/storage/v1/object/public/gift_card/%';
```

`transactions.bill_url`, `transactions.admin_bill_url`, and `gifts.admin_bill_url` are stored as text and may contain JSON arrays of URLs. Plain `REPLACE(...)` still works because the old bucket URL appears inside that text.

### 6.1. Post-Update Verification

Run these checks immediately after the rewrite:

```sql
SELECT COUNT(*) AS remaining_old_passports
FROM public.users
WHERE passport_storage_url LIKE 'https://ldolpsylyatkxqsgxhkn.supabase.co/storage/v1/object/public/%';

SELECT COUNT(*) AS remaining_old_transaction_urls
FROM public.transactions
WHERE COALESCE(bill_url, '') LIKE '%https://ldolpsylyatkxqsgxhkn.supabase.co/storage/v1/object/public/%'
   OR COALESCE(receipt_id, '') LIKE 'https://ldolpsylyatkxqsgxhkn.supabase.co/storage/v1/object/public/%'
   OR COALESCE(admin_bill_url, '') LIKE '%https://ldolpsylyatkxqsgxhkn.supabase.co/storage/v1/object/public/%';

SELECT COUNT(*) AS remaining_old_admin_bank_logos
FROM public.admin_bank_accounts
WHERE COALESCE(logo_url, '') LIKE 'https://ldolpsylyatkxqsgxhkn.supabase.co/storage/v1/object/public/%';

SELECT COUNT(*) AS remaining_old_fuel_bank_logos
FROM public.fuel_admin_bank_accounts
WHERE COALESCE(logo_url, '') LIKE 'https://ldolpsylyatkxqsgxhkn.supabase.co/storage/v1/object/public/%';

SELECT COUNT(*) AS remaining_old_gift_urls
FROM public.gifts
WHERE COALESCE(sender_receipt_url, '') LIKE 'https://ldolpsylyatkxqsgxhkn.supabase.co/storage/v1/object/public/%'
   OR COALESCE(admin_bill_url, '') LIKE '%https://ldolpsylyatkxqsgxhkn.supabase.co/storage/v1/object/public/%'
   OR COALESCE(gift_card_url, '') LIKE 'https://ldolpsylyatkxqsgxhkn.supabase.co/storage/v1/object/public/%';
```

## 7. Restart The App

After objects are copied and DB URLs are rewritten:

```bash
docker compose up -d --build api bot frontend nginx
```

## 8. Smoke Test Checklist

Run these checks in order:

1. Upload a receipt from the web app.
2. Upload a passport through the legacy bot.
3. Upload a bank logo from admin.
4. Open an old transaction and confirm old images still load.
5. Open KYC/admin views and confirm passport URLs still resolve.

## 9. Rollback

If anything fails:

1. Set `STORAGE_BACKEND=supabase`.
2. Restart `api` and `bot`.
3. Keep the MinIO objects in place and debug before retrying.

That rollback works because the database remains on Supabase the whole time.