-- Track Supabase phone OTP verification separately from KYC approval.
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_verification_pending boolean DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_verified_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_auth_user_id uuid;

UPDATE users
SET phone_verification_pending = false
WHERE phone_verification_pending IS NULL;

CREATE INDEX IF NOT EXISTS idx_users_phone_verification_pending
ON users (phone_verification_pending)
WHERE phone_verification_pending = true;

CREATE INDEX IF NOT EXISTS idx_users_phone_auth_user_id
ON users (phone_auth_user_id)
WHERE phone_auth_user_id IS NOT NULL;