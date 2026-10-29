-- Admin who clicked "send to group"; becomes completed_by_admin on group completion.
ALTER TABLE public.exchange_group_dispatches
    ADD COLUMN IF NOT EXISTS dispatched_by_admin BIGINT;
