-- Add logo_url column to admin_bank_accounts table (same feature as fuel_admin_bank_accounts)
ALTER TABLE admin_bank_accounts ADD COLUMN IF NOT EXISTS logo_url TEXT;
