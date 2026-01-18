// NO AUTH MODE - Returns mock user without any Telegram authentication

export interface TelegramUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
}

// Simple hook that returns a default user - no authentication
export function useTelegramAuth() {
  const defaultUser: TelegramUser = {
    id: 1932946217,
    first_name: "Test",
    last_name: "User",
    username: "test_user"
  };

  return {
    initData: "",
    user: defaultUser,
    isAuthenticating: false,
    authError: null
  };
}
