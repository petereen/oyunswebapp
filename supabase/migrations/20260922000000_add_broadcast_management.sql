-- Broadcast Management: rules, dispatch history, and per-recipient delivery metrics.
-- The Edge Function uses the service role for writes; RLS keeps these tables
-- inaccessible to the browser's anon key by default.

CREATE TABLE IF NOT EXISTS public.broadcast_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slot SMALLINT UNIQUE,
    name VARCHAR(160) NOT NULL CHECK (char_length(trim(name)) BETWEEN 1 AND 160),
    trigger_type VARCHAR(48) NOT NULL CHECK (trigger_type IN ('rate_updated', 'schedule', 'user_event', 'manual')),
    trigger_config JSONB NOT NULL DEFAULT '{}'::jsonb,
    frequency_label VARCHAR(160) NOT NULL DEFAULT '',
    schedule_timezone VARCHAR(64) NOT NULL DEFAULT 'Asia/Ulaanbaatar',
    template_markdown TEXT NOT NULL DEFAULT '',
    audience_type VARCHAR(32) NOT NULL CHECK (audience_type IN ('all', 'active', 'segment', 'custom')),
    audience_filter JSONB NOT NULL DEFAULT '{}'::jsonb,
    status VARCHAR(16) NOT NULL DEFAULT 'paused' CHECK (status IN ('active', 'paused', 'archived')),
    is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
    archived_at TIMESTAMPTZ,
    created_by BIGINT REFERENCES public.users(id) ON DELETE SET NULL,
    updated_by BIGINT REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT broadcast_rules_pinned_slot_check CHECK ((is_pinned AND slot = 1) OR NOT is_pinned),
    CONSTRAINT broadcast_rules_current_rate_name_check CHECK (slot <> 1 OR name = 'Current Rate Broadcast')
);

CREATE TABLE IF NOT EXISTS public.broadcasts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    broadcast_type VARCHAR(16) NOT NULL CHECK (broadcast_type IN ('manual', 'automatic')),
    rule_id UUID REFERENCES public.broadcast_rules(id) ON DELETE SET NULL,
    body_markdown TEXT NOT NULL CHECK (char_length(trim(body_markdown)) BETWEEN 1 AND 4000),
    media_url TEXT,
    media_path TEXT,
    audience_type VARCHAR(32) NOT NULL CHECK (audience_type IN ('all', 'active', 'segment', 'custom')),
    audience_filter JSONB NOT NULL DEFAULT '{}'::jsonb,
    status VARCHAR(16) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sending', 'sent', 'failed')),
    queued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sent_at TIMESTAMPTZ,
    sent_timezone VARCHAR(64) NOT NULL DEFAULT 'Asia/Ulaanbaatar',
    total_recipients INTEGER NOT NULL DEFAULT 0 CHECK (total_recipients >= 0),
    delivered_count INTEGER NOT NULL DEFAULT 0 CHECK (delivered_count >= 0),
    read_count INTEGER NOT NULL DEFAULT 0 CHECK (read_count >= 0),
    created_by BIGINT REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.broadcast_deliveries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    broadcast_id UUID NOT NULL REFERENCES public.broadcasts(id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    status VARCHAR(16) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'delivered', 'read', 'failed')),
    telegram_message_id BIGINT,
    error_message TEXT,
    queued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    delivered_at TIMESTAMPTZ,
    read_at TIMESTAMPTZ,
    UNIQUE (broadcast_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_broadcast_rules_status ON public.broadcast_rules (status, slot, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_broadcasts_history ON public.broadcasts (created_at DESC, broadcast_type, status);
CREATE INDEX IF NOT EXISTS idx_broadcast_deliveries_metrics ON public.broadcast_deliveries (broadcast_id, status);

CREATE OR REPLACE FUNCTION public.touch_broadcast_rule_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS broadcast_rules_updated_at ON public.broadcast_rules;
CREATE TRIGGER broadcast_rules_updated_at
    BEFORE UPDATE ON public.broadcast_rules
    FOR EACH ROW EXECUTE FUNCTION public.touch_broadcast_rule_updated_at();

INSERT INTO public.broadcast_rules (
    id, slot, name, trigger_type, trigger_config, frequency_label,
    schedule_timezone, template_markdown, audience_type, audience_filter,
    status, is_pinned
) VALUES (
    '00000000-0000-0000-0000-000000000001', 1, 'Current Rate Broadcast',
    'rate_updated', '{"source":"bot_rates","delivery":"telegram"}'::jsonb,
    'Өдөрт 1 удаа · 11:00–12:00 УБ', 'Asia/Ulaanbaatar',
    '{greeting}! Ханшийн мэдээлэл шинэчлэгдлээ.', 'all', '{}'::jsonb,
    'active', TRUE
)
ON CONFLICT (id) DO UPDATE SET
    slot = EXCLUDED.slot,
    name = EXCLUDED.name,
    trigger_type = EXCLUDED.trigger_type,
    is_pinned = TRUE,
    status = 'active',
    updated_at = NOW();

ALTER TABLE public.broadcast_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.broadcasts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.broadcast_deliveries ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.broadcast_rules, public.broadcasts, public.broadcast_deliveries FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.broadcast_rules, public.broadcasts, public.broadcast_deliveries TO service_role;
