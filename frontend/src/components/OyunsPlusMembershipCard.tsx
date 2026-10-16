import { MouseEvent, ReactNode, useState } from "react";
import { Check, ChevronRight, Copy, RefreshCw, RotateCcw } from "lucide-react";
import oyunsPlusLogo from "../assets/oyuns-plus-points.svg";
import { useLang } from "../i18n/useLang";

export const FLIP_DURATION_MS = 600;

export interface OyunsPlusMembershipCardProps {
  cardHolder: string;
  points: number | string;
  referralCode?: string;
  onReferralCopy?: () => void;
  referralCopied?: boolean;
  /** Unit shown under point values; defaults to the translated "points". */
  currency?: string;
  tagline?: string;
  /** Custom brand mark; defaults to the OYUNS+ gradient logo. */
  logo?: ReactNode;
  /** When set, the back face shows a "details" button that opens the user's Oyuns profile. */
  onDetailsOpen?: () => void;
  className?: string;
}

/**
 * Usage:
 * <OyunsPlusMembershipCard cardHolder="Тэмүүлэн Очирбат" points={10000} currency="ОНОО"
 *   onDetailsOpen={openProfile} />
 * Must render inside <LangProvider>.
 */

function formatPoints(points: number | string) {
  if (typeof points === "string") return points;
  return points.toLocaleString("mn-MN");
}

/** Angled gold pills that sit in the bottom-right corner of both faces. */
function AccentBars({ id }: { id: string }) {
  const bars = [
    { x1: 58, y1: 222, x2: 168, y2: 112, opacity: 1 },
    { x1: 112, y1: 218, x2: 184, y2: 146, opacity: 0.8 },
    { x1: 166, y1: 214, x2: 192, y2: 188, opacity: 0.5 },
  ];
  return (
    <svg className="oyuns-flip-card__accent" viewBox="0 0 200 200" preserveAspectRatio="xMaxYMax meet" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}-gold`} gradientUnits="userSpaceOnUse" x1="60" y1="110" x2="190" y2="220">
          <stop offset="0%" stopColor="#FDC830" />
          <stop offset="100%" stopColor="#F37335" />
        </linearGradient>
        <filter id={`${id}-glow`} x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="9" />
        </filter>
      </defs>
      <g filter={`url(#${id}-glow)`} opacity="0.5">
        {bars.map((bar, index) => <line key={index} {...bar} stroke={`url(#${id}-gold)`} strokeWidth="24" strokeLinecap="round" />)}
      </g>
      {bars.map((bar, index) => <line key={index} {...bar} stroke={`url(#${id}-gold)`} strokeWidth="22" strokeLinecap="round" />)}
      {/* Top-edge highlight gives the pills a soft inner sheen. */}
      <line x1="54" y1="218" x2="164" y2="108" stroke="#fff" strokeOpacity="0.28" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}

function DefaultLogo() {
  return <img src={oyunsPlusLogo} alt="" className="h-6 w-auto drop-shadow-[0_0_8px_rgba(253,200,48,0.35)] sm:h-7" />;
}

export function OyunsPlusMembershipCard({
  cardHolder,
  points,
  referralCode,
  onReferralCopy,
  referralCopied = false,
  currency,
  tagline,
  logo,
  onDetailsOpen,
  className = "",
}: OyunsPlusMembershipCardProps) {
  const { t } = useLang();
  const unitLabel = currency ?? t("oyuns_plus.card_points_unit");
  const [flipped, setFlipped] = useState(false);

  const toggle = () => setFlipped((value) => !value);

  const stop = (handler: () => void) => (event: MouseEvent) => {
    event.stopPropagation();
    handler();
  };

  const brandMark = logo ?? <DefaultLogo />;
  const label = "truncate text-[10px] font-medium uppercase tracking-[0.14em] text-blue-300/60";
  const unit = "text-[11px] font-medium uppercase tracking-widest text-blue-200/60";
  const title = "text-xs font-medium uppercase tracking-wider text-blue-200/80 sm:text-sm";

  return (
    <div className={`oyuns-flip-card mx-auto w-full max-w-[420px] ${className}`} data-slot="oyuns-plus-membership-card-shell">
      <div
        className="oyuns-flip-card__inner relative aspect-[1.586/1] w-full cursor-pointer select-none"
        data-slot="oyuns-plus-membership-card"
        data-flipped={flipped}
        onClick={toggle}
      >
        {/* Front */}
        <section
          className="oyuns-flip-card__face"
          aria-hidden={flipped}
          inert={flipped}
          aria-label={`OYUNS PLUS, ${formatPoints(points)} ${unitLabel}`}
        >
          <AccentBars id="oyuns-front" />
          <div className="relative z-10 flex h-full flex-col justify-between p-5 sm:p-6">
            <header className="flex items-center justify-between gap-3">
              <span className={title}>OYUNS PLUS</span>
              <span className="flex shrink-0 items-center" aria-hidden="true">{brandMark}</span>
            </header>

            <div className="min-w-0">
              <div className="truncate text-3xl font-bold tabular-nums tracking-tight text-white sm:text-4xl">{formatPoints(points)}</div>
              <div className={`mt-1 ${unit}`}>{unitLabel}</div>
            </div>

            <footer className="flex items-end justify-between gap-3">
              <div className="min-w-0">
                <div className={label}>{t("oyuns_plus.card_holder")}</div>
                <div className="mt-1 truncate text-sm font-semibold uppercase tracking-wide text-white">{cardHolder || "—"}</div>
              </div>
              <button
                type="button"
                onClick={stop(toggle)}
                className="oyuns-flip-card__chip shrink-0"
                aria-label={t("oyuns_plus.card_flip")}
              >
                <span className="oyuns-flip-card__chip-label uppercase">{t("oyuns_plus.card_virtual")}</span>
                <RefreshCw className="oyuns-flip-card__chip-icon h-3 w-3" aria-hidden="true" />
              </button>
            </footer>
          </div>
        </section>

        {/* Back */}
        <section
          className="oyuns-flip-card__face oyuns-flip-card__face--back"
          aria-hidden={!flipped}
          inert={!flipped}
          aria-label={`OYUNS PLUS, ${t("oyuns_plus.settings_referral_code")}`}
        >
          <AccentBars id="oyuns-back" />
          <div className="relative z-10 flex h-full flex-col justify-between p-5 sm:p-6">
            <header className="flex items-center justify-between gap-3">
              <span className={title}>OYUNS PLUS</span>
              <button
                type="button"
                onClick={stop(toggle)}
                className="oyuns-flip-card__icon-button"
                aria-label={t("oyuns_plus.card_flip_back")}
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </header>

            <div className="absolute inset-x-5 top-1/2 flex min-w-0 -translate-y-1/2 items-center justify-between gap-2 sm:inset-x-6" data-slot="oyuns-plus-card-back-content">
              <div className="min-w-0 flex-1">
                <div className={label}>{t("oyuns_plus.settings_referral_code")}</div>
                <div className="mt-1 flex min-w-0 items-center gap-1">
                  <span className="min-w-0 truncate text-xl font-bold tracking-wide text-white sm:text-2xl">{referralCode || "—"}</span>
                  <button
                    type="button"
                    onClick={onReferralCopy ? stop(onReferralCopy) : undefined}
                    disabled={!referralCode || !onReferralCopy}
                    className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-white/80 transition-colors hover:bg-white/10 disabled:opacity-40"
                    aria-label={t(referralCopied ? "oyuns_plus.settings_copied" : "oyuns_plus.settings_copy")}
                  >
                    {referralCopied ? <Check className="size-4" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
                  </button>
                  <span className="sr-only" role="status">{referralCopied ? t("oyuns_plus.settings_copied") : ""}</span>
                </div>
              </div>
              {onDetailsOpen && (
                <button
                  type="button"
                  onClick={stop(onDetailsOpen)}
                  className="group inline-flex min-h-11 shrink-0 items-center gap-1 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-semibold text-white backdrop-blur-sm transition-colors hover:bg-white/20"
                >
                  <span>{t("oyuns_plus.card_details")}</span>
                  <ChevronRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                </button>
              )}
            </div>

            <footer className="truncate text-center text-[11px] font-normal tracking-wide text-blue-200/50">{tagline ?? t("oyuns_plus.card_tagline")}</footer>
          </div>
        </section>
      </div>
    </div>
  );
}
