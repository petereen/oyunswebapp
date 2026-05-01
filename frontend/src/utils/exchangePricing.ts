export type ExchangeDirection = "buy" | "sell";

export const PROMO_ELIGIBILITY_MAX_RUB = 30_000;

export const VOLUME_DISCOUNT_TIERS: Array<{ thresholdRub: number; adjustment: number }> = [
  { thresholdRub: 100_000, adjustment: 0.3 },
  { thresholdRub: 50_000, adjustment: 0.2 },
];

export function toSafeNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function getRubEquivalent(direction: ExchangeDirection, amount: number, baseRate: number): number {
  const safeAmount = toSafeNumber(amount, 0);
  const safeRate = toSafeNumber(baseRate, 0);
  if (safeAmount <= 0 || safeRate <= 0) return 0;

  return direction === "buy" ? safeAmount : safeAmount / safeRate;
}

export function getVolumeRateAdjustment(rubEquivalent: number): number {
  const safeRub = toSafeNumber(rubEquivalent, 0);
  const tier = VOLUME_DISCOUNT_TIERS.find((item) => safeRub >= item.thresholdRub);
  return tier?.adjustment ?? 0;
}

export function isPromoAllowed(rubEquivalent: number): boolean {
  return toSafeNumber(rubEquivalent, 0) <= PROMO_ELIGIBILITY_MAX_RUB;
}

export type AppliedRateAdjustment = {
  effectiveRate: number;
  rubEquivalent: number;
  adjustment: number;
  adjustmentSource: "none" | "promo" | "volume";
};

export function getAppliedRateAdjustment(options: {
  direction: ExchangeDirection;
  amount: number;
  baseRate: number;
  promoDiscount?: number;
}): AppliedRateAdjustment {
  const base = toSafeNumber(options.baseRate, 0);
  if (base <= 0) {
    return {
      effectiveRate: 0,
      rubEquivalent: 0,
      adjustment: 0,
      adjustmentSource: "none",
    };
  }

  const rubEquivalent = getRubEquivalent(options.direction, options.amount, base);
  const promoDiscount = Math.max(0, toSafeNumber(options.promoDiscount, 0));
  const volumeAdjustment = getVolumeRateAdjustment(rubEquivalent);

  let adjustment = 0;
  let adjustmentSource: AppliedRateAdjustment["adjustmentSource"] = "none";

  if (volumeAdjustment > 0) {
    adjustment = volumeAdjustment;
    adjustmentSource = "volume";
  } else if (promoDiscount > 0 && isPromoAllowed(rubEquivalent)) {
    adjustment = promoDiscount;
    adjustmentSource = "promo";
  }

  const directionalRate = options.direction === "buy" ? base + adjustment : base - adjustment;
  const effectiveRate = Math.max(0, Math.round(directionalRate * 100) / 100);

  return {
    effectiveRate,
    rubEquivalent,
    adjustment,
    adjustmentSource,
  };
}
