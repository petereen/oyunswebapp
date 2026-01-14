# 🚀 VPS Quick Fix - Copy & Paste Commands

## Your Situation
- ✅ Greeting works ("Сайн байна уу, Temuulen")
- ❌ Profile/History/Analytics not loading
- 🤔 Bot token might still be old

---

## ⚡ Quick Fix (5-10 minutes)

### STEP 1: SSH to Your VPS
```bash
ssh your-username@your-vps-ip
# Enter your password when prompted
```

### STEP 2: Navigate to Project
```bash
cd /path/to/oyunsbot-webapp
# or wherever you deployed it
```

### STEP 3: Check Current Bot Token
```bash
grep BOT_TOKEN .env
```

**If you see:** `8142574890:AAHzTS6tjFv6j02p0wYxOOKbSSEdapGWbso`
→ **STOP! Follow "Bot Token Rotation" below first**

### STEP 4: Update .env File
```bash
nano .env
```

**Edit these THREE things:**

1. **BOT_TOKEN** (if old)
   - Get NEW token from @BotFather
   - Search for: `BOT_TOKEN=`
   - Replace old token with new one

2. **ADMIN_PANEL_URL**
   - Search for: `ADMIN_PANEL_URL=`
   - Replace with: `https://YOUR_VPS_DOMAIN.com?admin=true`

3. **USER_PANEL_URL**
   - Search for: `USER_PANEL_URL=`
   - Replace with: `https://YOUR_VPS_DOMAIN.com`

**To save in nano:**
- Press `Ctrl + X`
- Press `Y` (yes)
- Press `Enter`

### STEP 5: Restart Services
```bash
docker-compose down
docker-compose up -d --build
```

### STEP 6: Wait and Verify
```bash
sleep 30
docker logs oyunsbot-api --tail 20
# Should show no errors
```

### STEP 7: Test in Telegram
- Refresh your Mini App
- Profile should now load
- History should show data
- Analytics should work

---

## 🔄 Bot Token Rotation (MANDATORY if showing old token)

### On Your Local Machine (not VPS):

1. **Open Telegram**
2. **Search:** `@BotFather`
3. **Send:** `/mybots`
4. **Select:** Your bot
5. **Select:** `API Token`
6. **Select:** `Revoke current token`
7. **Copy:** The NEW token

### On Your VPS:

```bash
# Edit .env
nano .env

# Find line: BOT_TOKEN=
# Delete the old token
# Paste new token
# Ctrl+X → Y → Enter to save
```

---

## 📋 Full .env Template for VPS

Copy this entire block and paste into `nano .env`:

```
SUPABASE_URL=https://ldolpsylyatkxqsgxhkn.supabase.co
SUPABASE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxkb2xwc3lseWF0a3hxc2d4aGtuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDI3NTk4ODEsImV4cCI6MjA1ODMzNTg4MX0.ktl0Izi1d8oP3qlElTS76e4JwzLENg7m994flUeSTrw

BOT_TOKEN=PASTE_NEW_TOKEN_HERE

ADMIN_CHAT_ID=1932946217
ADMIN_CHAT_IDS=1932946217,1447446407,5564298862,1409343588,6351681039
ADMIN_USER_IDS=1932946217,1447446407,5564298862,1409343588,6351681039

ADMIN_API_KEY=oyuns-admin-key-07012026

ADMIN_PANEL_URL=https://YOUR_VPS_DOMAIN.com?admin=true
USER_PANEL_URL=https://YOUR_VPS_DOMAIN.com

BUCKET_PASSPORTS=passports
BUCKET_RECEIPTS=bills

PORT=8000
```

**Replace:**
- `PASTE_NEW_TOKEN_HERE` → Your new bot token
- `YOUR_VPS_DOMAIN.com` → Your actual domain (e.g., `oyuns.mn`)

---

## 🧪 Test Commands (Run on VPS)

```bash
# Test 1: API is running
curl -s http://localhost:8000/api/health | python3 -m json.tool

# Test 2: Check logs for errors
docker logs oyunsbot-api --tail 30 | grep -i "error\|401\|auth"

# Test 3: Check env variables loaded
docker exec oyunsbot-api env | grep BOT_TOKEN

# Test 4: Full diagnostic
bash api-test.sh
```

---

## ❓ Troubleshooting

### If profile still doesn't load:

**Check 1: Bot token**
```bash
# Should NOT show the old exposed token
grep BOT_TOKEN .env
```

**Check 2: Logs for auth errors**
```bash
docker logs oyunsbot-api --tail 50 | grep -iE "401|unauthorized|auth.*failed"
```

**Check 3: URLs**
```bash
# Should show HTTPS domain, not localhost
grep -E "ADMIN_PANEL_URL|USER_PANEL_URL" .env
```

**Check 4: Restart everything**
```bash
docker-compose down
docker-compose up -d --build
sleep 30
docker logs oyunsbot-api --tail 20
```

---

## 📞 Support Info

If you need help, collect this info:

```bash
# Get all info at once
echo "=== BOT TOKEN ===" && grep BOT_TOKEN .env
echo "" && echo "=== ADMIN URLs ===" && grep -E "ADMIN_PANEL_URL|USER_PANEL_URL" .env
echo "" && echo "=== SERVICES ===" && docker ps | grep oyunsbot
echo "" && echo "=== RECENT ERRORS ===" && docker logs oyunsbot-api --tail 50 | grep -i error || echo "No errors"
echo "" && echo "=== API HEALTH ===" && curl -s http://localhost:8000/api/health || echo "API not responding"
```

---

## ✅ When It's Working

You'll see:

```
✅ Green diagnostic badge (bottom right)
✅ Profile loads with "Сайн байна уу, Temuulen"
✅ History shows transactions
✅ Analytics displays charts
✅ Admin button visible (if admin user)
```

---

## 🎯 Summary

1. **SSH to VPS**
2. **Rotate bot token** (via @BotFather)
3. **Update .env** with new token + HTTPS URLs
4. **docker-compose restart**
5. **Test in Telegram Mini App**
6. **Should all work! ✅**

**Est. time:** 10 minutes

---

If you get stuck, run:
```bash
bash api-test.sh
```
This will diagnose the issue and show what's wrong!
