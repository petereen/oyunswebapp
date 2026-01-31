-- Add phone_mnt column to users table
-- This column stores Mongolian phone numbers separately from bank info for easier lookup

-- Add the phone_mnt column if it doesn't exist
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_mnt TEXT;

-- Add an index for phone_mnt lookups (used in gift recipient search)
CREATE INDEX IF NOT EXISTS idx_users_phone_mnt ON users(phone_mnt) WHERE phone_mnt IS NOT NULL;

-- Migrate existing phone data from bank_mnt column
-- bank_mnt format: "BankName,AccountNumber,OwnerName,PhoneNumber"
-- Extract the last part (phone number) if it looks like a phone number
UPDATE users
SET phone_mnt = TRIM(split_part(bank_mnt, ',', 4))
WHERE bank_mnt IS NOT NULL 
  AND phone_mnt IS NULL
  AND split_part(bank_mnt, ',', 4) ~ '^\+?[0-9\s\-]+$';

-- Comment on the column
COMMENT ON COLUMN users.phone_mnt IS 'Mongolian phone number for contact and gift recipient lookup';
