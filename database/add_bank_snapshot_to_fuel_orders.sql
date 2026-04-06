-- Add bank account snapshot columns to fuel_orders
-- so we know which bank account received the payment, even if the account is later deleted/modified
ALTER TABLE fuel_orders ADD COLUMN IF NOT EXISTS admin_bank_name VARCHAR(100);
ALTER TABLE fuel_orders ADD COLUMN IF NOT EXISTS admin_bank_owner VARCHAR(100);
ALTER TABLE fuel_orders ADD COLUMN IF NOT EXISTS admin_bank_card VARCHAR(50);
