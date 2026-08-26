-- Track temporary Telegram broadcast delivery failures without disabling the user account.
ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS broadcast_active BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS broadcast_retry_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS broadcast_last_error TEXT;

CREATE INDEX IF NOT EXISTS idx_users_broadcast_delivery
    ON public.users (broadcast_active, broadcast_retry_at);
