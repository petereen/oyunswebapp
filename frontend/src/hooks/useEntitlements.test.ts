import { describe, expect, it } from "vitest";
import { deriveEntitlementFlags } from "./useEntitlements";

const profile = (overrides: Record<string, unknown> = {}) => ({
  is_admin: false,
  user: {
    id: 42,
    verification_level: 0,
    verified: false,
    ready_for_verification: false,
    email_verification_pending: false,
    email_verified_at: undefined,
    ...overrides,
  },
});

describe("deriveEntitlementFlags", () => {
  it("does not infer registration before a profile exists", () => {
    const flags = deriveEntitlementFlags(undefined, undefined, true);
    expect(flags.isRegistered).toBe(false);
    expect(flags.isKycVerified).toBe(false);
    expect(flags.needsEmailVerification).toBe(false);
  });

  it("supports the verification-level fallback hierarchy", () => {
    expect(deriveEntitlementFlags(profile({ verified: true, verification_level: undefined }), undefined, false).verificationLevel).toBe(2);
    expect(deriveEntitlementFlags(profile({ ready_for_verification: true, verification_level: undefined }), undefined, false).verificationLevel).toBe(1);
    expect(deriveEntitlementFlags(profile({ verification_level: 1 }), undefined, false).isRegistered).toBe(true);
  });

  it("gates email only after settings resolve and when enabled", () => {
    expect(deriveEntitlementFlags(profile({ verification_level: 2 }), undefined, true).needsEmailVerification).toBe(false);
    expect(deriveEntitlementFlags(profile({ verification_level: 2 }), { email_verification_enabled: 1 } as never, false).needsEmailVerification).toBe(true);
    expect(deriveEntitlementFlags(profile({ verification_level: 2 }), { email_verification_enabled: 0 } as never, false).needsEmailVerification).toBe(false);
  });

  it("recognizes pending KYC and pending email independently", () => {
    const flags = deriveEntitlementFlags(profile({ verification_level: 1, verified: false, ready_for_verification: true, email_verification_pending: true }), { email_verification_enabled: 1 } as never, false);
    expect(flags.isPendingKyc).toBe(true);
    expect(flags.emailVerificationPending).toBe(true);
    expect(flags.needsEmailVerification).toBe(true);
  });
});
