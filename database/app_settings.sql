-- App Settings Table
-- Stores configurable application settings like minimum transaction amounts

CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    description TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert default minimum RUB amount for MNT->RUB direction
INSERT INTO app_settings (key, value, description) 
VALUES ('min_rub_amount', '5000', 'Minimum RUB amount for MNT→RUB transactions')
ON CONFLICT (key) DO NOTHING;

-- Function to automatically update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_app_settings_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update timestamp on changes
DROP TRIGGER IF EXISTS app_settings_timestamp ON app_settings;
CREATE TRIGGER app_settings_timestamp
    BEFORE UPDATE ON app_settings
    FOR EACH ROW
    EXECUTE FUNCTION update_app_settings_timestamp();
