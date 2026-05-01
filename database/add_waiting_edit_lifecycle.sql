-- Add waiting-edit lifecycle support for exchange transactions.
-- This enables admin "waiting mode" while preserving invoice IDs for user resubmission.

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS waiting_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS timer_paused_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS total_paused_seconds NUMERIC NOT NULL DEFAULT 0;

-- If a status check exists, ensure it accepts waiting_edit.
DO $$
DECLARE
  constraint_name TEXT;
BEGIN
  FOR constraint_name IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'transactions'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE transactions DROP CONSTRAINT %I', constraint_name);
  END LOOP;
END $$;

ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_status_check;

-- Normalize legacy status values before applying a strict constraint.
-- This prevents migration failure when old rows contain historical values.
UPDATE transactions
SET status = LOWER(BTRIM(COALESCE(status, '')))
WHERE status IS NULL
  OR status <> LOWER(BTRIM(status));

UPDATE transactions
SET status = 'successful'
WHERE status IN ('success', 'succeeded', 'done', 'complete');

UPDATE transactions
SET status = 'rejected'
WHERE status IN ('cancelled', 'canceled', 'failed', 'declined', 'error', 'expired');

UPDATE transactions
SET status = 'pending'
WHERE status IN ('new', 'created', 'processing', 'in_progress');

-- Any remaining unknown statuses are treated as rejected to keep data safe.
UPDATE transactions
SET status = 'rejected'
WHERE status IS NULL
  OR status = ''
  OR status NOT IN ('pending', 'approved', 'completed', 'successful', 'rejected', 'waiting_edit');

ALTER TABLE transactions
  ADD CONSTRAINT transactions_status_check
  CHECK (status IN ('pending', 'approved', 'completed', 'successful', 'rejected', 'waiting_edit'));

CREATE INDEX IF NOT EXISTS idx_transactions_status_waiting_edit
  ON transactions(status)
  WHERE status = 'waiting_edit';
