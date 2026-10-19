-- Standalone equivalent of supabase/migrations/20261019000000_partner_promo_code_redemption.sql.
ALTER TABLE public.loyalty_promo_codes
    DROP CONSTRAINT loyalty_promo_codes_status_check,
    ADD CONSTRAINT loyalty_promo_codes_status_check
        CHECK (status IN ('ACTIVE', 'REVOKED', 'USED')),
    ADD COLUMN used_at TIMESTAMPTZ;
