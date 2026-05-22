# Troubleshooting Guide: Telegram Authentication Issues

## 🔴 Issues You're Experiencing

1. ❌ **Профайл ачаалж чадсангүй** (Profile failed to load)
2. ❌ **Түүх татахад алдаа гарлаа** (Error fetching history)
3. ❌ **Статистик татахад алдаа гарлаа** (Error fetching analytics)
4. ❌ **Admin panel button not visible**

**Root Cause:** The app now has two Telegram auth paths, and each fails differently:

- Telegram Mini App path: Telegram `initData` is missing, stale, or invalid.
- Normal browser path: Telegram Login is not configured, the popup was cancelled, or the returned `id_token` / nonce exchange failed.

---

## 🔍 Diagnostic Steps

### Step 1: Check Browser Console (F12)

1. **Open Developer Tools:** Press `F12` or `Ctrl+Shift+I`
2. **Go to Console Tab**
3. **Look for "=== Telegram Auth Debug ===" section**
4. **Check these values:**

```
✅ Telegram WebApp available: true
✅ initData: Present
✅ initDataUnsafe: Present
✅ initDataUnsafe.user: Present
✅ User data retrieved: { id: 1932946217, ... }
```

### Step 2: Use Diagnostic Helper (Bottom Right)

- **Green ✅:** Everything working
- **Red ❌:** Click to see what's wrong

---

## 🌐 Browser Login vs Mini App Login

### Inside Telegram Mini App

- The app expects `window.Telegram.WebApp.initData`
- Backend endpoint: `/api/auth`
- Validation method: bot-token-based `WebAppData` signature check

### Outside Telegram in a Normal Browser

- The app shows a "Sign in with Telegram" button
- Backend endpoints: `/api/auth/browser/challenge` and `/api/auth/browser`
- Validation method: Telegram Login `id_token` + backend nonce cookie + Telegram JWKS

**Important:** normal browsers do **not** receive Mini App `initData`. If browser login fails, do not debug it as an `initData` problem.

---

## ⚠️ CRITICAL: Bot Token Not Rotated

**YOUR CURRENT BOT TOKEN IS STILL THE EXPOSED ONE:**
```
8142574890:AAHzTS6tjFv6j02p0wYxOOKbSSEdapGWbso
```

### ✅ Fix This NOW:

1. **Open Telegram:**
   - Search for `@BotFather`
   - Send: `/mybots`
   - Select your bot
   - Select: `API Token`
   - Select: `Revoke current token`
   - Copy the **NEW** token

2. **Update Your Local .env:**
   ```
   BOT_TOKEN=your_new_token_here
   ```

3. **Update Server .env:**
   ```bash
   ssh your-server
   cd /path/to/oyunsbot-webapp
   nano .env
   # Replace BOT_TOKEN with new one
   docker-compose restart api bot
   ```

---

## 🛠️ Common Issues & Solutions

### Issue 1: "Telegram WebApp not available"

**Symptoms:**
```
❌ Telegram WebApp available: false
```

**Causes:**
- Not opening in Telegram Mini App
- Testing the Mini App path in a normal browser instead of using the browser login path

**Solutions:**
1. Open via Telegram:
   - Find your bot
   - Click "Web App" button
   - OR use `/start` command

2. If you intentionally opened the site in Chrome / Safari / Firefox:
   - Use the standalone Telegram Login button on the home screen
   - Confirm BotFather `Web Login` Allowed URLs include your site origin
   - Confirm `TELEGRAM_LOGIN_CLIENT_ID` is configured on the backend

3. Don't use browser DevTools:
   - Use Telegram's built-in DevTools instead
   - Desktop Telegram: Right-click → Inspect Element

### Issue 2: "initData: Missing"

**Symptoms:**
```
❌ initData: Missing
```

**Causes:**
- Mini App not properly initialized
- Telegram SDK not loaded
- Session expired
- Or you are outside Telegram, where `initData` is not expected at all

**Solutions:**
1. **Check HTML file:**
   - Verify Telegram SDK loaded in `frontend/index.html`:
   ```html
   <script src="https://telegram.org/js/telegram-web-app.js"></script>
   ```

2. **Check Bot Configuration:**
   - Go to @BotFather
   - Select your bot
   - "Web App" settings
   - Verify URL is correct (HTTPS only!)

3. **Restart App:**
   - Close Telegram Mini App
   - Open again via bot

4. **If you are outside Telegram:**
   - Ignore `initData` debugging and use the browser login button instead
   - If the browser button fails immediately, check `TELEGRAM_LOGIN_CLIENT_ID` and BotFather `Web Login` Allowed URLs

### Issue 3: "User data: Missing"

**Symptoms:**
```
❌ initDataUnsafe.user: Missing
```

**Causes:**
- Bot doesn't have user scope
- Mini App opened without user context
- Bug in Telegram SDK initialization

**Solutions:**
1. **Ensure Bot Has User Scope:**
   - @BotFather → Your Bot → Edit Commands
   - Verify it's a Mini App bot

2. **Check tg.ready() called:**
   ```typescript
   // This MUST be called in your code
   tg.ready?.();
   ```

3. **Wait for Telegram to Load:**
   - Telegram SDK takes time to initialize
   - Check if function runs in useEffect

---

## 🧪 Testing Authentication

### Test 1: Local Browser (browser login path)

1. Configure BotFather `Web Login` Allowed URLs for your local dev origin
2. Set `TELEGRAM_LOGIN_CLIENT_ID` in the backend environment
3. Open the app in a normal browser
4. Click the Telegram login button on the home screen
5. Confirm `/api/auth/browser/challenge` succeeds before the popup opens
6. Confirm `/api/auth/browser` returns the same app JWT shape as `/api/auth`

### Test 2: Local Browser (development bypass only)

```typescript
// In browser console, manually test:
const mockInitData = "user=%7B%22id%22%3A1932946217%2C%22first_name%22%3A%22Test%22%7D...";

// Then restart app - it should use mock data
```

### Test 3: Real Telegram Mini App

1. **Deploy to server with HTTPS**
2. **Configure bot URL in BotFather**
3. **Open via Telegram Mini App**
4. **Check console - should show all ✅**

### Test 4: Admin Access

1. **Login with admin user ID (from ADMIN_USER_IDS)**
2. **Should see admin panel toggle**
3. **Button should appear if user ID matches**

---

## 🔍 API Request Debugging

Open Console and look for API requests:

```
📤 API Request: GET /api/me
   hasInitData: true
   initDataLength: 245

✅ API Response: 200 /api/me

❌ API Error: 401 /api/me
   status: 401
   data: { detail: "Missing X-Telegram-Init-Data header" }
```

### Common API Errors:

| Status | Problem | Solution |
|--------|---------|----------|
| 401 | Missing / invalid Mini App auth | Check `useTelegramAuth()` is sending valid `initData` inside Telegram |
| 401 | Invalid browser login nonce or `id_token` | Refresh the page, start a new browser login, and confirm BotFather Web Login setup |
| 400 | Bad request | Check request format, API expects correct headers |
| 500 | Server error | Check backend logs with `docker logs oyunsbot-api` |

---

## 📋 Checklist for Full Diagnosis

- [ ] Bot token rotated (NEW token in .env)
- [ ] Telegram SDK loads (`<script src="...telegram-web-app.js">`)
- [ ] Telegram Mini App opens inside Telegram and browser login opens in a normal browser
- [ ] Console shows "=== Telegram Auth Debug ===" with ✅ values
- [ ] User ID visible in console (e.g., `1932946217`)
- [ ] initData present and >100 characters
- [ ] BotFather `Web Login` Allowed URLs include the current origin
- [ ] `TELEGRAM_LOGIN_CLIENT_ID` is set on the backend
- [ ] Admin panel button visible for admin users
- [ ] `/api/auth/browser/challenge` succeeds in normal browsers
- [ ] API responses return 200 (not 401)
- [ ] Profile loads without errors
- [ ] History shows transactions
- [ ] Analytics loads with data

---

## 🚀 Quick Fix Summary

```bash
# 1. Get new bot token from @BotFather
# 2. Update .env files (local and server)
# 3. Restart services
docker-compose down
docker-compose up -d --build

# 4. Deploy frontend changes
git pull
npm run build  # if needed

# 5. Test in Telegram Mini App (not browser!)
# 6. Open console (F12)
# 7. Look for green ✅ in diagnostic tool
```

---

## 📞 Still Having Issues?

**Check these files:**
1. `frontend/src/hooks/useTelegramAuth.ts` - Telegram initialization
2. `frontend/src/api.ts` - API request setup with initData
3. `backend/main.py` - Authentication middleware
4. `backend/utils.py` - HMAC validation

**Enable Debug Logging:**
```typescript
// In frontend, set localStorage
localStorage.debug = '*';
```

**Check Backend Logs:**
```bash
docker logs oyunsbot-api -f | grep -i "auth\|telegram"
```

---

## ✅ When It's Working Correctly

You should see:

1. **Console:**
   ```
   ✅ Telegram WebApp available: true
   ✅ initData: Present (length: 245)
   ✅ User data retrieved: { id: 1932946217, ... }
   ```

2. **UI:**
   - Green ✅ diagnostic badge (bottom right)
   - Profile loads with name
   - History shows transactions
   - Admin panel visible (if admin)

3. **Network (DevTools):**
   - All API calls return 200
   - Requests include `X-Telegram-Init-Data` header
   - Responses have user data

**If you see all of this → Everything is working! 🎉**
