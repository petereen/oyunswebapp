-- Tournament stage settings for groups and knockout phases
-- Run in Supabase SQL editor

INSERT INTO app_settings (key, value, description)
VALUES (
    'oyuns_tournament_groups_json',
    '[]',
    'JSON array for tournament group-stage configuration'
)
ON CONFLICT (key) DO NOTHING;

INSERT INTO app_settings (key, value, description)
VALUES (
    'oyuns_tournament_knockout_json',
    '[]',
    'JSON array for tournament knockout-stage configuration'
)
ON CONFLICT (key) DO NOTHING;