-- Admin gift flow writes status 'preapproved' and preapproved_* columns,
-- which the original gifts table did not allow.
ALTER TABLE gifts ADD COLUMN IF NOT EXISTS preapproved_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE gifts ADD COLUMN IF NOT EXISTS preapproved_by_admin BIGINT;
ALTER TABLE gifts DROP CONSTRAINT IF EXISTS gifts_status_check;
ALTER TABLE gifts ADD CONSTRAINT gifts_status_check
  CHECK (status IN ('pending_recipient','pending_admin','preapproved','approved','completed','rejected'));
