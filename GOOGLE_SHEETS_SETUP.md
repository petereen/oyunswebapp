# Connecting a Google Sheets cell (black rate / а ханш)

The profit calculator reads the daily **black rate (а ханш)** from a Google
Sheet. This project now uses a **Google service account JSON key file** for
authentication. The sheet can stay private; the backend signs requests with
that service account and reads the configured columns through the Sheets API.

The sheet is read as a **date column + a rate column**, and optionally a
**status column** that marks which rows are rate rows. For each matching row
the backend pairs the date with the rate and builds a `{date: rate}` lookup
the calculator uses per transaction date.

---

## 1. Lay out the sheet

This project's sheet looks like this (defaults are tuned for it):

| A (№) | B (Он сар) | C | D (Тайлбар) | E (Төлөв) | … | I (rate) |
|-------|------------|---|-------------|-----------|---|----------|
| 58    | 2026-05-27 |   | Ханш: 74    | **Ханш**  | … | **74**   |

So:
- **Date** is in column **B**.
- **Black rate** is the raw number in column **I**.
- Rate rows are marked by column **E (Төлөв) = "Ханш"** — this is used as a
  filter so ordinary transaction rows are ignored.

Notes:
- Row 1 is the header (`BLACK_RATE_HEADER_ROWS=1`).
- Dates can be `YYYY-MM-DD`, `DD.MM.YYYY`, `MM/DD/YYYY`, or a real Google date
  cell — the backend normalises common formats.
- The rate cell may contain spaces or commas; they are stripped.
- The date, rate and status columns do **not** have to be adjacent — set each
  column letter independently.
- If several "Ханш" rows share one date, the **last (newest) row wins**.
- A plain date+rate sheet with no status column? Set
  `BLACK_RATE_STATUS_COLUMN=` (empty) to disable the filter.

## 2. Create a service account and JSON key

1. Go to <https://console.cloud.google.com/> → create / pick a project.
2. **APIs & Services → Library →** enable **Google Sheets API**.
3. **IAM & Admin → Service Accounts → Create service account**.
4. Give it any name you want, then open that service account.
5. **Keys → Add key → Create new key → JSON**.
6. Download the JSON file and store it somewhere outside version control.

## 3. Share the sheet with that service account

Open the sheet, press **Share**, and add the service account email from the
downloaded JSON file (`client_email`) as a **Viewer**.

The sheet does **not** need to be public anymore.

## 4. Find the spreadsheet id

It's the long part of the sheet URL:

```
https://docs.google.com/spreadsheets/d/1AbCDeFGhIJkLmNoPQRstUVwxyz0123456789/edit#gid=0
                                        └──────────── this is the id ───────────┘
```

## 5. Set environment variables (backend `.env`)

```env
GOOGLE_SHEETS_SERVICE_ACCOUNT_FILE=./secrets/oyuns-finance-f04dd10e19d5.json
BLACK_RATE_SPREADSHEET_ID=1AbCDeFGhIJkLmNoPQRstUVwxyz0123456789
BLACK_RATE_SHEET_NAME=Transactions2     # the tab name
BLACK_RATE_DATE_COLUMN=B
BLACK_RATE_RATE_COLUMN=I
BLACK_RATE_HEADER_ROWS=1
BLACK_RATE_STATUS_COLUMN=E       # column E "Төлөв"
BLACK_RATE_STATUS_VALUE=Ханш     # rows where Төлөв == "Ханш"
```

Notes:
- `GOOGLE_SHEETS_SERVICE_ACCOUNT_FILE` may be absolute or relative.
- Relative paths are resolved against the current working directory first, then
  near the backend source.
- If you use Docker Compose in this repo, put the JSON file under the repo-root
  `secrets/` folder. `docker-compose.yml` mounts that folder into `/app/secrets`
  inside the `api` container, so a value like
  `./secrets/oyuns-finance-f04dd10e19d5.json` works in both local and Compose
  runs.

Restart the backend after changing these.

## 6. How the app uses it

- Dashboard → **Баланс ба Ашиг** page → **Өртөг ханш** section.
- Pick a date — the dashboard calls `GET /api/dashboard/black-rate?date=YYYY-MM-DD`,
  which fetches the row whose column E is `Ханш`, reads its rate from column I,
  and uses column B as the rate date. The refresh button can re-fetch the row.
- Enter the **USD ханш** for that date. The app computes
  **өртөг ханш = USD ханш ÷ а ханш** and stores it (`cost_rates` table).
- The profit calculator then joins each transaction to the cost rate of its
  date and applies your formula.

## Under the hood

The backend calls the Sheets REST endpoint with a bearer token minted from the
service-account JSON key:

```
GET https://sheets.googleapis.com/v4/spreadsheets/{SPREADSHEET_ID}/values:batchGet
    ?ranges='Transactions2'!B:B # dates
    &ranges='Transactions2'!I:I # rates
    &ranges='Transactions2'!E:E # status (Төлөв), used to keep only "Ханш" rows
    &majorDimension=COLUMNS
    &valueRenderOption=FORMATTED_VALUE
Authorization: Bearer {SERVICE_ACCOUNT_ACCESS_TOKEN}
```

To read a single fixed cell instead of a column you would request a range
like `'Transactions2'!B2` — but for per-date history the date+rate columns are read so
any date can be looked up. See `backend/google_sheets.py`.
