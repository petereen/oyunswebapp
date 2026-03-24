# OYUNS FINANCE — Dev Mode Guide

## Quick Start

```powershell
# Toggle dev mode ON/OFF (flips both backend + frontend .env files)
.\dev-toggle.ps1        # toggle
.\dev-toggle.ps1 -On    # force ON
.\dev-toggle.ps1 -Off   # force OFF
```

After toggling, **restart both servers**.

---

## What Dev Mode Does

| Feature | Dev Mode ON | Dev Mode OFF (Production) |
|---|---|---|
| Telegram HMAC check | **Skipped** | Enforced (real signature required) |
| Auth payload | `dev_mode_bypass:{mockUser}` | Real `initData` from Telegram SDK |
| DevToolbar | **Visible** (top-left corner) | Hidden |
| TelegramDiagnostic | **Hidden** (not relevant) | Visible (debug overlay) |
| Who can access | Anyone with `localhost` | Only users inside Telegram |

---

## File Locations

| File | Key Variable | Purpose |
|---|---|---|
| `backend/.env` | `DEV_MODE=true` | Backend skips HMAC-SHA256 validation |
| `frontend/.env` | `VITE_DEV_MODE=true` | Frontend uses mock auth instead of Telegram SDK |

> Both must be `true` for local dev to work. The toggle script sets them together.

---

## Running Locally

### 1. Fill in credentials

Edit `backend/.env` with your real Supabase & bot token:

```env
DEV_MODE=true
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_KEY=your-anon-key
BOT_TOKEN=123456:ABC-DEF...
JWT_SECRET=any-random-string
ADMIN_CHAT_IDS=your-chat-id
```

### 2. Start the backend

```powershell
cd backend
python -m uvicorn main:app --reload --port 8000
```

### 3. Start the frontend

```powershell
cd frontend
npm install   # first time only
npm run dev
```

### 4. Open in browser

Go to `http://localhost:5173` (or the port Vite prints).

---

## DevToolbar — Role Switching

When dev mode is ON, a floating toolbar appears in the **top-left corner** of the app.

| Button | Effect |
|---|---|
| **User Role** | Switches to a regular user (id: `7700012345`) |
| **Admin Role** | Switches to admin (id: `1932946217`) |
| **Admin Panel** | Toggles admin panel view (admin role only) |

Switching roles clears the JWT and reloads — you'll re-authenticate as the new identity.

### Custom mock user

You can set any user identity in the browser console:

```js
localStorage.setItem('dev_telegram_user', JSON.stringify({
  id: 9999999,
  first_name: "Custom",
  last_name: "Tester",
  username: "custom_tester"
}));
localStorage.removeItem('oyuns_jwt');
location.reload();
```

---

## Auth Flow in Dev Mode

```
Browser loads → Telegram SDK has empty initData
  → useTelegramAuth Priority 3 activates
    → reads localStorage('dev_telegram_user') or uses default admin
    → sends POST /api/auth { init_data: "dev_mode_bypass:{...}" }
      → backend sees DEV_MODE=true, skips HMAC
      → parses mock user JSON, upserts in DB, returns JWT
    → frontend stores JWT, app loads normally
```

---

## Mobile Testing

1. Open **DevTools** (F12) → toggle **Device Toolbar**
2. Select a device: iPhone 14, Pixel 7, etc.
3. The bottom nav bar uses `pb-safe` (safe-area padding) for notch/home indicator
4. Viewport is set to `viewport-fit=cover` for full-screen layout

---

## Before Deploying to Production

- [ ] Run `.\dev-toggle.ps1 -Off` (or manually set both to `false`)
- [ ] Verify `backend/.env` has `DEV_MODE=false` (or variable is absent)
- [ ] Verify `frontend/.env` has `VITE_DEV_MODE=false` (or variable is absent)
- [ ] Never deploy the `.env` files — they are for local use only
- [ ] The DevToolbar and mock auth are completely inert when dev mode is off
