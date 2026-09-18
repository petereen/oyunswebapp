/**
 * The single source of truth for client-side React Query keys.
 *
 * User-scoped resources always include the authenticated Telegram user id so a
 * browser login can never reuse another user's cached response.
 */
export const queryKeys = {
  profile: (userId: number) => ["user", "profile", userId] as const,
  rates: ["rates"] as const,
  appSettings: ["app-settings"] as const,
  serviceStatus: ["service-status"] as const,
  trackers: {
    transactions: (userId: number) => ["trackers", "transactions", userId] as const,
    gifts: (userId: number) => ["trackers", "gifts", userId] as const,
    fuel: (userId: number) => ["trackers", "fuel", userId] as const,
    pendingGifts: (userId: number) => ["trackers", "pending-gifts", userId] as const,
  },
  admin: {
    bankAccounts: ["admin", "bank-accounts"] as const,
    analytics: ["admin", "analytics"] as const,
    shiftContext: ["admin", "shift-context"] as const,
    workingHours: ["admin", "working-hours"] as const,
    oyunsPlusCards: ["admin", "oyuns-plus", "cards"] as const,
    oyunsPlusRequests: (status: string) => ["admin", "oyuns-plus", "requests", status] as const,
  },
  userPromos: (userId: number) => ["user", "promos", userId] as const,
  stats: {
    analytics: (userId: number) => ["stats", "analytics", userId] as const,
    history: (userId: number) => ["stats", "history", userId] as const,
  },
  oyunsPlus: {
    summary: (userId: number) => ["oyuns-plus", "summary", userId] as const,
    history: (userId: number) => ["oyuns-plus", "history", userId] as const,
  },
  ratesHistory: (days: number) => ["rates", "history", days] as const,
} as const;
