-- Add verification_level column to users table
-- 0 = new (no registration), 1 = basic (Level 1 - unverified), 2 = fully verified (Level 2 - KYC approved)
ALTER TABLE users ADD COLUMN IF NOT EXISTS verification_level integer DEFAULT 0;

-- Backfill existing users:
-- Users who are verified get level 2
UPDATE users SET verification_level = 2 WHERE verified = true;

-- Users who submitted KYC (ready_for_verification) but not yet verified get level 1
-- (they already submitted full info, so treat them as at least level 1)
UPDATE users SET verification_level = 1 WHERE ready_for_verification = true AND verified = false;

-- Index for querying by verification level
CREATE INDEX IF NOT EXISTS idx_users_verification_level ON users (verification_level);
