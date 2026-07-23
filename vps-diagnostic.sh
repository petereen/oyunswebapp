#!/bin/bash

# VPS Diagnostic Script
# Run this on your VPS to diagnose the API issue

echo "=== OYUNSBOT VPS DIAGNOSTICS ==="
echo ""

echo "1️⃣  Checking Bot Token..."
BOT_TOKEN=$(grep "^BOT_TOKEN=" .env | cut -d'=' -f2-)
if [[ -z "$BOT_TOKEN" || "$BOT_TOKEN" == "YOUR_BOT_TOKEN_HERE" ]]; then
    echo "❌ CRITICAL: BOT_TOKEN is missing or still a placeholder!"
    echo "   Create a token with @BotFather and set it in .env"
else
    echo "✅ Bot token appears to be updated"
    echo "   Token: ${BOT_TOKEN:0:20}..."
fi
echo ""

echo "2️⃣  Checking Docker Containers..."
docker ps --filter "name=oyunsbot" --format "table {{.Names}}\t{{.Status}}"
echo ""

echo "3️⃣  Checking API Logs (last 30 lines)..."
echo "--- API Container Logs ---"
docker logs oyunsbot-api --tail 30 2>/dev/null | grep -E "error|401|auth|Telegram" || echo "No auth errors found"
echo ""

echo "4️⃣  Checking ADMIN_PANEL_URL and USER_PANEL_URL..."
ADMIN_URL=$(grep "ADMIN_PANEL_URL=" .env | cut -d'=' -f2)
USER_URL=$(grep "USER_PANEL_URL=" .env | cut -d'=' -f2)
echo "ADMIN_PANEL_URL=$ADMIN_URL"
echo "USER_PANEL_URL=$USER_URL"

if [[ "$ADMIN_URL" == *"localhost"* ]] || [[ "$USER_URL" == *"localhost"* ]]; then
    echo "⚠️  WARNING: URLs point to localhost (won't work on VPS)"
    echo "   Update to your actual domain"
fi
echo ""

echo "5️⃣  Testing API Endpoint..."
echo "Testing: GET /api/health"
curl -s http://localhost:8000/api/health | python3 -m json.tool 2>/dev/null || echo "❌ API not responding"
echo ""

echo "6️⃣  Checking Environment Variables..."
echo "SUPABASE_URL: $(grep 'SUPABASE_URL=' .env | cut -d'=' -f2 | cut -c1-50)..."
echo "SUPABASE_KEY: $(grep 'SUPABASE_KEY=' .env | cut -d'=' -f2 | cut -c1-50)..."
echo "BOT_TOKEN length: ${#BOT_TOKEN}"
echo ""

echo "=== END DIAGNOSTICS ==="
