-- Durable Telegram group dispatch queue for automated MNT -> RUB completion.

INSERT INTO public.app_settings (key, value, description)
VALUES
    ('exchange_group_mnt_rub_enabled', '0', 'Enable Telegram group completion for MNT -> RUB exchanges'),
    ('exchange_group_rub_mnt_enabled', '0', 'Reserved for future RUB -> MNT Telegram group completion'),
    ('exchange_group_chat_id', '', 'Telegram group chat ID used for exchange completion')
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.exchange_group_dispatches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice TEXT NOT NULL UNIQUE,
    direction TEXT NOT NULL CHECK (direction IN ('mnt_to_rub', 'rub_to_mnt')),
    status TEXT NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'sending', 'awaiting_proof', 'processing', 'completed', 'failed')),
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    lease_expires_at TIMESTAMPTZ,
    last_error TEXT,
    telegram_chat_id BIGINT,
    telegram_message_id BIGINT,
    proof_file_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
    proof_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
    responder_user_id BIGINT,
    responder_message_id BIGINT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sent_at TIMESTAMPTZ,
    proof_received_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ
);

-- Keep existing installations compatible when the worker moves a permanent
-- Telegram destination error to the terminal `failed` state.
ALTER TABLE public.exchange_group_dispatches
    DROP CONSTRAINT IF EXISTS exchange_group_dispatches_status_check;
ALTER TABLE public.exchange_group_dispatches
    ADD CONSTRAINT exchange_group_dispatches_status_check
    CHECK (status IN ('queued', 'sending', 'awaiting_proof', 'processing', 'completed', 'failed'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_exchange_group_dispatch_message
    ON public.exchange_group_dispatches (telegram_chat_id, telegram_message_id)
    WHERE telegram_chat_id IS NOT NULL AND telegram_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_exchange_group_dispatch_due
    ON public.exchange_group_dispatches (status, next_attempt_at);

ALTER TABLE public.exchange_group_dispatches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role manages exchange group dispatches"
    ON public.exchange_group_dispatches;
CREATE POLICY "Service role manages exchange group dispatches"
    ON public.exchange_group_dispatches
    FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

CREATE OR REPLACE FUNCTION public.approve_mnt_rub_group_exchange(p_invoice TEXT)
RETURNS TABLE(approved BOOLEAN, dispatch_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_currency_from TEXT;
    v_currency_to TEXT;
    v_status TEXT;
    v_dispatch_id UUID;
BEGIN
    SELECT UPPER(currency_from), UPPER(currency_to), status
      INTO v_currency_from, v_currency_to, v_status
      FROM public.transactions
     WHERE invoice = p_invoice
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Transaction not found';
    END IF;
    IF v_currency_from <> 'MNT' OR v_currency_to <> 'RUB' THEN
        RAISE EXCEPTION 'Transaction is not MNT to RUB';
    END IF;
    IF v_status NOT IN ('pending', 'approved') THEN
        RAISE EXCEPTION 'Transaction cannot be approved from status %', v_status;
    END IF;

    IF v_status = 'pending' THEN
        UPDATE public.transactions
           SET status = 'approved'
         WHERE invoice = p_invoice;
    END IF;

    INSERT INTO public.exchange_group_dispatches (invoice, direction)
    VALUES (p_invoice, 'mnt_to_rub')
    ON CONFLICT (invoice) DO UPDATE
       SET status = 'queued',
           attempts = 0,
           next_attempt_at = NOW(),
           lease_expires_at = NULL,
           last_error = NULL,
           telegram_chat_id = NULL,
           telegram_message_id = NULL,
           sent_at = NULL,
           updated_at = NOW()
    RETURNING id INTO v_dispatch_id;

    RETURN QUERY SELECT (v_status = 'pending'), v_dispatch_id;
END;
$$;

REVOKE ALL ON FUNCTION public.approve_mnt_rub_group_exchange(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.approve_mnt_rub_group_exchange(TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.approve_mnt_rub_group_exchange(TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.approve_mnt_rub_group_exchange(TEXT) TO service_role;
