-- Add admin label columns to users table
-- Used by admins to tag users with labels (e.g. notes, suspicious) visible in transaction inbox

ALTER TABLE users ADD COLUMN IF NOT EXISTS admin_label VARCHAR(30) DEFAULT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS admin_label_note TEXT DEFAULT NULL;

COMMENT ON COLUMN users.admin_label IS 'Admin-assigned label for user (e.g. Тэмдэглэл, Сэжигтэй, or custom)';
COMMENT ON COLUMN users.admin_label_note IS 'Admin note associated with the label';
