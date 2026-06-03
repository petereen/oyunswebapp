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
    admin_id      BIGINT REFERENCES public.admin_users(id) ON UPDATE CASCADE ON DELETE SET NULL,
    -- Админы өмнөх өдрийн баланс (RUB). Editable; carried by the admin.
    prev_balance  NUMERIC NOT NULL DEFAULT 0,
    -- Өнөөдрийн руб→төг чиглэлийн дүн (RUB). Admin-entered daily figure.
    rub_to_mnt    NUMERIC NOT NULL DEFAULT 0,
    -- Өнөөдрийн төг→руб чиглэлийн дүн (RUB). Admin-entered daily figure.
    mnt_to_rub    NUMERIC NOT NULL DEFAULT 0,
    -- Empty +/- adjustment field (default 0).
    adjustment    NUMERIC NOT NULL DEFAULT 0,
    -- Moscow calendar day the daily figures belong to (used for rollover).
    balance_date  DATE,
    currency      TEXT NOT NULL DEFAULT 'RUB',
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    display_order INTEGER NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Upgrade existing installs (idempotent — safe to re-run).
ALTER TABLE treasury_accounts ADD COLUMN IF NOT EXISTS rub_to_mnt   NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE treasury_accounts ADD COLUMN IF NOT EXISTS mnt_to_rub   NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE treasury_accounts ADD COLUMN IF NOT EXISTS balance_date DATE;
ALTER TABLE treasury_accounts ADD COLUMN IF NOT EXISTS admin_id      BIGINT;

CREATE INDEX IF NOT EXISTS idx_treasury_accounts_order
    ON treasury_accounts(display_order);

CREATE INDEX IF NOT EXISTS idx_treasury_accounts_admin_order
    ON treasury_accounts(admin_id, display_order);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'treasury_accounts_admin_id_fkey'
          AND conrelid = 'treasury_accounts'::regclass
    ) THEN
        ALTER TABLE treasury_accounts
            ADD CONSTRAINT treasury_accounts_admin_id_fkey
            FOREIGN KEY (admin_id)
            REFERENCES public.admin_users(id)
            ON UPDATE CASCADE
            ON DELETE SET NULL
            NOT VALID;
    END IF;
END $$;

-- ── General daily balance calculator ────────────────────────────────────────
-- One row per admin per Moscow day. opening_balance is carried from the
-- previous day's entered closing balance; entered_balance is the actual amount
-- the admin reports for the current day.
CREATE TABLE IF NOT EXISTS dashboard_balance_daily (
    admin_id        BIGINT NOT NULL REFERENCES public.admin_users(id) ON UPDATE CASCADE ON DELETE CASCADE,
    balance_date    DATE NOT NULL,
    opening_balance NUMERIC NOT NULL DEFAULT 0,
    entered_balance NUMERIC,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (admin_id, balance_date)
);

ALTER TABLE dashboard_balance_daily ADD COLUMN IF NOT EXISTS opening_balance NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE dashboard_balance_daily ADD COLUMN IF NOT EXISTS entered_balance NUMERIC;
ALTER TABLE dashboard_balance_daily ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE dashboard_balance_daily ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_dashboard_balance_daily_date
    ON dashboard_balance_daily(balance_date DESC, admin_id);

-- Tagged +/- manual income/expense items that affect the day's calculated
-- closing balance.
CREATE TABLE IF NOT EXISTS dashboard_balance_adjustments (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id    BIGINT NOT NULL REFERENCES public.admin_users(id) ON UPDATE CASCADE ON DELETE CASCADE,
    balance_date DATE NOT NULL,
    amount      NUMERIC NOT NULL,
    tag         TEXT NOT NULL,
    description TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE dashboard_balance_adjustments ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE dashboard_balance_adjustments ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE dashboard_balance_adjustments ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_dashboard_balance_adjustments_day_admin
    ON dashboard_balance_adjustments(balance_date DESC, admin_id, created_at);

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

-- ── Manual plane-ticket sales ───────────────────────────────────────────────
-- The dashboard stores ticket sales as sold MNT amounts. The backend snapshots
-- the latest sell rate plus the effective cost rate for the selected date so
-- the entry contributes to the profit calculator like a manual MNT→RUB sale.
CREATE TABLE IF NOT EXISTS plane_ticket_sales (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sale_date        DATE NOT NULL,
    sold_price_mnt   NUMERIC NOT NULL,
    exchange_rate    NUMERIC NOT NULL,
    cost_rate        NUMERIC NOT NULL,
    rub_equivalent   NUMERIC NOT NULL DEFAULT 0,
    profit_mnt       NUMERIC NOT NULL DEFAULT 0,
    note             TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_plane_ticket_sales_date
    ON plane_ticket_sales(sale_date DESC);

-- ── Row Level Security ───────────────────────────────────────────────────────
-- These tables are only ever accessed by the backend (service-role key, which
-- bypasses RLS). Enabling RLS with no policies blocks the public anon key, so
-- treasury balances and cost rates are not exposed through the public REST API.
ALTER TABLE treasury_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE dashboard_balance_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE dashboard_balance_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE cost_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE plane_ticket_sales ENABLE ROW LEVEL SECURITY;

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

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'update_updated_at_column') THEN
        DROP TRIGGER IF EXISTS update_dashboard_balance_daily_updated_at ON dashboard_balance_daily;
        CREATE TRIGGER update_dashboard_balance_daily_updated_at
            BEFORE UPDATE ON dashboard_balance_daily
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;
END $$;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'update_updated_at_column') THEN
        DROP TRIGGER IF EXISTS update_dashboard_balance_adjustments_updated_at ON dashboard_balance_adjustments;
        CREATE TRIGGER update_dashboard_balance_adjustments_updated_at
            BEFORE UPDATE ON dashboard_balance_adjustments
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;
END $$;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'update_updated_at_column') THEN
        DROP TRIGGER IF EXISTS update_plane_ticket_sales_updated_at ON plane_ticket_sales;
        CREATE TRIGGER update_plane_ticket_sales_updated_at
            BEFORE UPDATE ON plane_ticket_sales
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;
END $$;
