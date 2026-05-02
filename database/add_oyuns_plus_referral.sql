-- Oyuns Plus + Web Referral foundation
-- Run in Supabase SQL editor

-- --------------------------------------------------
-- 1) Users table additions for web referral flow
-- --------------------------------------------------
ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code VARCHAR(16);
ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_by_user_id BIGINT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_by_code VARCHAR(16);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_referral_code_unique
ON users (referral_code)
WHERE referral_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_users_referred_by_user_id
ON users (referred_by_user_id);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'users_referred_by_user_id_fkey'
    ) THEN
        ALTER TABLE users
        ADD CONSTRAINT users_referred_by_user_id_fkey
        FOREIGN KEY (referred_by_user_id)
        REFERENCES users(id)
        ON DELETE SET NULL;
    END IF;
END $$;

COMMENT ON COLUMN users.referral_code IS 'Personal referral code owned by this user (web app flow).';
COMMENT ON COLUMN users.referred_by_user_id IS 'Inviter user id captured during level-1 registration.';
COMMENT ON COLUMN users.referred_by_code IS 'Referral code used during level-1 registration.';


-- --------------------------------------------------
-- 2) Oyuns Plus points ledger (auditable + idempotent)
-- --------------------------------------------------
CREATE TABLE IF NOT EXISTS oyuns_plus_points_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id BIGINT NOT NULL,
    source_type VARCHAR(32) NOT NULL,
    source_id VARCHAR(120) NOT NULL,
    points INTEGER NOT NULL CHECK (points <> 0),
    rub_equivalent NUMERIC(18,2),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT oyuns_plus_points_ledger_user_fkey
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT oyuns_plus_points_ledger_source_unique
        UNIQUE (user_id, source_type, source_id)
);

CREATE INDEX IF NOT EXISTS idx_oyuns_plus_points_ledger_user_created
ON oyuns_plus_points_ledger (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_oyuns_plus_points_ledger_source
ON oyuns_plus_points_ledger (source_type, source_id);


-- --------------------------------------------------
-- 3) Configurable Oyuns Plus settings
-- --------------------------------------------------
INSERT INTO app_settings (key, value, description)
VALUES ('oyuns_plus_enabled', '1', '1=enabled, 0=disabled')
ON CONFLICT (key) DO NOTHING;

INSERT INTO app_settings (key, value, description)
VALUES ('oyuns_plus_threshold_rub', '10000', 'RUB threshold for awarding Oyuns Plus points')
ON CONFLICT (key) DO NOTHING;

INSERT INTO app_settings (key, value, description)
VALUES ('oyuns_plus_points_per_threshold', '10', 'Reference points at threshold (linear accrual above threshold; 10,000 RUB -> 10 points by default)')
ON CONFLICT (key) DO NOTHING;

INSERT INTO app_settings (key, value, description)
VALUES ('oyuns_plus_referral_reward_points', '50', 'Points awarded to inviter when invited user gets full KYC approval')
ON CONFLICT (key) DO NOTHING;

INSERT INTO app_settings (key, value, description)
VALUES ('oyuns_plus_referral_max_uses', '5', 'Max number of successful level-1 registrations allowed per referral code')
ON CONFLICT (key) DO NOTHING;
