-- Prerequisite: store a randomly generated shared secret in Supabase Vault:
--   select vault.create_secret('<same value used for the Edge Function secret>',
--                              'rate_broadcast_webhook_secret');
-- Then deploy `rate-broadcast` with RATE_BROADCAST_WEBHOOK_SECRET and
-- TELEGRAM_BOT_TOKEN set as Edge Function secrets.

create extension if not exists pg_net with schema extensions;

create or replace function public.trigger_bot_update()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  webhook_secret text;
begin
  -- Ignore metadata-only updates. INSERTs always represent a new rate.
  if tg_op = 'UPDATE'
     and new.buy_rate is not distinct from old.buy_rate
     and new.sell_rate is not distinct from old.sell_rate then
    return new;
  end if;

  select decrypted_secret into webhook_secret
    from vault.decrypted_secrets
   where name = 'rate_broadcast_webhook_secret'
   limit 1;

  if webhook_secret is null then
    raise warning 'Rate broadcast skipped: rate_broadcast_webhook_secret is not configured in Vault';
    return new;
  end if;

  perform net.http_post(
    url := 'https://ldolpsylyatkxqsgxhkn.supabase.co/functions/v1/rate-broadcast',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', webhook_secret),
    body := jsonb_build_object(
      'type', tg_op,
      'table', tg_table_name,
      'record', to_jsonb(new),
      'old_record', case when tg_op = 'UPDATE' then to_jsonb(old) else null end
    )
  );

  return new;
end;
$$;

drop trigger if exists trig_bot_rates on public.bot_rates;
create trigger trig_bot_rates
after insert or update on public.bot_rates
for each row execute function public.trigger_bot_update();
