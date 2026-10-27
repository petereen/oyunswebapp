-- Finalize the Ulaanbaatar timezone switch.
-- Run AFTER the code from this change is deployed (API + bot + frontend).
--
-- 1. Database session timezone -> Asia/Ulaanbaatar, so now()::date, the
--    Supabase table editor and API responses all show Ulaanbaatar time
--    (timestamptz values come back with a +08:00 offset).
-- 2. Drop the Moscow working-hours columns that the new code no longer uses.

alter database postgres set timezone to 'Asia/Ulaanbaatar';

alter table public.working_hours drop column if exists start_hour_moscow;
alter table public.working_hours drop column if exists end_hour_moscow;

-- New sessions pick up the timezone; ask PostgREST to reconnect/reload.
notify pgrst, 'reload config';
notify pgrst, 'reload schema';
