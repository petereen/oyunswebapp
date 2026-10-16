# VPN partner promo codes

## Integration with OYUNS Plus

The existing FastAPI API, Supabase/Postgres coupon catalog (`oyuns_plus_cards`), voucher requests, and points ledger remain the source of truth. Each coupon offer now has an issuance mode:

- **Manual** (default): the existing pending request and admin fulfillment flow.
- **Automatic**: generates a random `GAL-XXXXX-XXXXX` code immediately when purchased. Only coupons under `PARTNER_BRAND_ID` can use this mode. Each offer supplies its own SKU, price in OYUNS+ points, and code validity in days.

The generator uses Python `secrets.choice` and ten random characters excluding `0`, `O`, `1`, and `I`. SKU and price never appear in the code. SKU identifiers are case-sensitive, lowercase identifiers such as `vpn_1m`, `vpn_premium_3m`, or `vpn_12m`; agree on these exact values with the partner.

## Setup

1. Apply `supabase/migrations/20261015000000_add_partner_promo_codes.sql` after the existing OYUNS+ migrations. `database/add_partner_promo_codes.sql` is an identical standalone copy; apply only one. This migration must be applied before deploying the updated backend.
2. Create or choose the partner's existing OYUNS+ brand. Set backend environment variables:

   ```dotenv
   PARTNER_BRAND_ID=<existing partner brand UUID>
   PARTNER_API_KEY=<dedicated random secret>
   ```

   Generate the secret with `python3 -c 'import secrets; print(secrets.token_urlsafe(32))'`. Supply the key privately to the partner's server. Keep it out of frontend variables, source control, and client applications. Restart the backend after setting or rotating it; settings are cached.
3. In admin Settings → OYUNS+ brands, open that brand and use the existing coupon form. Choose **Automatic** first, then enter a SKU tier and validity days (1–3650), along with the existing coupon name, discount/value, points price, purchase limit, and availability fields. Multiple offers and SKU tiers can coexist under the same brand. Other brands retain **Manual**.
4. Purchase through the normal OYUNS+ client flow. The existing receiver fields remain required. The code and expiration appear immediately; the fulfillment note also preserves them in purchase history and the admin fulfilled requests view. The existing notification path sends the code to the purchaser; automatic requests do not enter the pending admin queue.

Missing or invalid partner configuration disables automatic issuance. The admin-only `/api/admin/oyuns-plus/partner-config` endpoint exposes availability and brand UUID, never the API key.

## Partner verification API

To sync the full partner catalog, request the list endpoint. It returns every code issued for the configured partner brand, including its SKU, status, and issue/expiry timestamps. It never returns purchaser data.

```http
GET /api/v1/partner/promo-codes
Authorization: Bearer <PARTNER_API_KEY>
```

Example response:

```json
{
  "promo_codes": [
    {
      "code": "GAL-ABCDE-FGHJK",
      "sku_tier": "vpn_premium_3m",
      "status": "ACTIVE",
      "issued_at": "2026-10-15T08:00:00+00:00",
      "expires_at": "2026-11-14T08:00:00+00:00"
    }
  ]
}
```

The endpoint reads all rows in batches, so large lists are not truncated by the database API's per-request row limit. It uses the same Bearer authentication, partner brand scoping, and `Cache-Control: no-store` header as code lookup.

```http
GET /api/v1/partner/promo-codes/GAL-ABCDE-FGHJK
Authorization: Bearer <PARTNER_API_KEY>
```

Use the deployed **backend** hostname and HTTPS. Code lookup is exact and uppercase. An authenticated malformed code is treated as not found. Responses carry `Cache-Control: no-store`.

Valid, HTTP 200:

```json
{
  "is_valid": true,
  "code": "GAL-ABCDE-FGHJK",
  "sku_tier": "vpn_premium_3m",
  "issued_at": "2026-10-15T08:00:00+00:00",
  "expires_at": "2026-11-14T08:00:00+00:00"
}
```

Unknown code or code belonging to another brand, HTTP 404:

```json
{"is_valid": false, "error": "NOT_FOUND"}
```

Expired (`expires_at <= current UTC time`) or revoked, HTTP 200:

```json
{"is_valid": false, "error": "EXPIRED_OR_REVOKED", "expires_at": "2026-11-14T08:00:00+00:00"}
```

Missing/incorrect Bearer credentials return HTTP 401. Missing server partner configuration returns HTTP 503. Database failures return a server error, never a valid response. No user identifiers or points balances are returned.

This GET endpoint verifies eligibility without consuming the code. The VPN partner must enforce one-time redemption in its own system. Repeated GETs remain valid until expiry or revocation.

## Transactions and lifecycle

`issue_partner_promo_code` validates the coupon's current brand, SKU, price and validity against the backend-loaded values, then calls the shared redemption core. That core checks brand/coupon availability, offer expiry, stock and loyalty balance. User advisory locks and coupon row locks serialize purchases. Request creation, ledger debit, unique code insertion, and immediate fulfillment happen in one database transaction. A collision rolls everything back; Python retries only the code uniqueness constraint, up to five attempts.

`loyalty_promo_codes` stores brand and request references in addition to the user, tier, points, status and timestamps. RLS and grants prevent direct browser access; issuance is callable only by the service role, and the shared core is callable only internally. The legacy redemption RPC rejects automatic coupons.

Offer expiry controls the purchase window. Code expiry is independently calculated from issuance time plus the configured validity days. Editing, archiving, or disabling an offer does not change already issued codes. Changing partner brand configuration changes which brand the API can verify, so do not repurpose it while existing codes remain outstanding.

To revoke an individual code, a trusted database operator can update its `status` to `REVOKED` in `loyalty_promo_codes`. This does not refund points. Existing refund UI/RPC behavior remains pending-only; automatic purchases are immediately fulfilled and cannot use that refund action. A database trigger additionally revokes any associated code if a request is transitioned to `refunded` by a future refund workflow.

## Validation

```sh
PYTHONPATH=backend python -m pytest backend/tests
cd frontend
npx tsc --noEmit
npm test
npm run build
```

For SQL transaction assertions, use an isolated database with the OYUNS+ schema and new migration applied:

```sh
psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/tests/partner_promos_atomic.sql
```

The SQL assertions run in a transaction and roll back their fixtures. They verify manual compatibility, automatic fulfillment, brand/config isolation, duplicate rollback, balance/stock enforcement, refund revocation, and database permissions. Do not run test fixtures on production.

Verified during implementation: 83 backend tests pass, all focused OYUNS Plus frontend tests pass, TypeScript and production build pass, and the SQL transaction assertions pass on local PostgreSQL 16. The full frontend suite has 48 passing and 4 failing tests; the same four finance dashboard failures reproduce on unchanged HEAD.
