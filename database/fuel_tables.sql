-- ==================================================
-- Fuel Purchase Feature - Database Tables
-- ==================================================
-- Run these SQL commands in your Supabase SQL editor

-- ==================================================
-- 0. Fuel Stations (editable from admin panel)
-- ==================================================
CREATE TABLE IF NOT EXISTS fuel_stations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) UNIQUE NOT NULL,
    discount_percent INT NOT NULL DEFAULT 13,
    is_active BOOLEAN DEFAULT TRUE,
    requires_dispenser BOOLEAN DEFAULT FALSE,
    display_order INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed default stations
INSERT INTO fuel_stations (name, discount_percent, requires_dispenser, display_order) VALUES
    ('Роснефть', 13, FALSE, 0),
    ('Башнефть', 13, FALSE, 1),
    ('ТНК', 13, FALSE, 2),
    ('Газпромнефть', 13, FALSE, 3),
    ('Лукойл', 13, FALSE, 4),
    ('Татнефть', 13, TRUE, 5),
    ('Топлайн', 13, TRUE, 6),
    ('ННК', 10, TRUE, 7)
ON CONFLICT (name) DO NOTHING;

ALTER TABLE fuel_stations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read active fuel stations"
ON fuel_stations FOR SELECT
USING (true);

CREATE POLICY "Anyone can insert fuel stations"
ON fuel_stations FOR INSERT
WITH CHECK (true);

CREATE POLICY "Anyone can update fuel stations"
ON fuel_stations FOR UPDATE
USING (true);

CREATE POLICY "Anyone can delete fuel stations"
ON fuel_stations FOR DELETE
USING (true);

-- ==================================================
-- 1. Fuel Orders Table
-- ==================================================
CREATE TABLE IF NOT EXISTS fuel_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice VARCHAR(50) UNIQUE NOT NULL,
    user_id BIGINT NOT NULL,

    -- Station info
    station_name VARCHAR(100) NOT NULL,
    dispenser_number VARCHAR(20),            -- pump/dispenser number (for stations that require it)
    station_latitude DOUBLE PRECISION,
    station_longitude DOUBLE PRECISION,
    location_text TEXT,  -- fallback manual address

    -- Fuel details
    liters DECIMAL(10, 2) NOT NULL,
    station_price_per_liter DECIMAL(10, 2) NOT NULL,
    discount_percent INT NOT NULL DEFAULT 13,

    -- Calculated amounts (all in RUB base)
    gross_amount DECIMAL(18, 2) NOT NULL,       -- liters * price
    discount_amount DECIMAL(18, 2) NOT NULL,    -- gross * discount%
    net_amount DECIMAL(18, 2) NOT NULL,         -- gross - discount
    rounded_amount DECIMAL(18, 2) NOT NULL,     -- ceil to 100 for RUB

    -- Payment
    payment_currency VARCHAR(3) NOT NULL CHECK (payment_currency IN ('RUB', 'MNT')),
    exchange_rate DECIMAL(18, 4),               -- sell rate used for MNT conversion
    final_amount DECIMAL(18, 2) NOT NULL,       -- what user actually pays (RUB rounded or MNT converted)

    -- Receipts & photos
    payment_receipt_url TEXT,                    -- user's transfer receipt
    pump_photo_url TEXT,                         -- pump display photo after fueling
    approval_image_url TEXT,                     -- QR/barcode image from admin approval

    -- Admin bank used (ID + snapshot of details at order time)
    admin_bank_id UUID,
    admin_bank_name VARCHAR(100),
    admin_bank_owner VARCHAR(100),
    admin_bank_card VARCHAR(50),

    -- Status flow: pending -> approved -> completed | rejected
    status VARCHAR(30) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'pending_payment', 'paid', 'approved', 'in_progress', 'fueling_complete', 'completed', 'rejected', 'cancelled')),

    rejection_comment TEXT,
    admin_comment TEXT,
    completed_by_admin BIGINT,

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_fuel_orders_user ON fuel_orders(user_id);
CREATE INDEX IF NOT EXISTS idx_fuel_orders_status ON fuel_orders(status);
CREATE INDEX IF NOT EXISTS idx_fuel_orders_invoice ON fuel_orders(invoice);
CREATE INDEX IF NOT EXISTS idx_fuel_orders_created ON fuel_orders(created_at DESC);

-- Enable RLS
ALTER TABLE fuel_orders ENABLE ROW LEVEL SECURITY;

-- Users can read their own orders
CREATE POLICY "Users can read own fuel orders"
ON fuel_orders FOR SELECT
USING (true);

-- Users can insert own orders
CREATE POLICY "Users can insert fuel orders"
ON fuel_orders FOR INSERT
WITH CHECK (true);

-- Users can update own orders (for pump photo upload)
CREATE POLICY "Users can update own fuel orders"
ON fuel_orders FOR UPDATE
USING (true);

-- ==================================================
-- 2. Fuel Admin Bank Accounts (separate from main)
-- ==================================================
CREATE TABLE IF NOT EXISTS fuel_admin_bank_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bank_name VARCHAR(100) NOT NULL,
    account_number VARCHAR(50),
    card_number VARCHAR(20),
    phone VARCHAR(20),
    owner_name VARCHAR(100) NOT NULL,
    currency VARCHAR(3) NOT NULL CHECK (currency IN ('RUB', 'MNT')),
    is_active BOOLEAN DEFAULT TRUE,
    display_order INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fuel_admin_banks_currency_active
ON fuel_admin_bank_accounts(currency, is_active);

ALTER TABLE fuel_admin_bank_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read active fuel admin bank accounts"
ON fuel_admin_bank_accounts FOR SELECT
USING (is_active = TRUE);

-- ==================================================
-- 3. Fuel Chat Messages
-- ==================================================
CREATE TABLE IF NOT EXISTS fuel_chat_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fuel_order_id UUID NOT NULL REFERENCES fuel_orders(id) ON DELETE CASCADE,
    sender_type VARCHAR(10) NOT NULL CHECK (sender_type IN ('user', 'admin')),
    sender_id BIGINT NOT NULL,
    message TEXT,
    image_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fuel_chat_order ON fuel_chat_messages(fuel_order_id, created_at);

ALTER TABLE fuel_chat_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read fuel chat messages"
ON fuel_chat_messages FOR SELECT
USING (true);

CREATE POLICY "Anyone can insert fuel chat messages"
ON fuel_chat_messages FOR INSERT
WITH CHECK (true);

-- ==================================================
-- 4. Update trigger for updated_at
-- ==================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_fuel_orders_updated_at ON fuel_orders;
CREATE TRIGGER update_fuel_orders_updated_at
    BEFORE UPDATE ON fuel_orders
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_fuel_admin_banks_updated_at ON fuel_admin_bank_accounts;
CREATE TRIGGER update_fuel_admin_banks_updated_at
    BEFORE UPDATE ON fuel_admin_bank_accounts
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_fuel_stations_updated_at ON fuel_stations;
CREATE TRIGGER update_fuel_stations_updated_at
    BEFORE UPDATE ON fuel_stations
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
