-- ==================================================
-- Oyunsbot WebApp - Database Schema Updates
-- ==================================================
-- Run these SQL commands in your Supabase SQL editor

-- ==================================================
-- 1. Admin Bank Accounts Table
-- ==================================================
-- Stores admin's bank accounts where users send money
-- Each admin can have multiple bank accounts

CREATE TABLE IF NOT EXISTS admin_bank_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bank_name VARCHAR(100) NOT NULL,
    account_number VARCHAR(50),           -- Bank account number (for MNT accounts)
    card_number VARCHAR(20),              -- Card number (for RUB accounts, format: XXXX XXXX XXXX XXXX)
    phone VARCHAR(20),                    -- Phone number linked to card (for RUB SBP transfers)
    owner_name VARCHAR(100) NOT NULL,     -- Name on the account
    currency VARCHAR(3) NOT NULL CHECK (currency IN ('RUB', 'MNT')),
    is_active BOOLEAN DEFAULT TRUE,
    display_order INT DEFAULT 0,          -- For ordering in UI
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for faster queries
CREATE INDEX IF NOT EXISTS idx_admin_bank_accounts_currency_active 
ON admin_bank_accounts(currency, is_active);

-- Enable RLS (Row Level Security)
ALTER TABLE admin_bank_accounts ENABLE ROW LEVEL SECURITY;

-- Policy: Everyone can read active accounts (users need to see where to send money)
CREATE POLICY "Anyone can read active admin bank accounts" 
ON admin_bank_accounts FOR SELECT 
USING (is_active = TRUE);

-- ==================================================
-- 2. Promo Codes Table - ALREADY EXISTS
-- ==================================================
-- Your existing promo_codes table:
-- code (text, PK), aliases (text[]), discount (numeric), 
-- active (bool), created_at, expires_at, user_id, source
--
-- Discount is an AMOUNT that adjusts the exchange rate:
-- - BUY (RUB→MNT): discount is ADDED to rate (e.g., 43.5 + 0.2 = 43.7)
-- - SELL (MNT→RUB): discount is SUBTRACTED from rate (e.g., 46.5 - 0.2 = 46.3)
--
-- NO CHANGES NEEDED - table already exists

-- ==================================================
-- 3. Sample Admin Bank Accounts for Testing
-- ==================================================

-- Sample Admin RUB Bank Accounts
INSERT INTO admin_bank_accounts (bank_name, card_number, phone, owner_name, currency, display_order) VALUES
('Сбербанк', '2202 2082 3909 6994', '+79969701050', 'Тэмуулэн', 'RUB', 1),
('Тинькофф', '5536 9139 1234 5678', '+79169876543', 'Тэмуулэн', 'RUB', 2)
ON CONFLICT DO NOTHING;

-- Sample Admin MNT Bank Account (universal account for all sell transactions)
INSERT INTO admin_bank_accounts (bank_name, account_number, owner_name, currency, display_order) VALUES
('Хаан банк', '5089070012345678', 'Oyunsbot', 'MNT', 1)
ON CONFLICT DO NOTHING;

-- ==================================================
-- 4. Update Trigger for updated_at
-- ==================================================

-- Function to update timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger for auto-updating updated_at
DROP TRIGGER IF EXISTS update_admin_bank_accounts_updated_at ON admin_bank_accounts;
CREATE TRIGGER update_admin_bank_accounts_updated_at
    BEFORE UPDATE ON admin_bank_accounts
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ==================================================
-- 5. Working Hours Configuration Table
-- ==================================================
-- Single-row table to store working hours configuration
-- Service is only available within these hours AND when a shift is active

CREATE TABLE IF NOT EXISTS working_hours (
    id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),  -- Single row only
    start_hour_moscow INT NOT NULL DEFAULT 4 CHECK (start_hour_moscow >= 0 AND start_hour_moscow <= 24),
    end_hour_moscow INT NOT NULL DEFAULT 24 CHECK (end_hour_moscow >= 0 AND end_hour_moscow <= 24),
    is_enabled BOOLEAN DEFAULT TRUE,              -- Quick toggle to disable service
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    updated_by BIGINT                             -- Telegram user ID of admin who last updated
);

-- Insert default working hours (04:00 - 24:00 Moscow = 09:00 - 05:00 UB)
INSERT INTO working_hours (id, start_hour_moscow, end_hour_moscow, is_enabled)
VALUES (1, 4, 24, TRUE)
ON CONFLICT (id) DO NOTHING;

-- Enable RLS
ALTER TABLE working_hours ENABLE ROW LEVEL SECURITY;

-- Policy: Everyone can read working hours (public info)
CREATE POLICY "Anyone can read working hours" 
ON working_hours FOR SELECT 
USING (TRUE);

-- Policy: Authenticated users can update (admin check done in API)
CREATE POLICY "Authenticated can update working hours"
ON working_hours FOR UPDATE
USING (TRUE)
WITH CHECK (TRUE);

-- Trigger for auto-updating updated_at
DROP TRIGGER IF EXISTS update_working_hours_updated_at ON working_hours;
CREATE TRIGGER update_working_hours_updated_at
    BEFORE UPDATE ON working_hours
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
