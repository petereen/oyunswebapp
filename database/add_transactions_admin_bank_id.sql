-- Persist selected admin bank account for exchange transactions.
-- Safe to run multiple times.

ALTER TABLE public.transactions
    ADD COLUMN IF NOT EXISTS admin_bank_id UUID;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'transactions_admin_bank_id_fkey'
          AND conrelid = 'public.transactions'::regclass
    ) THEN
        ALTER TABLE public.transactions
            ADD CONSTRAINT transactions_admin_bank_id_fkey
            FOREIGN KEY (admin_bank_id)
            REFERENCES public.admin_bank_accounts(id)
            ON UPDATE CASCADE
            ON DELETE SET NULL
            NOT VALID;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_transactions_admin_bank_id
    ON public.transactions(admin_bank_id);

CREATE INDEX IF NOT EXISTS idx_transactions_timestamp_admin_bank
    ON public.transactions(timestamp DESC, admin_bank_id);
