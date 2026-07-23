#!/bin/bash

# API Test Script - Run from VPS to test endpoints
# Usage: bash api-test.sh

echo "╔════════════════════════════════════════════════════════════════╗"
echo "║           OYUNSBOT API TESTING SCRIPT                           ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

API_URL="http://localhost:8000/api"

echo "1️⃣  Testing API Health..."
echo "Endpoint: GET $API_URL/health"
HEALTH=$(curl -s -w "\n%{http_code}" $API_URL/health)
HTTP_CODE=$(echo "$HEALTH" | tail -n1)
RESPONSE=$(echo "$HEALTH" | head -n-1)

if [ "$HTTP_CODE" == "200" ]; then
    echo "✅ Status: $HTTP_CODE OK"
    echo "Response: $(echo $RESPONSE | python3 -m json.tool 2>/dev/null || echo $RESPONSE)"
else
    echo "❌ Status: $HTTP_CODE"
    echo "Response: $RESPONSE"
    echo ""
    echo "⚠️  API is not responding. Check docker status:"
    echo "   docker ps | grep oyunsbot"
    exit 1
fi
echo ""

echo "2️⃣  Testing Rates Endpoint (public)..."
echo "Endpoint: GET $API_URL/rates"
RATES=$(curl -s -w "\n%{http_code}" $API_URL/rates)
HTTP_CODE=$(echo "$RATES" | tail -n1)
RESPONSE=$(echo "$RATES" | head -n-1)

echo "✅ Status: $HTTP_CODE"
echo "Response: $(echo $RESPONSE | python3 -m json.tool 2>/dev/null || echo $RESPONSE)"
echo ""

echo "3️⃣  Testing Auth Issues..."
echo "Endpoint: GET $API_URL/me (without auth header)"
NOAUTH=$(curl -s -w "\n%{http_code}" $API_URL/me)
HTTP_CODE=$(echo "$NOAUTH" | tail -n1)
RESPONSE=$(echo "$NOAUTH" | head -n-1)

if [ "$HTTP_CODE" == "401" ]; then
    echo "✅ Correctly returns 401 (auth required)"
    echo "Response: $RESPONSE"
else
    echo "⚠️  Unexpected status: $HTTP_CODE"
    echo "Response: $RESPONSE"
fi
echo ""

echo "4️⃣  Docker Service Status..."
docker ps --filter "name=oyunsbot" --format "table {{.Names}}\t{{.Status}}"
echo ""

echo "5️⃣  Recent API Logs..."
echo "Looking for errors in last 50 lines..."
ERROR_COUNT=$(docker logs oyunsbot-api --tail 50 2>/dev/null | grep -iE "error|exception|401|unauthorized" | wc -l)

if [ "$ERROR_COUNT" -gt 0 ]; then
    echo "❌ Found $ERROR_COUNT error(s):"
    docker logs oyunsbot-api --tail 50 2>/dev/null | grep -iE "error|exception|401|unauthorized"
else
    echo "✅ No errors found in recent logs"
fi
echo ""

echo "6️⃣  Environment Check..."
echo "Checking .env file..."

BOT_TOKEN_VALUE=$(grep "^BOT_TOKEN=" .env | cut -d'=' -f2-)
if [ -z "$BOT_TOKEN_VALUE" ] || [ "$BOT_TOKEN_VALUE" = "YOUR_BOT_TOKEN_HERE" ]; then
    echo "❌ CRITICAL: BOT_TOKEN is missing or still a placeholder!"
    echo "   Create a token with @BotFather and set it in .env"
    exit 1
else
    BOT_TOKEN_LENGTH=$(printf %s "$BOT_TOKEN_VALUE" | wc -c)
    if [ "$BOT_TOKEN_LENGTH" -lt 30 ]; then
        echo "⚠️  Bot token seems short (length: $BOT_TOKEN_LENGTH)"
    else
        echo "✅ Bot token appears valid (length: $BOT_TOKEN_LENGTH)"
    fi
fi

echo ""
echo "ADMIN_PANEL_URL: $(grep 'ADMIN_PANEL_URL=' .env | cut -d'=' -f2)"
echo "USER_PANEL_URL: $(grep 'USER_PANEL_URL=' .env | cut -d'=' -f2)"

if grep -q "localhost" .env; then
    echo "⚠️  WARNING: localhost URLs found in .env (won't work on VPS)"
fi
echo ""

echo "╔════════════════════════════════════════════════════════════════╗"
echo "║                    TEST COMPLETE                               ║"
echo "╚════════════════════════════════════════════════════════════════╝"
