-- OYUNS+ brand profile page (cover, category, contacts) and coupon badges.
-- Run after add_oyuns_plus_brands.sql.
-- Every contact field is optional; the client hides rows that are empty.

ALTER TABLE public.oyuns_plus_brands
    ADD COLUMN IF NOT EXISTS cover_url TEXT,
    ADD COLUMN IF NOT EXISTS cover_path TEXT,
    ADD COLUMN IF NOT EXISTS category VARCHAR(160) NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS address TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS map_url TEXT,
    ADD COLUMN IF NOT EXISTS website_url TEXT,
    ADD COLUMN IF NOT EXISTS instagram_url TEXT,
    ADD COLUMN IF NOT EXISTS facebook_url TEXT,
    ADD COLUMN IF NOT EXISTS phone VARCHAR(40);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'oyuns_plus_brands_address_length_check') THEN
        ALTER TABLE public.oyuns_plus_brands ADD CONSTRAINT oyuns_plus_brands_address_length_check
            CHECK (char_length(address) <= 500);
    END IF;
END;
$$;

ALTER TABLE public.oyuns_plus_cards
    ADD COLUMN IF NOT EXISTS badge_label VARCHAR(40);

COMMENT ON COLUMN public.oyuns_plus_brands.category IS 'Comma-separated category tags shown under the brand name.';
COMMENT ON COLUMN public.oyuns_plus_cards.badge_label IS 'Optional short highlight shown on the coupon card, e.g. "Хэмнэлт 10%".';
