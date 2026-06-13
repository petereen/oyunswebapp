-- Link dashboard treasury accounts to real admin bank accounts used by user transactions.
-- Safe to run multiple times.

ALTER TABLE public.treasury_accounts
    ADD COLUMN IF NOT EXISTS admin_bank_id UUID;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'treasury_accounts_admin_bank_id_fkey'
          AND conrelid = 'public.treasury_accounts'::regclass
    ) THEN
        ALTER TABLE public.treasury_accounts
            ADD CONSTRAINT treasury_accounts_admin_bank_id_fkey
            FOREIGN KEY (admin_bank_id)
            REFERENCES public.admin_bank_accounts(id)
            ON UPDATE CASCADE
            ON DELETE SET NULL
            NOT VALID;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_treasury_accounts_admin_bank_id
    ON public.treasury_accounts(admin_bank_id);

CREATE INDEX IF NOT EXISTS idx_treasury_accounts_admin_bank_order
    ON public.treasury_accounts(admin_id, admin_bank_id, display_order);