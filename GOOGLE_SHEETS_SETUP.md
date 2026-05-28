# Connecting a Google Sheets cell (black rate / а ханш)

The profit calculator reads the daily **black rate (а ханш)** from a Google
Sheet. You chose the **API-key (public sheet)** method. This is the simplest
robust option: the sheet is readable by anyone with the link, and the backend
reads it with a restricted Google Sheets API key.

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

## 2. Make the sheet readable

`Share` → **General access** → "Anyone with the link" → **Viewer**.

## 3. Create an API key

1. Go to <https://console.cloud.google.com/> → create / pick a project.
2. **APIs & Services → Library →** enable **Google Sheets API**.
3. **APIs & Services → Credentials → Create credentials → API key**.
4. (Recommended) **Restrict key** → API restrictions → allow only
   **Google Sheets API**.

## 4. Find the spreadsheet id

It's the long part of the sheet URL:

```
https://docs.google.com/spreadsheets/d/1AbCDeFGhIJkLmNoPQRstUVwxyz0123456789/edit#gid=0
                                        └──────────── this is the id ───────────┘
```

## 5. Set environment variables (backend `.env`)

```env
GOOGLE_SHEETS_API_KEY=AIza...your_key...
BLACK_RATE_SPREADSHEET_ID=1AbCDeFGhIJkLmNoPQRstUVwxyz0123456789
BLACK_RATE_SHEET_NAME=Sheet1     # the tab name
BLACK_RATE_DATE_COLUMN=B
BLACK_RATE_RATE_COLUMN=I
BLACK_RATE_HEADER_ROWS=1
BLACK_RATE_STATUS_COLUMN=E       # column E "Төлөв"
BLACK_RATE_STATUS_VALUE=Ханш     # rows where Төлөв == "Ханш"
```

Restart the backend after changing these.

## 6. How the app uses it

- Dashboard → **Баланс ба Ашиг** page → **Өртөг ханш** section.
- Pick a date and press the refresh button next to "А ханш" — the backend
  calls `GET /api/dashboard/black-rate?date=YYYY-MM-DD`, which fetches the
  cell for that date from the sheet.
- Enter the **USD ханш** for that date. The app computes
  **өртөг ханш = USD ханш ÷ а ханш** and stores it (`cost_rates` table).
- The profit calculator then joins each transaction to the cost rate of its
  date and applies your formula.

## Under the hood

The backend calls the public Sheets REST endpoint:

```
GET https://sheets.googleapis.com/v4/spreadsheets/{SPREADSHEET_ID}/values:batchGet
    ?ranges=Sheet1!B:B          # dates
    &ranges=Sheet1!I:I          # rates
    &ranges=Sheet1!E:E          # status (Төлөв), used to keep only "Ханш" rows
    &majorDimension=COLUMNS
    &valueRenderOption=FORMATTED_VALUE
    &key={API_KEY}
```

To read a single fixed cell instead of a column you would request a range
like `Sheet1!B2` — but for per-date history the date+rate columns are read so
any date can be looked up. See `backend/google_sheets.py`.

## Switching to a fully private sheet later

If you'd rather not make the sheet public, swap the API key for a Google
**service account**: create one, download its JSON key, share the sheet with
the service account's email, and have the backend sign requests with that key
(via `google-api-python-client` / `gspread`). The reading logic in
`backend/google_sheets.py` stays the same — only the auth on the request
changes.
