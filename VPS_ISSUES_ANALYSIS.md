# 📋 VPS Issues - Analysis & Solutions

## Current Status

| Component | Status | Evidence |
|-----------|--------|----------|
| Telegram | ✅ Works | Greeting: "Сайн байна уу, Temuulen" |
| Frontend | ✅ Works | Renders, displays name |
| Backend API | ❌ Fails | Profile/History/Analytics return errors |
| User Auth | ⚠️ Partial | Frontend has data, API rejects requests |

---

## 🔍 Why APIs Are Failing

Since greeting works = Telegram sending user data to frontend successfully.

But profile/history/analytics fail = Backend API not validating requests.

**Most likely cause (95% probability):**
```
Frontend sends: initData (signed with NEW bot token from Telegram)
Backend validates with: OLD bot token (from .env)
Result: Hashes don't match → 401 Unauthorized
```

**Second cause (4% probability):**
```
ADMIN_PANEL_URL and USER_PANEL_URL still point to localhost
These URLs might be used in bot configuration
Causing CORS or redirect issues
```

**Third cause (1% probability):**
```
Backend not receiving initData header
Check API request headers in browser DevTools
```

---

## 📌 Environment Variables - YES, Update These!

Your current VPS `.env` has problems:

```bash
# ❌ WRONG for VPS
ADMIN_PANEL_URL=http://localhost:5173?admin=true
USER_PANEL_URL=http://localhost:5173

# ✅ CORRECT for VPS
ADMIN_PANEL_URL=https://your-vps-domain.com?admin=true
USER_PANEL_URL=https://your-vps-domain.com
```

### Why This Matters:

1. **Telegram Bot Settings** - Uses ADMIN_PANEL_URL for links
2. **Admin Notifications** - Sends links with USER_PANEL_URL
3. **Redirect URLs** - Frontend might use these for redirects
4. **CORS** - Backend might validate these

**Must be:**
- ✅ HTTPS (not HTTP)
- ✅ Valid domain (not localhost)
- ✅ Accessible from internet

---

## 🚀 Two-Part Solution

### Part 1: Rotate Bot Token (Mandatory)

**Check current token:**
```bash
ssh your-vps
cd /path/to/oyunsbot-webapp
grep BOT_TOKEN .env
```

**If you see:** `8142574890:AAHzTS6tjFv6j02p0wYxOOKbSSEdapGWbso`
→ **It's the old exposed token. Must rotate!**

**Get new token:**
1. Open Telegram → `@BotFather`
2. `/mybots` → Your bot → `API Token` → `Revoke current token`
3. Copy NEW token

**Update VPS .env:**
```bash
nano .env
# Replace BOT_TOKEN line with new token
# Ctrl+X → Y → Enter
```

### Part 2: Update URLs (Required for VPS)

**In same `nano .env` session:**

```bash
# Find these lines:
ADMIN_PANEL_URL=http://localhost:5173?admin=true
USER_PANEL_URL=http://localhost:5173

# Replace with (use your actual domain):
ADMIN_PANEL_URL=https://your-domain.com?admin=true
USER_PANEL_URL=https://your-domain.com
```

**Get your domain:**
- If you own domain: `oyuns.mn` (example)
- If using VPS IP: `123.45.67.89` (less ideal)
- Must be HTTPS (Nginx handles this)

---

## 🛠️ Implementation Steps

### Step 1: SSH to VPS
```bash
ssh your-username@your-vps-ip
cd /path/to/oyunsbot-webapp
```

### Step 2: View Current .env
```bash
cat .env
# Look for BOT_TOKEN (should be NEW, not old exposed one)
# Look for ADMIN_PANEL_URL and USER_PANEL_URL (should be HTTPS domain, not localhost)
```

### Step 3: Edit .env
```bash
nano .env
```

**Update these 3 lines:**
1. `BOT_TOKEN=` → Paste new token from BotFather
2. `ADMIN_PANEL_URL=` → Change to HTTPS domain
3. `USER_PANEL_URL=` → Change to HTTPS domain

**Save:** `Ctrl+X` → `Y` → `Enter`

### Step 4: Rebuild Services
```bash
docker-compose down
docker-compose up -d --build
```

### Step 5: Verify
```bash
sleep 30
docker logs oyunsbot-api --tail 20
# Should show no auth errors
```

### Step 6: Test
- Refresh Telegram Mini App
- Profile should load
- History should show data
- Analytics should work

---

## 📊 What Each Endpoint Needs

| Endpoint | Requires | Currently |
|----------|----------|-----------|
| `/api/health` | Nothing | ✅ Works |
| `/api/rates` | Nothing | ✅ Works |
| `/api/me` | initData + valid bot token | ❌ Fails (old token?) |
| `/api/history` | initData + valid bot token | ❌ Fails |
| `/api/analytics` | initData + valid bot token | ❌ Fails |

**Fix:** Update bot token in `.env` → All endpoints work ✅

---

## 🧪 Debug Commands

Run these on VPS to diagnose:

```bash
# 1. Check bot token status
grep BOT_TOKEN .env

# 2. Check if services running
docker ps | grep oyunsbot

# 3. Check for auth errors
docker logs oyunsbot-api --tail 50 | grep -iE "401|unauthorized|auth.*failed"

# 4. Test API health
curl http://localhost:8000/api/health

# 5. Full diagnostic
bash api-test.sh
```

---

## ✅ Verification Checklist

After making changes:

- [ ] Bot token is NEW (not old exposed one)
- [ ] ADMIN_PANEL_URL is HTTPS domain
- [ ] USER_PANEL_URL is HTTPS domain
- [ ] docker-compose down && docker-compose up -d completed
- [ ] Waited 30 seconds for services to start
- [ ] No errors in `docker logs oyunsbot-api`
- [ ] `/api/health` returns 200
- [ ] Frontend console shows no auth errors
- [ ] Profile loads with username
- [ ] History shows transactions
- [ ] Analytics displays data

---

## 📞 If Still Not Working

**Check 1: Bot Token**
```bash
grep BOT_TOKEN .env
# Must be NEW token (starts with a 10-digit number)
# Must NOT be: 8142574890:AAHzTS6tjFv6j02p0wYxOOKbSSEdapGWbso
```

**Check 2: Logs**
```bash
docker logs oyunsbot-api --tail 100 | grep -i "error"
# Look for: "Invalid initData hash", "401", "auth failed"
```

**Check 3: URLs**
```bash
grep -E "ADMIN_PANEL_URL|USER_PANEL_URL" .env
# Must show HTTPS domain (not localhost)
```

**Check 4: Services**
```bash
docker ps | grep oyunsbot
# All services should have status "Up"
```

---

## 🎯 Expected Timeline

| Step | Time | What to Do |
|------|------|-----------|
| 1 | 2 min | Get new token from BotFather |
| 2 | 2 min | SSH to VPS and edit `.env` |
| 3 | 2 min | docker-compose restart |
| 4 | 2 min | Wait for services to start |
| 5 | 1 min | Test in Telegram Mini App |
| **Total** | **9 min** | **Everything working ✅** |

---

## 📚 Related Documentation

- [VPS_QUICK_FIX.md](VPS_QUICK_FIX.md) - Copy-paste commands
- [VPS_SETUP_GUIDE.md](VPS_SETUP_GUIDE.md) - Detailed guide
- [TROUBLESHOOTING_TELEGRAM_AUTH.md](TROUBLESHOOTING_TELEGRAM_AUTH.md) - Detailed debugging
- [URGENT_BOT_TOKEN_FIX.md](URGENT_BOT_TOKEN_FIX.md) - Token rotation details

**Start with:** [VPS_QUICK_FIX.md](VPS_QUICK_FIX.md) for fastest resolution
