-- Track one-time redemption reported by the VPN partner.
ALTER TABLE public.loyalty_promo_codes
    DROP CONSTRAINT loyalty_promo_codes_status_check,
    ADD CONSTRAINT loyalty_promo_codes_status_check
        CHECK (status IN ('ACTIVE', 'REVOKED', 'USED')),
    ADD COLUMN used_at TIMESTAMPTZ;
