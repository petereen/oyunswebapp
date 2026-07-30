# Email verification and Resend setup

This implementation uses Supabase Auth for one-time-password creation and
validation, with Resend configured as Supabase Auth's custom SMTP provider.
The application does not send SMTP credentials from the browser and does not
need a `RESEND_API_KEY` in the frontend.

## 1. Verify the sending domain in Resend

1. Create or open the Resend account used by OYUNS.
2. Open **Domains** → **Add Domain**.
3. Add `datacom.mn`, or preferably a dedicated sending subdomain such as
   `auth.datacom.mn`.
4. Resend will show the exact DNS records for the selected domain. Add every
   SPF, DKIM, and DMARC record at the DNS provider managing `datacom.mn`.
   Do not copy DNS values from another domain or invent them manually.
5. Wait until Resend shows the domain as **Verified**.
6. Create a Resend API key with permission to send from the verified domain.
   Keep it secret; it is used as the SMTP password below.

Use a dedicated sender such as `no-reply@datacom.mn` or
`no-reply@auth.datacom.mn`. The sender domain must match the domain verified in
Resend.

## 2. Connect Resend to Supabase Auth

In the Supabase project used by this app:

1. Open **Authentication** → **SMTP Settings** (or **Auth** → **Email** →
   **Custom SMTP**, depending on the dashboard version).
2. Enable custom SMTP and enter:

   - SMTP host: `smtp.resend.com`
   - SMTP port: `465` with SSL, or `587` with STARTTLS
   - SMTP username: `resend`
   - SMTP password: the Resend API key
   - Sender email: the verified `no-reply@...` address
   - Sender name: `OYUNS`

3. Save the settings and send a test email from Supabase Auth.
4. In **Authentication** → **Email Templates**, keep the OTP template's code
   placeholder as `{{ .Token }}`. This app requests a six-digit OTP with
   `signInWithOtp` and validates it with `verifyOtp`.
5. Keep email confirmation enabled. Do not enable auto-confirm for this flow.
6. Set the Auth rate limit high enough for expected sign-ups, while keeping a
   resend cooldown in mind. Resending repeatedly can hurt deliverability.

Supabase Auth remains the source of truth for the OTP. Resend only delivers the
message, so no Resend token or email code is stored in the OYUNS database.

## ########

## 3. Apply the database migration

Run [database/add_phone_verification_state.sql](database/add_phone_verification_state.sql)
in the Supabase SQL Editor.

The migration adds `email_verification_pending`, `email_verified_at`, and
`email_auth_user_id`. Existing accounts that have a registered level or email
are intentionally marked pending until they complete one OTP verification;
they are not silently treated as verified.

Confirm the staged rollout setting is enabled:

```sql
select key, value
from app_settings
where key = 'email_verification_enabled';
```

The value should be `1`. The Admin panel can also control this setting. Keep it
enabled for production; disabling it is only a temporary rollout override.

## 4. Configure the web app

Set these values in the frontend build environment (the values are public by
design, but the service-role key and Resend key are not):

```dotenv
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
VITE_API_BASE=/api
```

The backend already uses `SUPABASE_URL` and its server-side Supabase key to
validate the Supabase Auth access token after the OTP succeeds. Never put
`SUPABASE_SERVICE_ROLE_KEY`, `JWT_SECRET`, or the Resend API key in Vite
variables.

## 5. Deploy and test

1. Deploy the backend and apply the SQL migration.
2. Rebuild the frontend image so the `VITE_*` values are compiled into the
   bundle. Telegram may cache an older Mini App bundle, so increment
   `VITE_BUILD_ID` when necessary.
3. Test with a real non-team email address:
   - Register or open the email verification panel.
   - Confirm the email is prefilled for an existing user.
   - Request the code and verify the message arrives from the custom domain.
   - Enter an incorrect code and confirm the account remains blocked.
   - Verify the correct code and confirm the money transaction blocker clears.
   - Confirm a Telegram reminder with the **Verify email** button arrives.
4. Check Supabase Auth logs, Resend email logs, and Telegram bot logs if a test
   fails.

The backend also rejects exchange creation/resubmission, gift creation, and
fuel-order creation while email verification is pending. This prevents a
client-side bypass through a direct API request.

## Useful references

- Supabase custom SMTP: https://supabase.com/docs/guides/auth/auth-smtp
- Resend domain onboarding: https://resend.com/docs/dashboard/domains/introduction
- Resend SMTP: https://resend.com/docs/send-with-smtp
