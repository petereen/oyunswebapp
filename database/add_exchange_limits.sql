-- Add per-direction minimum RUB exchange limits to app_settings
-- min_rub_amount: existing, for MNT→RUB (sell) direction
-- min_rub_buy: new, for RUB→MNT (buy) direction

INSERT INTO app_settings (key, value, description)
VALUES ('min_rub_buy', '100', 'Minimum RUB amount for RUB→MNT transactions')
ON CONFLICT (key) DO NOTHING;
