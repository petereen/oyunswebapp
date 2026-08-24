-- Track transactions recreated by an administrator after a client-side failure.
-- Safe to run multiple times.

ALTER TABLE public.transactions
    ADD COLUMN IF NOT EXISTS is_manual BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS manual_created_by_admin_id BIGINT,
    ADD COLUMN IF NOT EXISTS manual_created_at TIMESTAMPTZ;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'transactions_manual_created_by_admin_fkey'
          AND conrelid = 'public.transactions'::regclass
    ) THEN
        ALTER TABLE public.transactions
            ADD CONSTRAINT transactions_manual_created_by_admin_fkey
            FOREIGN KEY (manual_created_by_admin_id)
            REFERENCES public.admin_users(id)
            ON UPDATE CASCADE
            ON DELETE RESTRICT
            NOT VALID;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'transactions_manual_metadata_check'
          AND conrelid = 'public.transactions'::regclass
    ) THEN
        ALTER TABLE public.transactions
            ADD CONSTRAINT transactions_manual_metadata_check
            CHECK (
                is_manual = FALSE
                OR (manual_created_by_admin_id IS NOT NULL AND manual_created_at IS NOT NULL)
            )
            NOT VALID;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_transactions_is_manual
    ON public.transactions(is_manual, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_transactions_manual_admin
    ON public.transactions(manual_created_by_admin_id, manual_created_at DESC);
