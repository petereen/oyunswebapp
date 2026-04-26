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

Create them with `mc`:

```bash
mc alias set local http://127.0.0.1:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD"
mc mb --ignore-existing local/passports
mc mb --ignore-existing local/bills
```

For immediate compatibility with the current app, allow public downloads:

```bash
mc anonymous set download local/passports
mc anonymous set download local/bills
```

## 3. Configure Browser CORS

The frontend uploads directly from the browser using presigned `PUT` URLs, so MinIO needs CORS.

Create `minio-cors.json`:

```json
[
  {
    "AllowedOrigins": ["https://your-app-domain.com"],
    "AllowedMethods": ["GET", "PUT", "POST", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3000
  }
]
```

Apply it:

```bash
mc cors set local/passports ./minio-cors.json
mc cors set local/bills ./minio-cors.json
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

### 5.1. Copy Objects

Minimum buckets to copy for the immediate fix:

- `passports`
- `bills`

Optional additional buckets if you want a full storage cutover:

- `gift_card`

When copying, preserve the same object keys. The current code already generates stable paths such as:

- `passports/<filename>`
- `bills/<filename>`
- `bills/bank-logos/<filename>`

If you already have the files downloaded locally, upload them with `mc cp` or `mc mirror`.

If you only have Supabase public URLs, copy each object to the same bucket and object key on MinIO.

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
- `admin_bank_accounts.logo_url`
- `fuel_admin_bank_accounts.logo_url`
- `gifts.admin_bill_url`

SQL template:

```sql
UPDATE users
SET passport_storage_url = REPLACE(
  passport_storage_url,
  'https://<your-project>.supabase.co/storage/v1/object/public/passports/',
  'https://s3.your-domain.com/passports/'
)
WHERE passport_storage_url LIKE 'https://<your-project>.supabase.co/storage/v1/object/public/passports/%';

UPDATE transactions
SET bill_url = REPLACE(
  bill_url,
  'https://<your-project>.supabase.co/storage/v1/object/public/bills/',
  'https://s3.your-domain.com/bills/'
)
WHERE bill_url LIKE '%https://<your-project>.supabase.co/storage/v1/object/public/bills/%';

UPDATE transactions
SET receipt_id = REPLACE(
  receipt_id,
  'https://<your-project>.supabase.co/storage/v1/object/public/bills/',
  'https://s3.your-domain.com/bills/'
)
WHERE receipt_id LIKE 'https://<your-project>.supabase.co/storage/v1/object/public/bills/%';

UPDATE admin_bank_accounts
SET logo_url = REPLACE(
  logo_url,
  'https://<your-project>.supabase.co/storage/v1/object/public/bills/',
  'https://s3.your-domain.com/bills/'
)
WHERE logo_url LIKE 'https://<your-project>.supabase.co/storage/v1/object/public/bills/%';

UPDATE fuel_admin_bank_accounts
SET logo_url = REPLACE(
  logo_url,
  'https://<your-project>.supabase.co/storage/v1/object/public/bills/',
  'https://s3.your-domain.com/bills/'
)
WHERE logo_url LIKE 'https://<your-project>.supabase.co/storage/v1/object/public/bills/%';

UPDATE gifts
SET admin_bill_url = REPLACE(
  admin_bill_url,
  'https://<your-project>.supabase.co/storage/v1/object/public/bills/',
  'https://s3.your-domain.com/bills/'
)
WHERE admin_bill_url LIKE '%https://<your-project>.supabase.co/storage/v1/object/public/bills/%';
```

`transactions.bill_url` and `gifts.admin_bill_url` are stored as text and may contain JSON arrays of URLs. Plain `REPLACE(...)` still works because the old bucket URL appears inside that text.

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