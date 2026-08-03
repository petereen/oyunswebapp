-- Keep rate broadcasts on the bot's daily scheduler only.
-- The previous bot_rates webhook broadcasted immediately on every rate update.
drop trigger if exists trig_bot_rates on public.bot_rates;
drop function if exists public.trigger_bot_update();
