# OYUNS ALL-IN-ONE WEBAPP Architecture Overview

## 1. Project Structure

- `backend/` - FastAPI service and shared backend helpers
    - `main.py` - primary API surface, auth, transactions, admin, gifts, fuel, and background jobs
    - `config.py` - environment-driven settings and feature flags
    - `db.py` - Supabase client factory
    - `models.py` - Pydantic request/response models
    - `storage.py` - Supabase Storage signed upload helpers
    - `telegram.py` - Telegram Bot API notification helpers
    - `utils.py` - Telegram initData verification, JWT creation/verification, logging
    - `Dockerfile` - backend image entrypoint
- `frontend/` - Vite + React client
    - `src/App.tsx` - shell that switches client/admin/fuel views
    - `src/main.tsx` - React root and providers
    - `src/api.ts` - Axios client, JWT attachment, 401 re-auth, typed API wrappers
    - `src/pages/` - `HomeTab`, `TransactionTab`, `ServicesTab`, `OyunsPlusTab`, `StatsTab`, `ProfilePage`, `AdminPanel`, `FuelAdminPanel`, `OyunsSagsAdminPanel`, `Dashboard`
    - `src/components/` - exchange, tracker, modal, navbar, admin, and diagnostic components
    - `src/hooks/` - Telegram auth, theme, swipe helpers
    - `src/i18n/` - `mn`/`ru` translation tables and language hooks
    - `Dockerfile` - static build served by Nginx
- `database/` - Supabase SQL migrations and schema updates
- `nginx/` - reverse proxy config
- `Dockerfile` - legacy standalone Telegram bot container (`oyunsbot.py`)
- `oyunsbot.py` - legacy Telegram bot runtime and referral/transaction logic
- `bot_translations.py` - shared bot copy used by the backend and bot runtime
- `requirements.txt` - Python dependencies for backend and bot
- `docker-compose.yml` - `api`, `bot`, `frontend`, `nginx`, and `certbot`
- `api-test.sh`, `deploy.sh`, `dev-toggle.ps1`, `vps-*.sh`, `VPS_*.md` - smoke tests, deployment, and VPS runbooks
- `.github/agents/` - Copilot agent definitions, including localization and cleanup agents

## 2. High-Level System Diagram

```text
Telegram user / browser
    -> frontend (React + Vite inside Telegram Mini App or a normal browser)
    -> backend (FastAPI under /api)
    -> Supabase PostgreSQL + Storage

backend -> Telegram Bot API (notifications, photos, media groups)
legacy bot runtime -> Telegram Bot API + Supabase

Nginx -> serves the frontend and proxies /api
Certbot -> TLS certificates
```

## 3. Core Components

### 3.1. Frontend

Name: Oyunsbot WebApp

Description: Single-page React application used as the Telegram Mini App and as a browser-facing admin UI. `App.tsx` switches between client, admin, and fuel-admin views, supports deep links such as `?fuel-admin` and `?fuel-order=...`, supports standalone `/oyuns-sags` tournament admin route with API-key auth, and overlays the profile page on top of the tab shell. `api.ts` attaches JWTs, retries 401s by re-authenticating with Telegram `initData`, and exposes typed wrappers for the backend routes.

Authentication modes:
- Inside Telegram: the app reads `window.Telegram.WebApp.initData`, sends it to `/api/auth`, and the backend validates the Telegram-signed Mini App payload with the bot token.
- Outside Telegram: the app shows a standalone Telegram Login button, requests `/api/auth/browser/challenge`, receives a backend-issued nonce, completes the Telegram browser login popup, then exchanges the returned `id_token` at `/api/auth/browser` for the same app JWT used everywhere else.

Technologies: React 18, TypeScript, Vite, Tailwind CSS, React Query, Axios, Recharts, Headless UI, lucide-react.

Deployment: Built by `frontend/Dockerfile` into static assets and served by Nginx; in local development Vite runs on port 5173 and proxies `/api` to the backend.

### 3.2. Backend Services

#### 3.2.1. FastAPI API service

Name: Backend API

Description: A single FastAPI monolith that handles Telegram auth, browser Telegram Login auth, JWT issuance, rates, app settings, service status, signed storage uploads, user profile data, exchange creation, history, analytics, admin inbox/KYC/shift/bank management, gift flows, fuel flows, Oyuns Plus referral/points, tournament public endpoints, standalone `/oyuns-sags` admin CRUD APIs, and the `stale_transaction_reminder` background task.

Technologies: Python 3.11, FastAPI, Uvicorn, Pydantic, Supabase Python SDK, python-jose, python-dotenv, requests.

Deployment: `backend/Dockerfile`, exposed on port 8000, launched as the `api` service in Compose.

#### 3.2.2. Telegram bot runtime

Name: Legacy bot worker

Description: `oyunsbot.py` is the older Telegram-bot-centric runtime. It still owns legacy referral, transaction, and notification flows and shares the same Supabase tables and Telegram API integration as the FastAPI service.

Technologies: pyTelegramBotAPI, Supabase client, requests, shared `bot_translations.py`.

Deployment: Root `Dockerfile`, launched as the `bot` service in Compose.

## 4. Data Stores

### 4.1. Supabase PostgreSQL

Name: Primary application database

Type: PostgreSQL via Supabase.

Purpose: Stores user profiles, authentication state, exchange transactions, rates, app settings, working hours, admin state, promo/referral data, gifts, fuel data, and audit logs.

Key tables: `users`, `transactions`, `bot_rates`, `app_settings`, `working_hours`, `admin_shifts`, `admin_bank_accounts`, `admin_users`, `admin_activity_logs`, `admin_actions`, `promo_codes`, `user_sessions`, `referrals`, `referral_links`, `feedback`, `gift_cards`, `gifts`, `fuel_stations`, `fuel_orders`, `fuel_chat_messages`, `fuel_admin_bank_accounts`, `fuel_admin_shift`, `oyuns_plus_points_ledger`, `oyuns_tournament_teams`, `oyuns_tournament_games`, `oyuns_tournament_votes`.

Schema management: The repo uses SQL migration files under `database/` rather than an ORM migration system.

### 4.2. Supabase Storage

Name: Passport and receipt object storage

Type: Object storage.

Purpose: Stores uploaded passport images, receipts, bills, admin proof images, and fuel-related photos. Uploads are performed through signed URLs generated by the backend.

Key buckets: `passports`, `bills`.

## 5. External Integrations / APIs

- Telegram Bot API - sends admin/user notifications, photos, and media groups; Mini App auth is based on Telegram-signed `initData`.
- Telegram Login / OIDC - normal-browser login uses Telegram's browser login popup, Telegram-issued `id_token`, and Telegram JWKS validation.
- Supabase - managed Postgres and Storage access through the Python SDK and signed upload URLs.
- Nginx - reverse proxy and static frontend hosting.
- Certbot / Let's Encrypt - production TLS certificates and renewal.

## 6. Deployment & Infrastructure

- Cloud provider: self-managed VPS/on-premise style deployment; the repo does not encode a specific cloud vendor.
- Key services: Docker Compose, Nginx, Certbot, backend container on 8000, frontend container on 80, and the bot container for legacy Telegram flows.
- Compose ports: Nginx publishes 8080 and 8443 in the default file.
- Local development: backend starts with Uvicorn, frontend runs with Vite on 5173, and the frontend dev server proxies `/api` to `http://localhost:8000`.
- Browser login setup: Telegram browser login also requires BotFather Web Login Allowed URLs for every deployed origin and exact redirect URI that will be used by the popup, plus `TELEGRAM_LOGIN_CLIENT_ID` in the backend environment. If you need to pin the popup to one canonical callback URL, set `VITE_TELEGRAM_LOGIN_REDIRECT_URI` in the frontend environment so it matches BotFather exactly, including path and trailing slash.
- CI/CD: no formal pipeline is defined in the repo; deployment is script-driven with `deploy.sh`, `init-letsencrypt.sh`, and the `VPS_*.md` runbooks.
- Monitoring and logging: FastAPI/Uvicorn logs and Telegram API request logs; there is no dedicated metrics stack in the repo.

## 7. Security Considerations

- Authentication: Telegram Mini App `initData` verification lives in `backend/utils.py` and supports HMAC-SHA256 plus Ed25519 fallback. Normal-browser login also lives in `backend/utils.py`, where Telegram browser `id_token` values are validated against Telegram's JWKS plus a short-lived backend-issued nonce challenge. Successful auth from either path issues the same HS256 JWT with a 7-day lifetime.
- Authorization: Most request handlers depend on a JWT-authenticated user context plus configured admin IDs or the fuel admin API key. Some admin helpers are intentionally permissive, so admin security is not centralized in a single RBAC layer.
- Transport and storage: Production traffic is expected to run over TLS via Nginx and Let's Encrypt. Supabase Storage uploads use signed URLs rather than direct public writes.
- Environment safety: `DEV_MODE=true` enables a local/dev auth fallback. That is useful for development, but it should never be assumed safe for production.
- Cookie safety: the browser login challenge is stored in an HttpOnly cookie with `SameSite=Lax`; production deployments should keep the app behind HTTPS so the cookie stays `Secure` outside dev mode.
- Additional note: backend CORS currently allows all origins, which is convenient for development but should be tightened if the service is exposed broadly.
- Additional note: `/api/oyuns-sags/admin/*` endpoints are intentionally API-key-based and independent from Telegram auth for standalone route use.

## 8. Development & Testing Environment

- Local setup: populate `.env` or `.env.example`, install Python dependencies from `requirements.txt`, install frontend dependencies from `frontend/package.json`, then run the backend with `uvicorn main:app --host 0.0.0.0 --port 8000` and the frontend with `npm run dev`.
- Build commands: frontend production build is `npm run build`; the backend and bot are containerized through their respective Dockerfiles.
- Useful scripts: `api-test.sh`, `dev-toggle.ps1`, `deploy.sh`, `vps-diagnostic.sh`, `VPS_SETUP_GUIDE.md`, `DEV_MODE_GUIDE.md`.
- Testing status: there is no dedicated automated test suite committed in the repo. Current validation is mainly smoke scripts, manual flows, and build/startup checks.
- Code quality tools: TypeScript and Vite enforce frontend build correctness; backend validation is primarily through Pydantic and FastAPI request models.

## 9. Future Considerations / Roadmap

- Remove or isolate `oyunsbot.py` legacy paths if the FastAPI service becomes the only supported runtime.
- Split `backend/main.py` into domain routers/services as it continues to grow.
- Tighten admin authorization and replace permissive helpers with explicit RBAC.
- Add automated tests and CI for auth, transaction flows, and storage presign behavior.
- Consolidate duplicated Supabase access patterns and keep the SQL files under `database/` as the single schema source of truth.

## 10. Project Identification

- Project Name: Oyunsbot WebApp
- Repository URL: https://github.com/petereen/oyunswebapp
- Primary Contact/Team: OYUNS ALL-IN-ONE TEAM
- Date of Last Update: 2026-04-21

## 11. Glossary / Acronyms

- Mini App: Telegram WebApp experience embedded inside Telegram.
- initData: Signed Telegram payload used to authenticate the Mini App user.
- JWT: JSON Web Token used for session authentication after Telegram verification.
- KYC: identity and registration verification flow.
- UB: Ulaanbaatar time.
- MNT: Mongolian tugrik.
- RUB: Russian ruble.
- Shift: the active admin-on-duty record stored in `admin_shifts`.
- Supabase: managed PostgreSQL and Storage backend used by the app.