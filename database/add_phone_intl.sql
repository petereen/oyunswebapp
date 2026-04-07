-- Add phone_intl column to store international phone number from Level 1 registration
-- This is separate from phone (Russian SBP) and phone_mnt (Mongolian 8-digit)
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_intl varchar(30);

-- Backfill: existing Level 1+ users had phone_mnt stored as their phone
-- (old behavior stored Mongolian phone in both phone and phone_mnt)
UPDATE users SET phone_intl = '+976' || phone_mnt
  WHERE phone_intl IS NULL
    AND phone_mnt IS NOT NULL
    AND phone_mnt != ''
    AND verification_level >= 1;

CREATE INDEX IF NOT EXISTS idx_users_phone_intl ON users (phone_intl);
