-- Home banner settings for temporary announcement / advertisement
-- Run in Supabase SQL editor

INSERT INTO app_settings (key, value, description)
VALUES (
    'home_banner_enabled',
    '0',
    'Toggle to show the temporary announcement banner on the home tab'
)
ON CONFLICT (key) DO NOTHING;

INSERT INTO app_settings (key, value, description)
VALUES (
    'home_banner_image_url',
    '',
    'Public image URL for the home tab temporary banner'
)
ON CONFLICT (key) DO NOTHING;

INSERT INTO app_settings (key, value, description)
VALUES (
    'home_banner_link_url',
    '',
    'Click-through URL for the home tab temporary banner'
)
ON CONFLICT (key) DO NOTHING;