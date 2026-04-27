-- ============================================================
-- Revert MinIO URLs → Supabase public URLs in all tables
--
-- Run this in the Supabase SQL editor BEFORE redeploying the
-- code that uses Supabase storage again.
--
-- MinIO URL pattern:  https://app.oyuns.mn:9443/<bucket>/<key>
-- Supabase URL pattern:
--   https://ldolpsylyatkxqsgxhkn.supabase.co/storage/v1/object/public/<bucket>/<key>
--
-- NOTE: bill_url and admin_bill_url may be stored as JSON arrays
--       like '["https://app.oyuns.mn:9443/bills/..."]'. The queries
--       below handle both plain URL strings and JSON-array strings.
-- ============================================================

-- ── transactions.receipt_id ───────────────────────────────────────────────
UPDATE transactions
SET receipt_id = REPLACE(
    receipt_id,
    'https://app.oyuns.mn:9443/',
    'https://ldolpsylyatkxqsgxhkn.supabase.co/storage/v1/object/public/'
)
WHERE receipt_id LIKE 'https://app.oyuns.mn:9443/%';

-- ── transactions.bill_url (may be plain URL or JSON array string) ─────────
UPDATE transactions
SET bill_url = REPLACE(
    bill_url,
    'https://app.oyuns.mn:9443/',
    'https://ldolpsylyatkxqsgxhkn.supabase.co/storage/v1/object/public/'
)
WHERE bill_url LIKE '%https://app.oyuns.mn:9443/%';

-- ── transactions.admin_bill_url (may be plain URL or JSON array string) ──
UPDATE transactions
SET admin_bill_url = REPLACE(
    admin_bill_url,
    'https://app.oyuns.mn:9443/',
    'https://ldolpsylyatkxqsgxhkn.supabase.co/storage/v1/object/public/'
)
WHERE admin_bill_url LIKE '%https://app.oyuns.mn:9443/%';

-- ── users.passport_storage_url ────────────────────────────────────────────
UPDATE users
SET passport_storage_url = REPLACE(
    passport_storage_url,
    'https://app.oyuns.mn:9443/',
    'https://ldolpsylyatkxqsgxhkn.supabase.co/storage/v1/object/public/'
)
WHERE passport_storage_url LIKE 'https://app.oyuns.mn:9443/%';

-- ── admin_bank_accounts.logo_url ─────────────────────────────────────────
UPDATE admin_bank_accounts
SET logo_url = REPLACE(
    logo_url,
    'https://app.oyuns.mn:9443/',
    'https://ldolpsylyatkxqsgxhkn.supabase.co/storage/v1/object/public/'
)
WHERE logo_url LIKE 'https://app.oyuns.mn:9443/%';

-- ── gifts.sender_receipt_url ─────────────────────────────────────────────
UPDATE gifts
SET sender_receipt_url = REPLACE(
    sender_receipt_url,
    'https://app.oyuns.mn:9443/',
    'https://ldolpsylyatkxqsgxhkn.supabase.co/storage/v1/object/public/'
)
WHERE sender_receipt_url LIKE 'https://app.oyuns.mn:9443/%';

-- ── gifts.admin_bill_url ─────────────────────────────────────────────────
UPDATE gifts
SET admin_bill_url = REPLACE(
    admin_bill_url,
    'https://app.oyuns.mn:9443/',
    'https://ldolpsylyatkxqsgxhkn.supabase.co/storage/v1/object/public/'
)
WHERE admin_bill_url LIKE '%https://app.oyuns.mn:9443/%';

-- ── fuel_orders.payment_receipt_url ──────────────────────────────────────
UPDATE fuel_orders
SET payment_receipt_url = REPLACE(
    payment_receipt_url,
    'https://app.oyuns.mn:9443/',
    'https://ldolpsylyatkxqsgxhkn.supabase.co/storage/v1/object/public/'
)
WHERE payment_receipt_url LIKE 'https://app.oyuns.mn:9443/%';

-- ── fuel_orders.pump_photo_url ───────────────────────────────────────────
UPDATE fuel_orders
SET pump_photo_url = REPLACE(
    pump_photo_url,
    'https://app.oyuns.mn:9443/',
    'https://ldolpsylyatkxqsgxhkn.supabase.co/storage/v1/object/public/'
)
WHERE pump_photo_url LIKE 'https://app.oyuns.mn:9443/%';

-- ── fuel_orders.approval_image_url ───────────────────────────────────────
UPDATE fuel_orders
SET approval_image_url = REPLACE(
    approval_image_url,
    'https://app.oyuns.mn:9443/',
    'https://ldolpsylyatkxqsgxhkn.supabase.co/storage/v1/object/public/'
)
WHERE approval_image_url LIKE 'https://app.oyuns.mn:9443/%';

-- ── Verify: count remaining MinIO URLs per table ──────────────────────────
-- Run this block after the updates to confirm nothing was missed.
SELECT 'transactions.receipt_id'    AS col, COUNT(*) AS remaining FROM transactions     WHERE receipt_id        LIKE '%app.oyuns.mn:9443%'
UNION ALL
SELECT 'transactions.bill_url',            COUNT(*)              FROM transactions     WHERE bill_url          LIKE '%app.oyuns.mn:9443%'
UNION ALL
SELECT 'transactions.admin_bill_url',      COUNT(*)              FROM transactions     WHERE admin_bill_url    LIKE '%app.oyuns.mn:9443%'
UNION ALL
SELECT 'users.passport_storage_url',       COUNT(*)              FROM users            WHERE passport_storage_url LIKE '%app.oyuns.mn:9443%'
UNION ALL
SELECT 'admin_bank_accounts.logo_url',     COUNT(*)              FROM admin_bank_accounts WHERE logo_url       LIKE '%app.oyuns.mn:9443%'
UNION ALL
SELECT 'gifts.sender_receipt_url',         COUNT(*)              FROM gifts            WHERE sender_receipt_url LIKE '%app.oyuns.mn:9443%'
UNION ALL
SELECT 'gifts.admin_bill_url',             COUNT(*)              FROM gifts            WHERE admin_bill_url    LIKE '%app.oyuns.mn:9443%'
UNION ALL
SELECT 'fuel_orders.payment_receipt_url',  COUNT(*)              FROM fuel_orders      WHERE payment_receipt_url LIKE '%app.oyuns.mn:9443%'
UNION ALL
SELECT 'fuel_orders.pump_photo_url',       COUNT(*)              FROM fuel_orders      WHERE pump_photo_url    LIKE '%app.oyuns.mn:9443%'
UNION ALL
SELECT 'fuel_orders.approval_image_url',   COUNT(*)              FROM fuel_orders      WHERE approval_image_url LIKE '%app.oyuns.mn:9443%';
