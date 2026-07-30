# Rate broadcast Edge Function

This function is invoked asynchronously by the `bot_rates` database trigger and
sends the new rate image to every user in Telegram. It replaces the bot's
scheduled/polling broadcast process.

## Deployment

1. Generate one shared secret and store it in both places:

   ```sh
   supabase secrets set RATE_BROADCAST_WEBHOOK_SECRET="<random-secret>" TELEGRAM_BOT_TOKEN="<telegram-bot-token>"
   ```

   In the Supabase SQL editor, run:

   ```sql
   select vault.create_secret('<random-secret>', 'rate_broadcast_webhook_secret');
   ```

2. Deploy the function and apply the SQL migration:

   ```sh
   supabase functions deploy rate-broadcast
   supabase db push
   ```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided to hosted Edge
Functions automatically. The service-role key is used only inside the function
to enumerate `users` despite RLS.
