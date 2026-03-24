# OYUNS FINANCE — Comprehensive UI/UX Redesign Prompt

## Overview

Redesign the existing Oyuns Finance Telegram Mini-App (React 18 + TypeScript + Tailwind CSS + Vite + Lucide-react icons) from a single-page modal-based layout into a **tab-based navigation app with a persistent bottom navbar**. The current ocean-blue glass-card design language must be preserved and refined — not replaced. All existing backend API endpoints, data models, authentication (Telegram JWT), and business logic remain unchanged. This is a **frontend-only** restructuring.

---

## CURRENT STATE SUMMARY

### Tech Stack (unchanged)
- React 18 + TypeScript
- Vite build tool
- Tailwind CSS with custom `ocean` color palette (`ocean-50` through `ocean-700`)
- TanStack React Query v5 for data fetching/caching
- Axios with JWT interceptor (`api.ts`)
- Lucide-react icons
- Headless UI components
- Telegram WebApp SDK integration

### Current Architecture
- **App.tsx**: Single entry point with header (logo + admin toggle), renders Dashboard or AdminPanel
- **Dashboard.tsx**: Monolithic page containing: header, rate card, exchange CTA, converter, plus modal overlays (ProfileModal, HistoryModal, AnalyticsModal, RegistrationModal, RequiredInfoModal)
- **ExchangeFlow.tsx**: 7-step exchange wizard (direction → promo → amount → admin bank → receipt upload → receiving bank → success)
- **GiftFlow.tsx**: 5-step gift wizard (select card → recipient → amount/message → admin bank/receipt → confirm)
- **ProfileModal.tsx**: Modal overlay for viewing/editing user profile and bank info
- **HistoryModal.tsx**: Modal overlay for transaction history list
- **AnalyticsModal.tsx**: Modal overlay for analytics charts
- All modals use `fixed inset-0 bg-black/50` overlay pattern
- Support chat FAB fixed at bottom-right
- No routing library — state-based view switching

### Current Styling Patterns
- `.glass-card`: `background: rgba(255,255,255,0.92); backdrop-filter: blur(12px); box-shadow: 0 12px 40px rgba(37,99,235,0.08);`
- Cards: `glass-card p-5 rounded-2xl border border-white/60`
- Primary buttons: `bg-ocean-600 text-white rounded-xl font-bold shadow-lg shadow-ocean-200 hover:bg-ocean-700`
- Inputs: `border border-ocean-100 bg-white/70 p-3 rounded-xl focus:ring-2 focus:ring-ocean-500`
- Page background: `bg-gradient-to-br from-ocean-50 to-white`
- Font: Inter, system-ui
- Language: Mongolian (MN)

### Existing API Functions (from `api.ts` — do not modify)
- `fetchRates()` → `Rate { buy_rate, sell_rate, updated_at }`
- `fetchMe()` → `{ user: UserProfile, is_admin: boolean }`
- `fetchServiceStatus()` → `ServiceStatus { is_open, is_within_hours, ... }`
- `fetchAnalytics()` → `{ monthly_buy, monthly_sell, total_buy_rub, total_sell_rub, total_transactions }`
- `fetchHistory()` → transaction history array
- `createExchange(...)` → exchange creation
- `fetchGiftCards()`, `searchUserByPhone()`, `createGift(...)` → gift flow
- `fetchAdminBankAccounts()` → admin bank accounts
- `requestPresign(...)` → file upload URLs
- `validatePromoCode(...)`, `fetchUserPromoCodes()` → promo codes
- `updateBankInfo(...)` → profile updates
- `agreeToTerms()` → terms agreement

---

## TARGET STATE — NEW ARCHITECTURE

### Navigation Structure

Replace the current single-page + modals architecture with a **4-tab bottom navigation bar**:

| Tab Index | Label | Icon | Description |
|-----------|-------|------|-------------|
| 0 | **Нүүр** (Home) | `Home` (lucide) | Dashboard with quick actions, rates, calculator, rate history chart |
| 1 | **Гүйлгээ** (Transaction) | `ArrowLeftRight` (lucide) | Full exchange flow with modern currency converter card UI |
| 2 | **Үйлчилгээ** (Other Services) | `LayoutGrid` or `Grip` (lucide) | Gift flow + Fuel credit service (placeholder) |
| 3 | **Статистик** (User Stats) | `BarChart3` (lucide) | Analytics, transaction history, summary cards |

Additionally, a **full-screen Profile page** (not a modal) accessible from the Home tab's top-right user icon.

---

## BOTTOM NAVIGATION BAR

### Design Specifications
- **Position**: Fixed at the very bottom of the viewport (`fixed bottom-0 left-0 right-0`)
- **Height**: 64–72px including safe area padding
- **Background**: `bg-white/95 backdrop-blur-lg border-t border-slate-100`
- **Shadow**: Subtle upward shadow: `shadow-[0_-4px_20px_rgba(0,0,0,0.05)]`
- **Layout**: 4 equal-width flex items horizontally centered
- **Each tab item**: Flex column with icon (24px) + label (10–11px) + 4px gap
- **Active state**: `text-ocean-600` with a small filled dot indicator (4px) below the label, or icon filled variant
- **Inactive state**: `text-slate-400`
- **Transition**: `transition-colors duration-200`
- **Safe area**: Add `pb-safe` or `pb-[env(safe-area-inset-bottom)]` for iOS notch devices
- **Z-index**: `z-50` to stay above all content
- **Body padding**: Add `pb-20` to the main content area so nothing is hidden behind the navbar

### Implementation
```tsx
// Components to create: BottomNavBar.tsx
// State: activeTab stored in App.tsx, passed down or via context
// Tab switching: setState in App.tsx, conditional rendering of tab content
// No router library needed — keep current state-based approach
```

---

## TAB 0 — HOME (Нүүр)

### Top Bar Layout
- **Left side**: Oyuns Finance icon-only logo loaded from:  
  `https://ldolpsylyatkxqsgxhkn.supabase.co/storage/v1/object/public/Oyuns%20Finance/icon%20only.png`  
  Size: `h-9 w-9 rounded-xl` — just the icon, no text logo
- **Right side**: User profile avatar/icon button
  - If verified: Circular button with `User` icon, `bg-ocean-100 text-ocean-600`, `w-10 h-10 rounded-full`
  - If not verified: `UserPlus` icon with `bg-ocean-600 text-white` to prompt registration
  - On tap → navigate to full-screen Profile page (not modal)
- **No** refresh button in the top bar (pull-to-refresh can be handled differently)
- **Greeting**: Below the top bar, show `Сайн байна уу, {user.first_name}` in `text-lg font-semibold text-slate-800`

### Buy/Sell Quick Action Row
Directly below the greeting. Three buttons in a row:

1. **Buy Button** (left, flex-1):
   - Rectangle shape, `rounded-2xl`, generous padding (`p-4`)
   - Background: `bg-green-500` or `bg-emerald-500` with white text
   - Content: "Худалдаж авах" (Buy) label + `ArrowDownLeft` icon (45° down arrow representing receiving)
   - On tap → switch to Transaction tab (index 1) with `direction` pre-set to `"buy"`

2. **Sell Button** (middle, flex-1):
   - Rectangle shape, `rounded-2xl`, generous padding (`p-4`)
   - Background: `bg-red-500` or `bg-rose-500` with white text
   - Content: "Зарах" (Sell) label + `ArrowUpRight` icon (45° up arrow representing sending)
   - On tap → switch to Transaction tab (index 1) with `direction` pre-set to `"sell"`

3. **Transaction Shortcut** (right, square ~56x56px):
   - Square button, `rounded-2xl`, `bg-ocean-100 text-ocean-600`
   - Contains `ArrowLeftRight` icon (two-way arrow)
   - On tap → switch to Transaction tab (index 1) with no preset direction
   - `aspect-square` to keep it square

Layout: `flex gap-3` with the two rectangle buttons sharing equal space and the square button on the far right.

### Exchange Rates Section
Below the quick actions. Reuse and refine the existing `RateCard` component:
- Same glass-card style but slightly more compact
- Two columns: Buy rate (RUB→MNT) and Sell rate (MNT→RUB)
- Each showing the rate number prominently (`text-2xl font-bold`)
- Last updated timestamp at the bottom
- Keep existing `Wallet`, `TrendingUp`, `Clock3` icons

### Exchange Rate Calculator
Below the rates. Reuse and refine the existing `Converter` component:
- Same glass-card container
- Direction toggle button
- Input field for "from" amount with currency symbol prefix
- Display field for "to" amount
- Keep existing calculation logic (`buy: amount * rate`, `sell: amount / rate`)

### Exchange Rate History Graph
**New section** below the calculator:
- Glass-card container with header "Ханшийн түүх" (Rate History)
- A simple line chart showing historical buy/sell rates over time
- Can reuse SVG chart pattern from `AnalyticsModal.tsx`
- Period selector (7 days / 30 days / 90 days)
- Two lines: one for buy rate (green), one for sell rate (blue)
- If historical rate data is not available from the API yet, show a placeholder with "Удахгүй нэмэгдэнэ" (Coming soon) message
- This may require a new API endpoint — for now, render a placeholder card

### Transaction Status Trackers
Keep the existing `TransactionStatusTracker`, `GiftStatusTracker`, and `PendingGiftBanner` components at the top of the Home tab (between greeting and buy/sell buttons), exactly as they currently function. They show real-time pending transaction progress and are dismissed once completed.

### Registration / Verification States
Preserve existing conditional rendering logic:
- **Not registered**: Show a prominent registration banner instead of the buy/sell buttons. CTA to open RegistrationModal (keep as modal).
- **Pending verification**: Show amber status card with spinner. Disable buy/sell buttons.
- **Verified**: Show buy/sell buttons and full home content.
- **Missing required info**: Trigger `RequiredInfoModal` (keep as modal) when user taps buy/sell.
- **Outside working hours**: Show hours info card overlaying the buy/sell section.

---

## TAB 1 — TRANSACTION (Гүйлгээ)

### Design Concept
Replace the current 7-step wizard with a **single-view currency converter card** that feels premium and modern, inspired by fintech apps like Wise/Revolut. The multi-step process should flow from the card but with a cleaner, less overwhelming UX.

### Main Exchange Card Container
- Full-width card with `rounded-3xl` corners
- Background: `bg-white`
- Shadow: `shadow-xl shadow-slate-200/50`
- Padding: `p-6`
- No border or very subtle `border border-slate-100`

### Top Section — "You Give" Currency
- **Label row**: Left-aligned gray text "Та илгээнэ" (You give) in `text-sm text-slate-400`
- **Min amount hint**: Right-aligned `text-xs text-slate-400` showing "Хамгийн бага: 5,000 ₽" (or ₮ depending on direction), pulled from `fetchAppSettings()` min_rub_amount
- **Currency row** (below labels):
  - **Left side — Currency selector dropdown**:
    - Shows flag emoji + currency code: e.g., "🇷🇺 RUB" or "🇲🇳 MNT"
    - `bg-slate-50 rounded-xl px-4 py-3` with `ChevronDown` icon
    - On tap: Toggle between RUB and MNT (which effectively switches direction)
    - Since only 2 currencies exist, this is just a styled toggle/dropdown
  - **Right side — Amount input**:
    - Massive font: `text-3xl md:text-4xl font-bold text-right`
    - `border-none outline-none bg-transparent w-full`
    - Placeholder: "0" in `text-slate-200`
    - No visible border, no ring on focus — seamless typographic look
    - `text-right` alignment
    - `type="text"` with manual number formatting (add thousand separators as user types)

### Swap Separator
- A thin horizontal line: `border-t border-slate-100` stretching full width
- **Swap button**: Positioned at `absolute` center-left of the separator
  - Circular: `w-10 h-10 rounded-full`
  - Background: `bg-slate-50 border border-slate-200`
  - Icon: `ArrowUpDown` or `ArrowDownUp` (vertical swap icon, 20px, `text-slate-500`)
  - Uses `absolute left-6 top-1/2 -translate-y-1/2` to overlap the border line
  - The parent of both sections needs `relative` positioning
  - On tap: Swap the "from" and "to" currencies (toggle direction between buy/sell)
  - Hover effect: `hover:bg-slate-100 transition`
  - Active animation: Rotate icon 180° on swap with `transition-transform duration-300`

### Bottom Section — "You Receive" Currency
- Mirrors the top section layout exactly
- **Label**: "Та хүлээн авна" (You receive) in `text-sm text-slate-400`
- **Currency selector**: Shows the opposite currency from the top (if top is RUB, bottom is MNT)
- **Amount display**: Same massive font `text-3xl md:text-4xl font-bold text-right text-ocean-700`
  - **Read-only** — calculated from the input × rate
  - Shows the converted amount with thousand separators
  - Updates in real-time as user types in the top input
  - Formatted with 2 decimal places

### Rate Display Strip
Below the card, a small informational strip:
- `text-sm text-slate-500 text-center py-2`
- Shows: "1 RUB = {buy_rate} MNT" or "1 MNT = {1/sell_rate} RUB" depending on direction
- Include a small `Info` icon

### Proceed Button
Below the rate strip:
- Full-width `bg-ocean-600 text-white py-4 rounded-2xl font-bold text-lg`
- Text: "Үргэлжлүүлэх" (Continue)
- `shadow-lg shadow-ocean-200`
- Disabled state: `bg-slate-200 text-slate-400` when amount is 0 or below minimum
- On tap → proceed to the remaining exchange steps (promo code → admin bank selection → receipt upload → receiving bank → success)

### Remaining Exchange Steps
After the user taps "Continue" from the converter card, the subsequent steps should appear as **stacked cards sliding in** (not a full page replacement). Each step is a card that slides up or fades in:

1. **Promo Code Step** (optional, can be skipped):
   - Small card with promo input field + "Ашиглах" (Apply) button
   - If user has existing promo codes, show them as tappable chips
   - Skip button: "Алгасах" (Skip)

2. **Admin Bank Selection**:
   - For BUY (RUB→MNT): Show list of active RUB admin bank accounts as selectable cards
   - For SELL (MNT→RUB): Show MNT admin bank accounts
   - Each card shows: bank name, account number, owner name, copy buttons
   - Selected state: `ring-2 ring-ocean-500`

3. **Receipt Upload**:
   - Upload area with dashed border, camera/upload icon
   - Support multiple receipt images (existing logic)
   - Preview thumbnails of uploaded images
   - "Үргэлжлүүлэх" button after at least 1 receipt uploaded

4. **Receiving Bank Confirmation**:
   - If user has saved bank info: Show pre-filled card with option to use saved or enter new
   - If no saved info: Show bank entry form (bank dropdown + account + owner name)
   - For BUY: MNT bank details form
   - For SELL: RUB bank details form (SBP phone + card + owner)

5. **Success Screen**:
   - Checkmark animation
   - Invoice ID display with copy button
   - "Нүүр хуудас руу буцах" (Return to Home) button

### Direction Pre-setting
When navigating from Home tab's Buy/Sell buttons:
- Accept an optional `initialDirection` prop
- If provided, pre-set the converter card's direction (skip direction selection)
- Buy → top currency = RUB, bottom = MNT
- Sell → top currency = MNT, bottom = RUB

---

## TAB 2 — OTHER SERVICES (Үйлчилгээ)

### Layout
- Clean grid layout with service cards: `grid grid-cols-2 gap-4 p-4`
- Each service is a large tappable card

### Service Card 1 — Gift Flow (Бэлэг)
- Card with gradient background: `bg-gradient-to-br from-pink-500 to-purple-500`
- Icon: `Gift` (lucide, white, 40px)
- Title: "Бэлэг илгээх" (Send Gift) in white
- Subtitle: "Найздаа мөнгө бэлэглэх" (Gift money to a friend) in white/70
- On tap → open the existing `GiftFlow` component (keep its current step-based logic, but apply the same clean card styling as the transaction tab)

### Service Card 2 — Fuel Credit (Шатахуун)
- Card with gradient background: `bg-gradient-to-br from-amber-500 to-orange-500`
- Icon: `Fuel` or `Flame` (lucide, white, 40px)
- Title: "Шатахууны зээл" (Fuel Credit) in white
- Subtitle: "Монгол жолоочдод зориулсан" (For Mongolian truckers) in white/70
- On tap → open a **placeholder page** for the fuel credit feature

### Fuel Credit Placeholder Page
This feature is about selling fuel to Mongolian long-haul truckers. The concept:
> Монгол дальнобойщикуудад зориулсан шатахууны үйлчилгээ. Жолоочид рубль худалдаж авах, замд шаардлагатай бүх зардлыг төлөх, шатахуун худалдан авах боломжтой. Систем нь захиалга авсанаас хойш бэлэн заявка үүсгэж Максимд автоматаар дамжуулна. Заправкийн дараа чек системд оруулна.

Placeholder content:
- Header: "Шатахууны үйлчилгээ" with `Fuel`/`Flame` icon
- Description paragraph explaining the service (in Mongolian)
- "Удахгүй нэмэгдэнэ" (Coming soon) badge
- Illustration or icon-based visual
- The UI structure should mirror the exchange flow (same card-based design) so it can be built out later with:
  - Its own exchange rates (different from currency exchange)
  - Its own admin (Maxim)
  - Receipt/bill upload flow
  - Order tracking similar to `TransactionStatusTracker`

Future implementation notes (for developers):
- Will need a separate `fuel_rates` endpoint
- Will need a separate admin role or admin_id for Maxim
- Will need `fuel_orders` table with fields: order_id, driver_id, amount_rub, liters, station, receipt_url, status
- Notification flow: order created → sent to Maxim (Telegram) → fueling done → receipt uploaded → confirmed
- For now, just build the UI shell with "coming soon" state

### Other services that can be added later
- The grid layout should accommodate future service cards naturally
- Leave room for 3–4 more cards in the grid

---

## TAB 3 — USER STATS (Статистик)

### Content
Move the existing `AnalyticsModal` and `HistoryModal` content here as **inline sections** (not modals):

#### Section 1 — Summary Cards
- Same 3-card grid from AnalyticsModal:
  - Total RUB bought (green gradient)
  - Total MNT bought (blue gradient)
  - Total transactions (ocean gradient)
- Keep existing styling

#### Section 2 — Monthly Charts
- Move the line chart from AnalyticsModal inline
- Period navigation (← previous / next →)
- Buy line (green) + Sell line (blue)
- Keep existing SVG chart implementation

#### Section 3 — Transaction History
- Move the HistoryModal content inline as a scrollable list
- Each transaction row shows: invoice ID, direction, amount, status badge, timestamp
- Expandable rows showing receipt images and rejection comments
- Status badges: pending (amber), approved (blue), completed (green), rejected (red)
- Keep existing pagination or add infinite scroll
- Search/filter bar at the top

---

## PROFILE PAGE (Full-Screen, not Modal)

### Navigation
- Accessed from the **Home tab's top-right user icon**
- Renders as a **full-screen page** that replaces the current tab content
- The **bottom navbar remains visible** underneath — user can still see and tap nav items
- Back button in the top-left corner to return to Home tab
- Use a `showProfile` state in App.tsx: when true, render ProfilePage over the current tab content but below the navbar (z-index layering)

### Top Section — User Identity
- User avatar circle: First letter of name, `bg-ocean-100 text-ocean-600`, `w-20 h-20 rounded-full text-2xl font-bold` centered
- User full name: `text-xl font-bold`
- Username: `@{username}` in `text-slate-500`
- Telegram ID in small text
- Verification badge: Green checkmark if verified, amber pending if awaiting

### Section 1 — General (Ерөнхий)
- Section header: "Ерөнхий" with settings gear icon
- **Personal Information** card:
  - First name, Last name (read-only, from Telegram)
  - Email (editable)
  - Phone (editable)
- **Bank Accounts** card:
  - MNT bank info: Bank name, Account number, Owner name, Phone
  - RUB bank info (if exists): Bank name, SBP phone, Card number, Owner name
  - Edit button to toggle inline editing (use existing `updateBankInfo` API)
  - Same bank edit form logic as current ProfileModal's edit mode
- **Promo Codes** card (expandable):
  - List of user's promo codes with status and discount percentage
  - Reuse existing promo display logic from ProfileModal

### Section 2 — Privacy & Security (Нууцлал)
- Section header: "Нууцлал ба Аюулгүй байдал" with `Shield` icon
- **Authentication info**: Show how user is authenticated (Telegram WebApp)
- **Data stored**: Brief explanation of what data is stored
- **Passport photo**: If uploaded, show a small thumbnail with a note that it's securely stored
- **Delete account**: A danger-zone button (can be a placeholder that says "Холбоо барина уу" / Contact us)

### Section 3 — Oyuns (Oyuns)
- Section header: "Oyuns Finance" with the logo icon
- **User Agreement**: Tappable row → opens `https://oyuns.mn/user-agreement` in external browser
- **Contacts**: Display support contacts
  - Telegram: `@oyuns_finance` (tappable link to `https://t.me/oyuns_finance`)
  - Website: `oyuns.mn`
- **Support**: "Тусламж авах" (Get help) → link to `https://t.me/oyuns_finance`
- **App version**: Small text at the bottom "v0.1.0"

### Design Style
- Each section is a `glass-card rounded-2xl` with section header
- List items are rows with icon + label + value/chevron
- Consistent padding and spacing
- Clean, settings-page feel (like iOS Settings)

---

## APP.TSX RESTRUCTURING

### New State Management
```
activeTab: 0 | 1 | 2 | 3 (default: 0)
showProfile: boolean (default: false)
transactionDirection: "buy" | "sell" | null (for pre-setting from Home)
```

### New Component Hierarchy
```
App.tsx
├── [Admin check: if admin && view === "admin"] → AdminPanel
├── [else: Client view]
│   ├── Content Area (with pb-20 for navbar space)
│   │   ├── [showProfile] → ProfilePage (full screen, above tabs, below navbar)
│   │   ├── [activeTab === 0] → HomeTab
│   │   │   ├── StatusTrackers (TransactionStatusTracker, GiftStatusTracker, PendingGiftBanner)
│   │   │   ├── BuySellButtons
│   │   │   ├── RateCard
│   │   │   ├── Converter
│   │   │   └── RateHistoryChart (new, placeholder)
│   │   ├── [activeTab === 1] → TransactionTab
│   │   │   └── ExchangeFlow (redesigned)
│   │   ├── [activeTab === 2] → ServicesTab
│   │   │   ├── GiftServiceCard → GiftFlow
│   │   │   └── FuelServiceCard → FuelPlaceholder
│   │   └── [activeTab === 3] → StatsTab
│   │       ├── AnalyticsSummary (from AnalyticsModal)
│   │       ├── MonthlyChart (from AnalyticsModal)
│   │       └── TransactionHistory (from HistoryModal)
│   └── BottomNavBar (fixed, z-50)
├── RegistrationModal (overlay, kept as modal)
├── RequiredInfoModal (overlay, kept as modal)
├── TelegramDiagnostic
└── DevToolbar
```

### Remove
- The support chat FAB (bottom-right "Тусламж" button) — move it to Profile page under Oyuns section
- The old header with full-width logo — replace with compact top bar per tab
- HistoryModal as a standalone modal — inline it in Stats tab
- AnalyticsModal as a standalone modal — inline it in Stats tab
- ProfileModal — replace with full-screen ProfilePage

### Keep as Modals (unchanged)
- `RegistrationModal` — registration is a one-time popup flow
- `RequiredInfoModal` — quick info update popup
- `TermsAgreementModal` — terms confirmation popup

---

## NEW FILES TO CREATE

| File | Purpose |
|------|---------|
| `src/components/BottomNavBar.tsx` | Persistent bottom navigation bar |
| `src/pages/HomeTab.tsx` | Home tab content (extracted from Dashboard.tsx) |
| `src/pages/TransactionTab.tsx` | Transaction tab with redesigned exchange card |
| `src/pages/ServicesTab.tsx` | Other services grid (Gift + Fuel placeholder) |
| `src/pages/StatsTab.tsx` | Statistics tab (analytics + history inline) |
| `src/pages/ProfilePage.tsx` | Full-screen profile (replaces ProfileModal) |
| `src/components/ExchangeCard.tsx` | New premium currency converter card UI |
| `src/components/FuelPlaceholder.tsx` | Fuel credit coming-soon placeholder |
| `src/components/RateHistoryChart.tsx` | Rate history chart placeholder |

## FILES TO MODIFY

| File | Changes |
|------|---------|
| `src/App.tsx` | Replace single-page layout with tab-based routing + bottom navbar |
| `src/index.css` | Add new utility classes, safe-area padding, swap animations |
| `tailwind.config.js` | Add safe-area plugin utilities if needed |
| `src/components/ExchangeFlow.tsx` | Refactor step 0 (direction) removal, accept `initialDirection`, redesign remaining steps as stacked cards |
| `src/components/RateCard.tsx` | Minor refinement for compact mode |
| `src/components/Converter.tsx` | Minor refinement for home tab |
| `src/components/GiftFlow.tsx` | Apply consistent card styling (no logic changes) |

## FILES TO POTENTIALLY DELETE (after migration)

| File | Reason |
|------|--------|
| `src/pages/Dashboard.tsx` | Content split into HomeTab + TransactionTab + StatsTab |
| `src/components/ProfileModal.tsx` | Replaced by ProfilePage |
| `src/components/HistoryModal.tsx` | Content inlined into StatsTab |
| `src/components/AnalyticsModal.tsx` | Content inlined into StatsTab |

---

## DESIGN SYSTEM REFINEMENTS

### Color Palette (extend existing)
```js
// tailwind.config.js additions
colors: {
  ocean: {
    50: "#f3f8ff",
    100: "#e4eeff",
    200: "#c3d8ff",
    300: "#93b4ff",  // NEW
    400: "#5a8eff",  // NEW
    500: "#2563eb",
    600: "#1d4ed8",
    700: "#1e3a8a",
    800: "#1e2f5e",  // NEW
    900: "#0f1a3a",  // NEW
  }
}
```

### Typography Scale
- Page title: `text-xl font-bold text-slate-800`
- Section header: `text-lg font-semibold text-slate-700`
- Card title: `text-base font-semibold text-ocean-700`
- Body: `text-sm text-slate-600`
- Caption: `text-xs text-slate-400`
- Amount large: `text-3xl md:text-4xl font-bold`

### Spacing System
- Section gaps: `space-y-6`
- Card padding: `p-5` or `p-6`
- Between-card gaps: `gap-4`
- Inner card element gaps: `gap-3`
- Page horizontal padding: `px-4`
- Page top padding: `pt-4`
- Page bottom padding: `pb-24` (for bottom navbar clearance)

### Component Patterns
- **Glass cards (primary containers)**: `bg-white/92 backdrop-blur-xl rounded-2xl border border-white/60 shadow-card p-5`
- **Solid cards (exchange card)**: `bg-white rounded-3xl shadow-xl p-6`
- **Action buttons**: `bg-ocean-600 text-white rounded-2xl py-4 font-bold text-lg shadow-lg shadow-ocean-200 hover:bg-ocean-700 active:scale-[0.98] transition-all`
- **Secondary buttons**: `bg-ocean-50 text-ocean-600 rounded-xl py-3 font-semibold hover:bg-ocean-100`
- **Danger buttons**: `bg-red-50 text-red-600 rounded-xl py-3 font-semibold hover:bg-red-100`
- **Input fields**: `bg-slate-50 border-none rounded-xl px-4 py-3 text-base focus:ring-2 focus:ring-ocean-500 focus:bg-white`
- **List rows**: `flex items-center justify-between py-4 border-b border-slate-100 last:border-0`
- **Status badges**: Pill-shaped `px-3 py-1 rounded-full text-xs font-medium`

### Animations & Transitions
- Tab switching: Fade transition `transition-opacity duration-200`
- Card appear: `animate-fadeIn` (custom: `@keyframes fadeIn { from { opacity:0; transform:translateY(8px) } to { opacity:1; transform:translateY(0) } }`)
- Swap button: `transition-transform duration-300` with 180° rotation on swap
- Button press: `active:scale-[0.98] transition-transform`
- Bottom nav active indicator: `transition-all duration-200`

---

## IMPORTANT IMPLEMENTATION NOTES

1. **Preserve all existing business logic** — all API calls, validation, formatting functions (formatRussianPhone, formatCardNumber, formatIBAN, formatMongolianPhone), localStorage patterns, React Query cache keys.

2. **Preserve Telegram WebApp integration** — useTelegramAuth hook, initData handling, DevToolbar, TelegramDiagnostic.

3. **Preserve admin panel entirely** — AdminPanel.tsx and all Admin* components are untouched. The admin toggle in App.tsx should still work for admin users (perhaps moved to Profile page or a long-press easter egg).

4. **Keep all existing modals that make sense as overlays** — RegistrationModal, RequiredInfoModal, TermsAgreementModal should remain as modal popups since they are transient actions.

5. **Mobile-first** — This is a Telegram Mini-App, primarily used on mobile. All designs should be optimized for 375–430px width screens. Desktop layout (md: breakpoints) is secondary.

6. **Language**: Keep all UI text in Mongolian. Do not translate existing strings.

7. **Accessibility**: Ensure all interactive elements have appropriate tap targets (min 44×44px), focus states, and ARIA labels where needed.

8. **Performance**: Use React.memo for heavy components like charts. Avoid re-rendering all tabs — only render the active tab content, or use display:none toggling to preserve state.

9. **Existing exchange flow steps (1-6) should not lose functionality**. The visual update changes how steps look, not what they do. Every field, validation, and API call must remain intact.

10. **The bottom navbar must always be visible** — even during the exchange flow, gift flow, fuel placeholder, and profile page. Only full-screen modals (registration, required info) overlay the navbar.
