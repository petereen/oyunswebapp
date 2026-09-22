-- Custom audiences are explicit Telegram user IDs captured in audience_filter.ids.
ALTER TABLE public.broadcasts
    DROP CONSTRAINT IF EXISTS broadcasts_audience_type_check;

ALTER TABLE public.broadcasts
    ADD CONSTRAINT broadcasts_audience_type_check
    CHECK (audience_type IN ('all', 'active', 'segment', 'custom'));

ALTER TABLE public.broadcast_rules
    DROP CONSTRAINT IF EXISTS broadcast_rules_audience_type_check;

ALTER TABLE public.broadcast_rules
    ADD CONSTRAINT broadcast_rules_audience_type_check
    CHECK (audience_type IN ('all', 'active', 'segment', 'custom'));
