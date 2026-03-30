-- Fuel Admin Shift table
-- Tracks which admin is currently on shift for the fuel service

CREATE TABLE IF NOT EXISTS fuel_admin_shift (
    id TEXT PRIMARY KEY DEFAULT 'current',
    is_active BOOLEAN NOT NULL DEFAULT true,
    admin_id BIGINT,
    admin_name TEXT,
    chat_id BIGINT,
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Insert default row (shift active, no specific admin)
INSERT INTO fuel_admin_shift (id, is_active)
VALUES ('current', true)
ON CONFLICT (id) DO NOTHING;

-- Add admin_id column to fuel_admin_bank_accounts for per-admin bank accounts
ALTER TABLE fuel_admin_bank_accounts
ADD COLUMN IF NOT EXISTS admin_id BIGINT;
