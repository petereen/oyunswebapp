-- Add is_priority column to admin_bank_accounts for RUB card rotation
ALTER TABLE admin_bank_accounts ADD COLUMN IF NOT EXISTS is_priority BOOLEAN DEFAULT FALSE;

-- Add rub_bank_rotation_counter to app_settings
INSERT INTO app_settings (key, value) VALUES ('rub_bank_rotation_counter', '0')
ON CONFLICT (key) DO NOTHING;

-- Add logo_url, emoji_id, and is_primary columns to fuel_admin_bank_accounts
ALTER TABLE fuel_admin_bank_accounts ADD COLUMN IF NOT EXISTS logo_url TEXT;
ALTER TABLE fuel_admin_bank_accounts ADD COLUMN IF NOT EXISTS emoji_id TEXT;
ALTER TABLE fuel_admin_bank_accounts ADD COLUMN IF NOT EXISTS is_primary BOOLEAN DEFAULT FALSE;

-- Add always-notify columns to fuel_admin_shift
ALTER TABLE fuel_admin_shift ADD COLUMN IF NOT EXISTS always_notify_admin_id BIGINT;
ALTER TABLE fuel_admin_shift ADD COLUMN IF NOT EXISTS always_notify_chat_id BIGINT;
