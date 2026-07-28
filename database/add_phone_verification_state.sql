-- Replace the abandoned phone-verification state with Supabase email verification.
DROP INDEX IF EXISTS idx_users_phone_verification_pending;
DROP INDEX IF EXISTS idx_users_phone_auth_user_id;

ALTER TABLE users DROP COLUMN IF EXISTS phone_verification_pending;
ALTER TABLE users DROP COLUMN IF EXISTS phone_verified_at;
ALTER TABLE users DROP COLUMN IF EXISTS phone_auth_user_id;

ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verification_pending boolean DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_auth_user_id uuid;

-- Existing accounts must pass through the same email gate before creating a
-- new money transaction. We do not mark them as verified automatically: the
-- first successful OTP will populate email_verified_at and email_auth_user_id.
UPDATE users
SET email_verification_pending = true
WHERE email_verified_at IS NULL
  AND (
    verification_level >= 1
    OR verified IS TRUE
    OR ready_for_verification IS TRUE
    OR NULLIF(trim(email), '') IS NOT NULL
  );

UPDATE users
SET email_verification_pending = false
WHERE email_verified_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_users_email_verification_pending
ON users (email_verification_pending)
WHERE email_verification_pending = true;

CREATE INDEX IF NOT EXISTS idx_users_email_auth_user_id
ON users (email_auth_user_id)
WHERE email_auth_user_id IS NOT NULL;
