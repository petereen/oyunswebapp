ALTER TABLE public.oyuns_plus_cards
    ADD COLUMN IF NOT EXISTS country_code VARCHAR(2) NOT NULL DEFAULT 'mn';

UPDATE public.oyuns_plus_cards
SET country_code = 'mn'
WHERE country_code IS NULL OR country_code NOT IN ('mn', 'ru');

ALTER TABLE public.oyuns_plus_cards
    DROP CONSTRAINT IF EXISTS oyuns_plus_cards_country_code_check,
    ADD CONSTRAINT oyuns_plus_cards_country_code_check CHECK (country_code IN ('mn', 'ru'));
