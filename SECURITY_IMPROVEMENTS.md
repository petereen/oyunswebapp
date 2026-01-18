# Security Improvements - User ID & Authentication

## ✅ Changes Implemented

### 1. **Removed Exposed Bot Token** 🚨 CRITICAL
- **File**: `backend/utils.py` (Line 18)
- **Issue**: Hardcoded bot token was visible in source code
- **Fix**: Removed the hardcoded `BOT_TOKEN` variable
- **Action Required**: 
  - ⚠️ **IMMEDIATELY rotate your bot token** via [@BotFather](https://t.me/botfather)
  - Update your `.env` file with the new token
  - Never commit bot tokens to version control

### 2. **Backend Admin Validation**
- **File**: `backend/config.py`
- **Added**: `admin_user_ids` to Settings class
- **Environment Variable**: `ADMIN_USER_IDS` (comma-separated Telegram user IDs)
- **Default**: Falls back to original hardcoded list if not set in environment
- **Usage**: Set in `.env` file like: `ADMIN_USER_IDS=123456,789012,345678`

### 3. **New Admin Middleware**
- **File**: `backend/main.py`
- **Function**: `require_admin_user()`
- **Purpose**: Validates that authenticated user is in the admin user IDs list
- **Security**: Server-side validation prevents frontend bypass

### 4. **Enhanced /api/me Endpoint**
- **Returns**: User profile + `is_admin` boolean flag
- **Benefit**: Frontend gets admin status from authenticated backend
- **Security**: Admin status determined by server, not client

### 5. **Updated Frontend Admin Check**
- **File**: `frontend/src/App.tsx`
- **Removed**: Hardcoded `ADMIN_IDS` array from frontend
- **New Flow**: 
  1. User authenticates via Telegram WebApp
  2. Frontend calls `/api/me` with initData
  3. Backend validates initData and checks if user is admin
  4. Frontend receives `is_admin` flag
  5. Admin panel visibility based on backend response

## 🔒 User ID Security Flow

### How User IDs are Fetched and Validated

```
┌─────────────────┐
│  Telegram User  │
└────────┬────────┘
         │ Opens Mini App
         ▼
┌─────────────────────────────────────┐
│  window.Telegram.WebApp.initData    │ ← Telegram provides signed data
│  - Contains: user.id, hash, etc.    │
└────────┬────────────────────────────┘
         │ Sent with every API request
         ▼
┌─────────────────────────────────────┐
│  Backend: verify_telegram_init_data │
│  1. Parse initData query string     │
│  2. Extract 'hash' parameter        │
│  3. Calculate HMAC-SHA256 using     │
│     bot token as secret             │
│  4. Compare hashes                  │
│  5. If valid → Extract user.id      │
│  6. If invalid → Reject (401)       │
└────────┬────────────────────────────┘
         │ Authenticated user.id
         ▼
┌─────────────────────────────────────┐
│  Personalized Experience            │
│  - User-specific transactions       │
│  - Personal profile                 │
│  - Transaction history              │
│  - Admin access (if authorized)     │
└─────────────────────────────────────┘
```

## 📋 Personalization Features

### Current Implementation

1. **User Profile** (`/api/me`)
   - Auto-creates/updates user record on first access
   - Stores: id, first_name, last_name, phone, bank details
   - Returns: full profile + verification status + admin status

2. **Transaction History** (`/api/history`)
   - User-specific: `WHERE user_id = authenticated_user.id`
   - Shows last 50 transactions
   - Includes: invoice, amount, status, timestamps, rates

3. **Exchange Transactions** (`/api/exchange/create`)
   - Linked to authenticated user ID
   - Prevents spoofing (user can't create transactions for others)
   - Admin notifications reference user ID

4. **Admin Access Control**
   - Server-side validation of admin user IDs
   - Admin panel features restricted by user ID
   - KYC actions logged with admin user ID

## 🛡️ Security Best Practices

### ✅ What You're Doing Right

1. **HMAC Validation**: Using HMAC-SHA256 to verify Telegram data
2. **Never Trust Frontend**: User ID from `initDataUnsafe` is only for display
3. **Server-Side Auth**: All sensitive operations validate initData on backend
4. **Database Isolation**: Users can only access their own data
5. **Authenticated Endpoints**: All user endpoints require valid initData

### ⚠️ Important Reminders

1. **Bot Token Security**
   - NEVER hardcode in source code
   - Store in environment variables only
   - Rotate immediately if exposed
   - Add `.env` to `.gitignore`

2. **Admin Access**
   - Use `require_admin_user()` for admin-only endpoints
   - Validate user ID on backend, not just frontend
   - Log admin actions with user IDs for audit trail

3. **InitData Validation**
   - Always validate initData on every request
   - Don't skip validation even for "safe" operations
   - Check hash expiration if needed (auth_date)

## 📦 Environment Variables

Required in `.env` file:

```bash
# Bot token - KEEP SECRET!
BOT_TOKEN=your_bot_token_here

# Admin user IDs who can access admin panel
ADMIN_USER_IDS=1932946217,1447446407,5564298862,1409343588,6351681039

# Admin chat IDs for notifications
ADMIN_CHAT_IDS=1932946217,1447446407

# Other required configs
SUPABASE_URL=...
SUPABASE_KEY=...
ADMIN_API_KEY=...
```

## 🔄 Next Steps (Optional Enhancements)

1. **Add Admin Endpoint Protection**
   - Apply `require_admin_user()` to admin endpoints
   - Example: `/api/admin/*` routes

2. **Audit Logging**
   - Log all admin actions with user IDs
   - Track who approved/rejected KYC
   - Monitor admin panel access

3. **User Preferences**
   - Store favorite conversion pairs
   - Save preferred notification settings
   - Remember default banks per user

4. **Enhanced Personalization**
   - Transaction analytics per user
   - Spending patterns
   - Loyalty rewards/promo codes
   - Personalized rate notifications

## 🚀 Testing Your Changes

1. Verify bot token is from environment:
   ```bash
   # Should NOT see bot token in code
   grep -r "BOT_TOKEN=" backend/
   ```

2. Test admin access:
   - Open app with admin user → should see admin panel toggle
   - Open app with regular user → should NOT see admin panel
   - Check browser console for `/api/me` response

3. Verify authentication:
   - All API calls should include `X-Telegram-Init-Data` header
   - Invalid initData should return 401
   - User ID in database should match Telegram user ID

## 📚 References

- [Telegram Mini Apps Documentation](https://core.telegram.org/bots/webapps)
- [Validating WebApp Data](https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app)
- [HMAC-SHA256 Validation](https://en.wikipedia.org/wiki/HMAC)
