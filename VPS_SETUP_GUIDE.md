# VPS Setup & Troubleshooting Guide

docker compose down
git pull origin main
docker compose up -d --build


## ✅ What's Working (Good Signs!)

```
✅ Greeting displays: "Сайн байна уу, Temuulen"
✅ User name: Temuulen (from Telegram)
✅ Telegram SDK: Working
✅ Frontend: Running
```

This means Telegram authentication is working at the **frontend level**.

---

## ❌ What's NOT Working (API Issue)

```
❌ Profile fails to load
❌ Transaction history empty
❌ Analytics empty
```

This means **backend API validation is failing**. Likely causes:

1. **Bot token not rotated** (most likely - 80%)
2. **Backend not receiving initData header** (15%)
3. **Supabase connection issue** (5%)

---

## 🔧 VPS Environment Variables - MUST UPDATE

Your current `.env` is wrong for VPS:

```bash
# ❌ WRONG (these are for local dev)
ADMIN_PANEL_URL=http://localhost:5173?admin=true
USER_PANEL_URL=http://localhost:5173

# ✅ CORRECT for VPS
ADMIN_PANEL_URL=https://your-actual-domain.com?admin=true
USER_PANEL_URL=https://your-actual-domain.com
```

### Where to Get Your Domain:

1. **VPS Domain/IP:**
   - If you have a domain: `https://oyuns.mn` (example)
   - If using IP: `https://123.456.789.012` (less ideal)
   - **Must be HTTPS** (certificate via Nginx config)

2. **Example (with domain `oyuns.mn`):**
   ```bash
   ADMIN_PANEL_URL=https://oyuns.mn?admin=true
   USER_PANEL_URL=https://oyuns.mn
   ```

---

## 🚨 Critical: Bot Token Status

### Check Current Token on VPS:

```bash
ssh your-vps-user@your-vps-ip
cd /path/to/oyunsbot-webapp
grep BOT_TOKEN .env
```

### If it shows this ❌ STOP:
```
BOT_TOKEN=8142574890:AAHzTS6tjFv6j02p0wYxOOKbSSEdapGWbso
```

### Rotate Token NOW:

1. **Open Telegram:**
   - Find `@BotFather`
   - Send: `/mybots`
   - Select your bot
   - Select: `API Token`
   - Select: `Revoke current token`
   - **Copy NEW token**

2. **Update VPS `.env`:**
   ```bash
   ssh your-vps-user@your-vps-ip
   cd /path/to/oyunsbot-webapp
   
   # Edit .env
   nano .env
   
   # Find BOT_TOKEN line
   # Replace with NEW token
   # Save: Ctrl+X → Y → Enter
   
   # Restart services
   docker-compose down
   docker-compose up -d --build
   ```

3. **Verify in logs:**
   ```bash
   docker logs oyunsbot-api --tail 20
   # Should show no "auth" errors
   ```

---

## 📋 Complete VPS .env Template

Save this as `.env` on your VPS:

```bash
# ===== TELEGRAM BOT =====
BOT_TOKEN=PUT_YOUR_NEW_TOKEN_HERE

# ===== SUPABASE (same as local) =====
SUPABASE_URL=https://ldolpsylyatkxqsgxhkn.supabase.co
SUPABASE_KEY=eyJhbGc...

# ===== ADMIN CONFIGURATION =====
ADMIN_CHAT_ID=1932946217
ADMIN_CHAT_IDS=1932946217,1447446407,5564298862,1409343588,6351681039
ADMIN_USER_IDS=1932946217,1447446407,5564298862,1409343588,6351681039
ADMIN_API_KEY=oyuns-admin-key-07012026

# ===== VPS URLS (CHANGE THESE!) =====
ADMIN_PANEL_URL=https://YOUR_VPS_DOMAIN.com?admin=true
USER_PANEL_URL=https://YOUR_VPS_DOMAIN.com

# ===== STORAGE =====
BUCKET_PASSPORTS=passports
BUCKET_RECEIPTS=bills

# ===== SERVER =====
PORT=8000
```

**Replace:**
- `PUT_YOUR_NEW_TOKEN_HERE` → New token from BotFather
- `YOUR_VPS_DOMAIN.com` → Your actual VPS domain

---

## 🔍 Diagnostic: Run on VPS

```bash
ssh your-vps-user@your-vps-ip
cd /path/to/oyunsbot-webapp

# Run diagnostic
bash vps-diagnostic.sh
```

Or manually:

```bash
# 1. Check bot token
echo "Bot Token:"
grep BOT_TOKEN .env

# 2. Check API is running
echo -e "\nAPI Status:"
docker ps | grep oyunsbot

# 3. Check recent API logs
echo -e "\nAPI Logs:"
docker logs oyunsbot-api --tail 30 | grep -iE "error|401|auth"

# 4. Test health endpoint
echo -e "\nHealth Check:"
curl -s http://localhost:8000/api/health | python3 -m json.tool
```

---

## 🧪 Test API with Curl

If API is running, test it:

```bash
# Get rates (public, no auth needed)
curl -s http://localhost:8000/api/rates | python3 -m json.tool

# Expected response:
# {
#   "buy_rate": 3500,
#   "sell_rate": 3400,
#   "updated_at": "2026-01-14T..."
# }
```

---

## 🛠️ Fix Steps (In Order)

### Step 1: Rotate Bot Token
```bash
# Get new token from @BotFather (5 min)
# SSH to VPS
ssh user@vps
cd /path/to/oyunsbot-webapp
nano .env
# Replace BOT_TOKEN with new one
# Save and exit
```

### Step 2: Update URLs
```bash
# Still in nano (editing .env)
# Find ADMIN_PANEL_URL and USER_PANEL_URL
# Replace with your actual VPS domain (HTTPS required)
# Example: https://oyuns.mn
```

### Step 3: Restart Services
```bash
docker-compose down
docker-compose up -d --build

# Wait 30 seconds for services to start
sleep 30

# Check logs
docker logs oyunsbot-api --tail 20
```

### Step 4: Test in Frontend
1. Refresh your Telegram Mini App
2. Check browser console for errors
3. Green ✅ diagnostic badge should appear
4. Profile should load
5. History should show data
6. Analytics should work

---

## ✅ Checklist for VPS

- [ ] Bot token rotated (NEW token in `.env`)
- [ ] `ADMIN_PANEL_URL` updated to HTTPS domain (not localhost)
- [ ] `USER_PANEL_URL` updated to HTTPS domain (not localhost)
- [ ] `docker-compose restart` completed
- [ ] Docker logs show no auth errors
- [ ] `/api/health` returns 200
- [ ] Frontend profile loads with name
- [ ] History shows transactions
- [ ] Analytics displays charts
- [ ] Admin button visible (if admin user)

---

## 📊 Expected Behavior After Fix

```
Frontend Console:
✅ Telegram WebApp available: true
✅ initData: Present
✅ User data retrieved: { id: 1932946217, ... }

API Logs:
✅ Auth successful: user_id=1932946217
✅ /api/me: 200 OK
✅ /api/history: 200 OK
✅ /api/analytics: 200 OK

UI:
✅ Profile loads with "Сайн байна уу, Temuulen"
✅ History shows transactions
✅ Analytics shows charts
✅ Admin button visible
```

---

## 🚀 Full Deployment Checklist

```bash
# 1. SSH to VPS
ssh user@vps.ip

# 2. Navigate to project
cd /path/to/oyunsbot-webapp

# 3. Pull latest code
git pull origin main

# 4. Update .env with:
#    - NEW bot token
#    - Correct HTTPS URLs
nano .env

# 5. Rebuild and restart
docker-compose down
docker-compose up -d --build

# 6. Wait and verify
sleep 30
docker logs oyunsbot-api --tail 30

# 7. Test health
curl http://localhost:8000/api/health

# 8. Test in Telegram Mini App
# Open your bot, should show profile
```

---

## 📞 If Still Not Working

1. **Check bot token is NEW** (not the old exposed one)
2. **Check VPS URLs are HTTPS** (not localhost)
3. **Check docker logs:** `docker logs oyunsbot-api | grep -i error`
4. **Check Supabase connection:** Can backend reach Supabase?
5. **Check firewall:** Is port 8000 open internally? (Should be, Nginx reverse proxies)

---

## 🎯 Summary

| Component | Status | Issue |
|-----------|--------|-------|
| Telegram Auth | ✅ Working | Greeting works |
| Frontend | ✅ Working | Renders correctly |
| Backend API | ❌ Failing | 401 Unauthorized |
| Bot Token | ❌ OLD | Must rotate |
| URLs | ❌ localhost | Must update to HTTPS domain |

**Solution:**
1. Rotate bot token
2. Update URLs to HTTPS domain
3. Restart services
4. Everything works ✅
