-- ============================================================================
-- Balance accounting + Profit calculator tables (standalone dashboard, Page 1)
-- ----------------------------------------------------------------------------
-- Run this in the Supabase SQL editor.
-- ============================================================================

-- ── Treasury accounts ───────────────────────────────────────────────────────
-- The admin's own RUB balance accounts used for daily balance accounting.
-- These are SEPARATE from `admin_bank_accounts` (the cards users pay into).
CREATE TABLE IF NOT EXISTS treasury_accounts (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name          TEXT NOT NULL,
    -- Админы өмнөх өдрийн баланс (RUB). Editable; carried by the admin.
    prev_balance  NUMERIC NOT NULL DEFAULT 0,
    -- Empty +/- adjustment field (default 0).
    adjustment    NUMERIC NOT NULL DEFAULT 0,
    currency      TEXT NOT NULL DEFAULT 'RUB',
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    display_order INTEGER NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_treasury_accounts_order
    ON treasury_accounts(display_order);

-- ── Cost rates (өртөг ханш) per date ─────────────────────────────────────────
-- black_rate is fetched from Google Sheets, usd_rate is entered by the admin,
-- cost_rate = usd_rate / black_rate (computed server-side on save).
CREATE TABLE IF NOT EXISTS cost_rates (
    rate_date   DATE PRIMARY KEY,
    usd_rate    NUMERIC,
    black_rate  NUMERIC,
    cost_rate   NUMERIC,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Row Level Security ───────────────────────────────────────────────────────
-- These tables are only ever accessed by the backend (service-role key, which
-- bypasses RLS). Enabling RLS with no policies blocks the public anon key, so
-- treasury balances and cost rates are not exposed through the public REST API.
ALTER TABLE treasury_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE cost_rates ENABLE ROW LEVEL SECURITY;

-- ── updated_at trigger (reuses the project's shared function if present) ──────
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'update_updated_at_column') THEN
        DROP TRIGGER IF EXISTS update_treasury_accounts_updated_at ON treasury_accounts;
        CREATE TRIGGER update_treasury_accounts_updated_at
            BEFORE UPDATE ON treasury_accounts
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;
END $$;
