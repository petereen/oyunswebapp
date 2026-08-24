# Project Task Tracker

## Current Milestone
- [x] Add manual USD inputs for historical black rates in dashboard cost-rate manager (frontend/src/pages/BalanceProfitPage.tsx)
- [x] Implement dashboard black-rate fetching from Transactions2 rows where E is Ханш (backend/config.py, backend/google_sheets.py, frontend/src/pages/BalanceProfitPage.tsx, .env.example)
- [x] Verify frontend production build and clean diff
- [ ] Run focused backend black-rate test (local Python runtime/dependencies are unavailable)
- [x] Fix dashboard plane-ticket sale 400 handling and validation (backend/main.py, frontend/src/pages/BalanceProfitPage.tsx)
- [ ] Run backend tests (local environment is missing Python dependency `requests`)
- [x] Add manual transaction recovery schema migration (database/add_manual_transactions.sql)
- [x] Add strict admin lookup/create API and manual transaction metadata (backend/main.py, backend/models.py)
- [x] Add manual transaction recovery admin form and API client (frontend/src/components/AdminManualTransaction.tsx, frontend/src/api.ts)
- [x] Add manual transaction visibility to admin inbox/history
- [x] Add backend coverage for authorization, validation, audit, and notifications
- [x] Run frontend production build

## Completed Tasks
- [x] Rank active Russian bank accounts by recent transaction utilization (backend/main.py)
- [x] Add coverage for Russian bank account utilization ordering (backend/tests/test_admin_bank_accounts.py)
- [x] Run backend tests and frontend production build
