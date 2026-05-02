-- Oyuns Plus Tournament domain
-- Run in Supabase SQL editor

-- --------------------------------------------------
-- 1) Tournament teams
-- --------------------------------------------------
CREATE TABLE IF NOT EXISTS oyuns_tournament_teams (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    short_name TEXT,
    category VARCHAR(16) NOT NULL CHECK (category IN ('men', 'women')),
    logo_url TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    display_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_oyuns_tournament_teams_category_order
ON oyuns_tournament_teams (category, display_order, created_at);


-- --------------------------------------------------
-- 2) Tournament games / schedule
-- --------------------------------------------------
CREATE TABLE IF NOT EXISTS oyuns_tournament_games (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category VARCHAR(16) NOT NULL CHECK (category IN ('men', 'women')),
    venue VARCHAR(16) NOT NULL CHECK (venue IN ('a_hall', 'b_hall')),
    home_team_id UUID NOT NULL,
    away_team_id UUID NOT NULL,
    starts_at TIMESTAMPTZ NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'live', 'completed', 'cancelled')),
    home_score INTEGER NOT NULL DEFAULT 0 CHECK (home_score >= 0),
    away_score INTEGER NOT NULL DEFAULT 0 CHECK (away_score >= 0),
    is_featured BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT oyuns_tournament_games_home_fkey
        FOREIGN KEY (home_team_id) REFERENCES oyuns_tournament_teams(id) ON DELETE RESTRICT,
    CONSTRAINT oyuns_tournament_games_away_fkey
        FOREIGN KEY (away_team_id) REFERENCES oyuns_tournament_teams(id) ON DELETE RESTRICT,
    CONSTRAINT oyuns_tournament_games_distinct_teams CHECK (home_team_id <> away_team_id)
);

CREATE INDEX IF NOT EXISTS idx_oyuns_tournament_games_starts_at
ON oyuns_tournament_games (starts_at DESC);

CREATE INDEX IF NOT EXISTS idx_oyuns_tournament_games_category_venue
ON oyuns_tournament_games (category, venue, status);


-- --------------------------------------------------
-- 3) Team support votes (1 vote per user per category)
-- --------------------------------------------------
CREATE TABLE IF NOT EXISTS oyuns_tournament_votes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id BIGINT NOT NULL,
    category VARCHAR(16) NOT NULL CHECK (category IN ('men', 'women')),
    team_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT oyuns_tournament_votes_user_fkey
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT oyuns_tournament_votes_team_fkey
        FOREIGN KEY (team_id) REFERENCES oyuns_tournament_teams(id) ON DELETE CASCADE,
    CONSTRAINT oyuns_tournament_votes_user_category_unique UNIQUE (user_id, category)
);

CREATE INDEX IF NOT EXISTS idx_oyuns_tournament_votes_team
ON oyuns_tournament_votes (team_id);


-- --------------------------------------------------
-- 4) Config keys
-- --------------------------------------------------
INSERT INTO app_settings (key, value, description)
VALUES (
    'oyuns_plus_logo_url',
    'https://ldolpsylyatkxqsgxhkn.supabase.co/storage/v1/object/public/Oyuns%20Finance/OYUNS%20Plus.png',
    'Public logo URL for OYUNS Plus icon/surfaces'
)
ON CONFLICT (key) DO NOTHING;

INSERT INTO app_settings (key, value, description)
VALUES ('oyuns_tournament_enabled', '1', 'Tournament section visibility toggle for OYUNS Plus tab')
ON CONFLICT (key) DO NOTHING;
