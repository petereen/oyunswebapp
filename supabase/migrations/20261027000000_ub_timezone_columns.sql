-- Move app-owned timestamps to timestamptz and Ulaanbaatar business time.
--
-- Why: these columns were "timestamp without time zone", and different writers
-- stored different zones in them (UTC from the bot/defaults, Moscow from the
-- web backend), so the same column held mixed wall-clock times.
-- After this migration every column stores an absolute instant (timestamptz);
-- the app formats and buckets them in Asia/Ulaanbaatar.
--
-- Historical zones are inferred per row. The invoice number always encodes
-- the Moscow wall-clock time the request was created, which is used as an
-- anchor (the stored value can never be earlier than the invoice):
--   transactions.timestamp
--     manual entries                    -> UTC (written by admin endpoint)
--     invoice before 2026-02-01         -> UTC (bot used utcnow)
--     value < invoice - 30 min          -> UTC
--     otherwise                         -> Moscow
--   transactions.receipt_submitted_at   -> same zone as timestamp when equal,
--                                          else same invoice rule (Moscow default)
--   transactions.completed_at
--     manual entries                    -> UTC
--     matches admin_bill_submitted_at   -> exact (that column is timestamptz)
--     value < invoice - 30 min          -> UTC
--     invoice before 2026-02-01         -> Moscow
--     otherwise                         -> UTC
--   users.created_at -> UTC (column default), users.updated_at -> Moscow (/api/me)
--   referrals.*, referral_links.created_at, promo_codes.created_at -> Moscow (bot/backend)
--   promo_codes.expires_at -> UTC (how the app already interprets it)
--
-- Run this BEFORE deploying the code that writes Ulaanbaatar times.
-- Then deploy, then run 20261027010000_ub_timezone_finalize.sql.

begin;

-- ---------------------------------------------------------------------------
-- Temporary helpers (dropped at the end)
-- ---------------------------------------------------------------------------
create or replace function public._tzmig_invoice_msk(p_invoice text)
returns timestamp
language plpgsql immutable
as $$
begin
    if p_invoice is null or p_invoice !~ '^\d{8}[-_]\d{6}' then
        return null;
    end if;
    return make_timestamp(
        substr(p_invoice, 1, 4)::int, substr(p_invoice, 5, 2)::int, substr(p_invoice, 7, 2)::int,
        substr(p_invoice, 10, 2)::int, substr(p_invoice, 12, 2)::int, substr(p_invoice, 14, 2)::double precision
    );
exception when others then
    return null;
end;
$$;

create or replace function public._tzmig_tx_ts_zone(p_is_manual boolean, p_invoice text, p_ts timestamp)
returns text
language plpgsql immutable
as $$
declare
    inv timestamp := public._tzmig_invoice_msk(p_invoice);
begin
    if coalesce(p_is_manual, false) or inv is null or inv < timestamp '2026-02-01' then
        return 'UTC';
    end if;
    if p_ts < inv - interval '30 minutes' then
        return 'UTC';
    end if;
    return 'Europe/Moscow';
end;
$$;

create or replace function public._tzmig_tx_receipt_zone(p_is_manual boolean, p_invoice text, p_ts timestamp, p_receipt timestamp)
returns text
language plpgsql immutable
as $$
declare
    inv timestamp := public._tzmig_invoice_msk(p_invoice);
begin
    if coalesce(p_is_manual, false) then
        return 'UTC';
    end if;
    if p_receipt = p_ts then
        return public._tzmig_tx_ts_zone(p_is_manual, p_invoice, p_ts);
    end if;
    if inv is not null and p_receipt < inv - interval '30 minutes' then
        return 'UTC';
    end if;
    return 'Europe/Moscow';
end;
$$;

create or replace function public._tzmig_tx_completed_zone(p_is_manual boolean, p_invoice text, p_completed timestamp, p_admin_bill timestamptz)
returns text
language plpgsql immutable
as $$
declare
    inv timestamp := public._tzmig_invoice_msk(p_invoice);
begin
    if coalesce(p_is_manual, false) then
        return 'UTC';
    end if;
    if p_admin_bill is not null then
        if abs(extract(epoch from p_completed - (p_admin_bill at time zone 'UTC'))) < 120 then
            return 'UTC';
        end if;
        if abs(extract(epoch from p_completed - (p_admin_bill at time zone 'Europe/Moscow'))) < 120 then
            return 'Europe/Moscow';
        end if;
    end if;
    if inv is not null and p_completed < inv - interval '30 minutes' then
        return 'UTC';
    end if;
    if inv is null or inv < timestamp '2026-02-01' then
        return 'Europe/Moscow';
    end if;
    return 'UTC';
end;
$$;

-- ---------------------------------------------------------------------------
-- transactions
-- ---------------------------------------------------------------------------
drop index if exists public.idx_transactions_timestamp_moscow;
alter table public.transactions drop column if exists timestamp_moscow;

-- Separate statements so each conversion reads the other columns' original values.
alter table public.transactions
    alter column completed_at type timestamptz
    using (completed_at at time zone public._tzmig_tx_completed_zone(is_manual, invoice, completed_at, admin_bill_submitted_at));

alter table public.transactions
    alter column receipt_submitted_at type timestamptz
    using (receipt_submitted_at at time zone public._tzmig_tx_receipt_zone(is_manual, invoice, "timestamp", receipt_submitted_at));

alter table public.transactions
    alter column "timestamp" type timestamptz
    using ("timestamp" at time zone public._tzmig_tx_ts_zone(is_manual, invoice, "timestamp"));

alter table public.transactions alter column "timestamp" set default now();

-- Ulaanbaatar wall-clock copy for reading the table in the Supabase editor.
alter table public.transactions
    add column timestamp_ub timestamp generated always as ("timestamp" at time zone 'Asia/Ulaanbaatar') stored;
create index if not exists idx_transactions_timestamp_ub on public.transactions (timestamp_ub);

-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------
alter table public.users drop column if exists created_at_moscow;
alter table public.users drop column if exists updated_at_moscow;

alter table public.users
    alter column created_at type timestamptz using (created_at at time zone 'UTC');
alter table public.users
    alter column updated_at type timestamptz using (updated_at at time zone 'Europe/Moscow');
alter table public.users alter column created_at set default now();
alter table public.users alter column updated_at set default now();

alter table public.users
    add column created_at_ub timestamp generated always as (created_at at time zone 'Asia/Ulaanbaatar') stored,
    add column updated_at_ub timestamp generated always as (updated_at at time zone 'Asia/Ulaanbaatar') stored;

-- ---------------------------------------------------------------------------
-- referrals / referral_links / promo_codes
-- ---------------------------------------------------------------------------
alter table public.referrals
    alter column created_at type timestamptz using (created_at at time zone 'Europe/Moscow');
alter table public.referrals
    alter column verified_at type timestamptz using (verified_at at time zone 'Europe/Moscow');
alter table public.referrals alter column created_at set default now();

alter table public.referral_links
    alter column created_at type timestamptz using (created_at at time zone 'Europe/Moscow');
alter table public.referral_links alter column created_at set default now();

alter table public.promo_codes
    alter column created_at type timestamptz using (created_at at time zone 'Europe/Moscow');
alter table public.promo_codes
    alter column expires_at type timestamptz using (expires_at at time zone 'UTC');

-- ---------------------------------------------------------------------------
-- working_hours: store Ulaanbaatar hours (Moscow + 5)
-- ---------------------------------------------------------------------------
alter table public.working_hours add column if not exists start_hour_ub integer;
alter table public.working_hours add column if not exists end_hour_ub integer;
update public.working_hours
set start_hour_ub = (coalesce(start_hour_moscow, 4) + 5) % 24,
    end_hour_ub = (coalesce(end_hour_moscow, 23) + 5) % 24
where start_hour_ub is null or end_hour_ub is null;
update public.working_hours set start_hour_ub = 9 where start_hour_ub is null;
update public.working_hours set end_hour_ub = 4 where end_hour_ub is null;
alter table public.working_hours alter column start_hour_ub set default 9;
alter table public.working_hours alter column end_hour_ub set default 4;
alter table public.working_hours alter column start_hour_ub set not null;
alter table public.working_hours alter column end_hour_ub set not null;
alter table public.working_hours drop constraint if exists working_hours_start_hour_ub_check;
alter table public.working_hours drop constraint if exists working_hours_end_hour_ub_check;
alter table public.working_hours add constraint working_hours_start_hour_ub_check check (start_hour_ub between 0 and 23);
alter table public.working_hours add constraint working_hours_end_hour_ub_check check (end_hour_ub between 0 and 23);
-- Old code still writes the Moscow columns until the new code is deployed.
alter table public.working_hours alter column start_hour_moscow drop not null;
alter table public.working_hours alter column end_hour_moscow drop not null;

-- ---------------------------------------------------------------------------
-- Partner promo confirmation note: show expiry in Ulaanbaatar time
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_partner_promo_code(p_user_id bigint, p_card_id uuid, p_partner_brand_id uuid, p_sku_tier text, p_points_spent integer, p_validity_days integer, p_code text, p_receiver_name text, p_receiver_phone text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    card public.oyuns_plus_cards%ROWTYPE;
    result JSONB;
    promo public.loyalty_promo_codes%ROWTYPE;
    note TEXT;
BEGIN
    PERFORM pg_advisory_xact_lock(p_user_id);
    SELECT * INTO card FROM public.oyuns_plus_cards WHERE id = p_card_id FOR UPDATE;
    IF NOT FOUND OR p_partner_brand_id IS NULL OR card.issuance_mode <> 'automatic' OR card.brand_id <> p_partner_brand_id
       OR card.sku_tier IS DISTINCT FROM p_sku_tier
       OR card.points_price IS DISTINCT FROM p_points_spent
       OR card.validity_days IS DISTINCT FROM p_validity_days THEN
        RAISE EXCEPTION 'PARTNER_COUPON_NOT_AVAILABLE';
    END IF;
    -- Core performs current brand/activity/expiry/stock/balance checks and ledger debit.
    result := public._create_oyuns_plus_voucher_request_core(p_user_id, p_card_id, p_receiver_name, p_receiver_phone);
    INSERT INTO public.loyalty_promo_codes(code, user_id, brand_id, request_id, sku_tier, points_spent, expires_at)
    VALUES (p_code, p_user_id, card.brand_id, (result->>'id')::UUID, card.sku_tier,
            card.points_price, NOW() + make_interval(days => card.validity_days))
    RETURNING * INTO promo;
    note := promo.code || E'\n' || promo.sku_tier || E'\n' || to_char(promo.expires_at AT TIME ZONE 'Asia/Ulaanbaatar', 'YYYY-MM-DD HH24:MI') || ' (УБ)';
    UPDATE public.oyuns_plus_voucher_requests SET status = 'fulfilled', confirmation_note = note,
        fulfilled_at = NOW(), updated_at = NOW() WHERE id = promo.request_id;
    RETURN result || jsonb_build_object('status', 'fulfilled', 'code', promo.code,
        'sku_tier', promo.sku_tier, 'issued_at', promo.issued_at, 'expires_at', promo.expires_at,
        'confirmation_note', note);
END;
$function$;

drop function public._tzmig_tx_completed_zone(boolean, text, timestamp, timestamptz);
drop function public._tzmig_tx_receipt_zone(boolean, text, timestamp, timestamp);
drop function public._tzmig_tx_ts_zone(boolean, text, timestamp);
drop function public._tzmig_invoice_msk(text);

commit;
