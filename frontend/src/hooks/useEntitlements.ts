import { useQuery } from "@tanstack/react-query";
import { fetchAppSettings, fetchMe } from "../api";
import { queryKeys } from "../queryKeys";

export type Entitlements = {
  profile: Awaited<ReturnType<typeof fetchMe>> | undefined;
  appSettings: Awaited<ReturnType<typeof fetchAppSettings>> | undefined;
  profileError: Error | null;
  settingsError: Error | null;
  isAdmin: boolean;
  verificationLevel: number;
  isRegistered: boolean;
  isKycVerified: boolean;
  needsEmailVerification: boolean;
  emailVerificationPending: boolean;
  isPendingKyc: boolean;
  isResolving: boolean;
};

type Args = {
  userId?: number;
  isAuthenticating?: boolean;
};

export function deriveEntitlementFlags(
  profile: Awaited<ReturnType<typeof fetchMe>> | undefined,
  appSettings: Awaited<ReturnType<typeof fetchAppSettings>> | undefined,
  isSettingsResolving: boolean,
) {
  const userProfile = profile?.user;
  const verificationLevel = userProfile?.verification_level
    ?? (userProfile?.verified ? 2 : userProfile?.ready_for_verification ? 1 : 0);
  const isRegistered = Boolean(userProfile) && verificationLevel >= 1;
  const isKycVerified = Boolean(userProfile) && verificationLevel >= 2;
  const emailVerificationPending = Boolean(userProfile?.email_verification_pending);
  const emailCandidate = Boolean(userProfile)
    && (verificationLevel >= 1 || emailVerificationPending || Boolean(userProfile?.verified) || Boolean(userProfile?.ready_for_verification))
    && !userProfile?.email_verified_at;
  const needsEmailVerification = Boolean(userProfile)
    && !isSettingsResolving
    && (appSettings?.email_verification_enabled ?? 1) > 0
    && (emailVerificationPending || emailCandidate);
  const isPendingKyc = Boolean(userProfile?.verified === false && userProfile?.ready_for_verification === true);

  return {
    isAdmin: Boolean(profile?.is_admin),
    verificationLevel,
    isRegistered,
    isKycVerified,
    needsEmailVerification,
    emailVerificationPending,
    isPendingKyc,
  };
}

export function useEntitlements({ userId, isAuthenticating = false }: Args): Entitlements {
  const profileQuery = useQuery({
    queryKey: userId ? queryKeys.profile(userId) : ["user", "profile", "anonymous"],
    queryFn: fetchMe,
    enabled: Boolean(userId) && !isAuthenticating,
  });
  const settingsQuery = useQuery({
    queryKey: queryKeys.appSettings,
    queryFn: fetchAppSettings,
    retry: 1,
  });

  const profile = profileQuery.data;
  const flags = deriveEntitlementFlags(profile, settingsQuery.data, settingsQuery.isPending);

  return {
    profile,
    appSettings: settingsQuery.data,
    profileError: profileQuery.error instanceof Error ? profileQuery.error : profileQuery.error ? new Error("Profile request failed") : null,
    settingsError: settingsQuery.error instanceof Error ? settingsQuery.error : settingsQuery.error ? new Error("Settings request failed") : null,
    ...flags,
    isResolving: Boolean(isAuthenticating || (userId && profileQuery.isPending) || (userId && settingsQuery.isPending)),
  };
}
