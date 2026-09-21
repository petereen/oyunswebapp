import { CSSProperties, PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from "react";

export const MAX_TILT = 16;
export const TILT_LERP_FACTOR = 0.18;
export const POINTER_CLICK_THRESHOLD = 8;
export const GYRO_BETA_BASELINE = 40;
export const GYRO_TILT_RANGE = 36;
export const SHEEN_OPACITY_IDLE = 0.14;
export const SHEEN_OPACITY_ACTIVE = 0.23;
export const GLARE_OPACITY_IDLE = 0.06;
export const GLARE_OPACITY_ACTIVE = 0.13;
export const CARD_RETURN_DURATION_MS = 500;

type Tilt = { x: number; y: number };
type OrientationStatus = "unsupported" | "idle" | "enabled" | "denied";

type DeviceOrientationConstructor = typeof DeviceOrientationEvent & {
  requestPermission?: () => Promise<PermissionState>;
};

export interface OyunsPlusMembershipCardProps {
  /** Imported SVG URL or an inline SVG data URL for the OYUNS+ mark. */
  logoSvg: string;
  userName: string;
  points: number | string;
  pointsLabel: string;
  referralCode: string;
  onMenuOpen: () => void;
  cardHolderLabel?: string;
  referralLabel?: string;
  orientationLabel?: string;
  orientationEnabledLabel?: string;
  orientationDeniedLabel?: string;
  className?: string;
}

/**
 * Usage:
 * <OyunsPlusMembershipCard logoSvg={oyunsPlusLogo} userName="Тэмүүлэн" points={1280}
 *   pointsLabel="ОНОО" referralCode="OYUNS42" onMenuOpen={openLegacyMenu} />
 */

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function formatPoints(points: number | string) {
  if (typeof points === "string") return points;
  return points.toLocaleString("mn-MN");
}

function pointerTilt(clientX: number, clientY: number, rect: DOMRect): Tilt {
  const normalizedX = clamp((clientX - rect.left) / rect.width * 2 - 1, -1, 1);
  const normalizedY = clamp((clientY - rect.top) / rect.height * 2 - 1, -1, 1);
  return {
    x: clamp(-normalizedY * MAX_TILT, -MAX_TILT, MAX_TILT),
    y: clamp(normalizedX * MAX_TILT, -MAX_TILT, MAX_TILT),
  };
}

function orientationTilt(beta: number, gamma: number): Tilt {
  return {
    x: clamp(((beta - GYRO_BETA_BASELINE) / GYRO_TILT_RANGE) * MAX_TILT, -MAX_TILT, MAX_TILT),
    y: clamp((gamma / GYRO_TILT_RANGE) * MAX_TILT, -MAX_TILT, MAX_TILT),
  };
}

export function OyunsPlusMembershipCard({
  logoSvg,
  userName,
  points,
  pointsLabel,
  referralCode,
  onMenuOpen,
  cardHolderLabel = "CARD HOLDER",
  referralLabel = "REFERRAL CODE",
  orientationLabel = "Enable motion",
  orientationEnabledLabel = "Motion enabled",
  orientationDeniedLabel = "Motion unavailable",
  className = "",
}: OyunsPlusMembershipCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const animationFrameRef = useRef<number | null>(null);
  const targetTiltRef = useRef<Tilt>({ x: 0, y: 0 });
  const renderedTiltRef = useRef<Tilt>({ x: 0, y: 0 });
  const activeRef = useRef(false);
  const pointerDownRef = useRef(false);
  const pointerMovedRef = useRef(false);
  const pointerStartRef = useRef({ x: 0, y: 0 });
  const suppressClickRef = useRef(false);
  const [isActive, setIsActive] = useState(false);
  const [orientationStatus, setOrientationStatus] = useState<OrientationStatus>("unsupported");

  const setActive = (next: boolean) => {
    if (activeRef.current === next) return;
    activeRef.current = next;
    cardRef.current?.setAttribute("data-active", String(next));
    setIsActive(next);
  };

  const writeTilt = (tilt: Tilt) => {
    const card = cardRef.current;
    if (!card) return;
    const sheenX = clamp(50 + tilt.y * 1.7, 0, 100);
    const sheenY = clamp(50 - tilt.x * 1.7, 0, 100);
    const glareX = clamp(50 - tilt.y * 2.2, 8, 92);
    const glareY = clamp(50 + tilt.x * 2.2, 8, 92);
    card.style.setProperty("--oyuns-tilt-x", `${tilt.x}deg`);
    card.style.setProperty("--oyuns-tilt-y", `${tilt.y}deg`);
    card.style.setProperty("--oyuns-sheen-x", `${sheenX}%`);
    card.style.setProperty("--oyuns-sheen-y", `${sheenY}%`);
    card.style.setProperty("--oyuns-glare-x", `${glareX}%`);
    card.style.setProperty("--oyuns-glare-y", `${glareY}%`);
  };

  const animateTilt = () => {
    if (animationFrameRef.current !== null) return;

    const frame = () => {
      animationFrameRef.current = null;
      const current = renderedTiltRef.current;
      const target = targetTiltRef.current;
      const next = {
        x: current.x + (target.x - current.x) * TILT_LERP_FACTOR,
        y: current.y + (target.y - current.y) * TILT_LERP_FACTOR,
      };
      const settled = Math.abs(target.x - next.x) < 0.01 && Math.abs(target.y - next.y) < 0.01;
      renderedTiltRef.current = settled ? target : next;
      writeTilt(renderedTiltRef.current);
      if (!settled) animationFrameRef.current = window.requestAnimationFrame(frame);
    };

    animationFrameRef.current = window.requestAnimationFrame(frame);
  };

  const driveTilt = (tilt: Tilt) => {
    setActive(true);
    targetTiltRef.current = tilt;
    animateTilt();
  };

  const returnToFlat = () => {
    setActive(false);
    targetTiltRef.current = { x: 0, y: 0 };
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    renderedTiltRef.current = { x: 0, y: 0 };
    writeTilt(renderedTiltRef.current);
  };

  const driveFromPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    driveTilt(pointerTilt(event.clientX, event.clientY, rect));
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    pointerDownRef.current = true;
    pointerMovedRef.current = false;
    pointerStartRef.current = { x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
    driveFromPointer(event);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "mouse" && !pointerDownRef.current) return;
    if (pointerDownRef.current) {
      const distance = Math.hypot(event.clientX - pointerStartRef.current.x, event.clientY - pointerStartRef.current.y);
      if (distance > POINTER_CLICK_THRESHOLD) pointerMovedRef.current = true;
    }
    driveFromPointer(event);
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const wasDragged = pointerMovedRef.current;
    pointerDownRef.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);

    if (wasDragged) {
      suppressClickRef.current = true;
      window.setTimeout(() => { suppressClickRef.current = false; }, 0);
      if (event.pointerType !== "mouse" && orientationStatus !== "enabled") returnToFlat();
      return;
    }

    if (event.pointerType !== "mouse" && orientationStatus !== "enabled") returnToFlat();
  };

  const handleCardClick = () => {
    if (suppressClickRef.current) return;
    onMenuOpen();
  };

  const handleCardKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onMenuOpen();
  };

  const requestOrientation = async () => {
    const OrientationEvent = window.DeviceOrientationEvent as unknown as DeviceOrientationConstructor | undefined;
    try {
      const permission = OrientationEvent?.requestPermission ? await OrientationEvent.requestPermission() : "granted";
      if (permission !== "granted") {
        setOrientationStatus("denied");
        return;
      }
      setOrientationStatus("enabled");
    } catch {
      setOrientationStatus("denied");
    }
  };

  useEffect(() => {
    const isTouchDevice = navigator.maxTouchPoints > 0 || window.matchMedia?.("(pointer: coarse)").matches;
    if (isTouchDevice && "DeviceOrientationEvent" in window) setOrientationStatus("idle");
  }, []);

  useEffect(() => {
    if (orientationStatus !== "enabled") return undefined;
    const handleOrientation = (event: DeviceOrientationEvent) => {
      if (typeof event.beta !== "number" || typeof event.gamma !== "number") return;
      driveTilt(orientationTilt(event.beta, event.gamma));
    };
    window.addEventListener("deviceorientation", handleOrientation, true);
    return () => window.removeEventListener("deviceorientation", handleOrientation, true);
  }, [orientationStatus]);

  useEffect(() => {
    writeTilt({ x: 0, y: 0 });
    return () => {
      if (animationFrameRef.current !== null) window.cancelAnimationFrame(animationFrameRef.current);
    };
  }, []);

  const logoShimmerStyle = {
    maskImage: `url("${logoSvg}")`,
    WebkitMaskImage: `url("${logoSvg}")`,
  } as CSSProperties;
  const cardStyle = {
    "--oyuns-sheen-opacity-idle": SHEEN_OPACITY_IDLE,
    "--oyuns-sheen-opacity-active": SHEEN_OPACITY_ACTIVE,
    "--oyuns-glare-opacity-idle": GLARE_OPACITY_IDLE,
    "--oyuns-glare-opacity-active": GLARE_OPACITY_ACTIVE,
    "--oyuns-card-return-duration": `${CARD_RETURN_DURATION_MS}ms`,
  } as CSSProperties;

  return (
    <div className={`oyuns-plus-membership-card-shell ${className}`} data-slot="oyuns-plus-membership-card-shell">
      <div
        ref={cardRef}
        className="oyuns-plus-membership-card"
        data-slot="oyuns-plus-membership-card"
        data-active={isActive}
        role="button"
        tabIndex={0}
        aria-label={`${formatPoints(points)} ${pointsLabel}`}
        onClick={handleCardClick}
        onKeyDown={handleCardKeyDown}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={() => { if (orientationStatus !== "enabled") returnToFlat(); }}
        onPointerEnter={(event) => { if (event.pointerType === "mouse") setActive(true); }}
        onPointerLeave={() => { if (!pointerDownRef.current && orientationStatus !== "enabled") returnToFlat(); }}
        style={cardStyle}
      >
        <span className="oyuns-plus-membership-card__base" aria-hidden="true" />
        <span className="oyuns-plus-membership-card__sheen" aria-hidden="true" />
        <span className="oyuns-plus-membership-card__glare" aria-hidden="true" />
        <span className="oyuns-plus-membership-card__noise" aria-hidden="true" />

        <span className="oyuns-plus-membership-card__content">
          <span className="oyuns-plus-membership-card__topline">
            <span className="oyuns-plus-membership-card__title">OYUNS PLUS</span>
            <span className="oyuns-plus-membership-card__logo" aria-hidden="true">
              <img src={logoSvg} alt="" />
              <span className="oyuns-plus-membership-card__logo-shimmer" style={logoShimmerStyle} />
            </span>
          </span>

          <span className="oyuns-plus-membership-card__points">
            <span className="oyuns-plus-membership-card__points-value">{formatPoints(points)}</span>
            <span className="oyuns-plus-membership-card__points-label">{pointsLabel}</span>
          </span>

          <span className="oyuns-plus-membership-card__footer">
            <span className="oyuns-plus-membership-card__field">
              <span className="oyuns-plus-membership-card__field-label">{cardHolderLabel}</span>
              <span className="oyuns-plus-membership-card__field-value">{userName || "—"}</span>
            </span>
            <span className="oyuns-plus-membership-card__field oyuns-plus-membership-card__field--right">
              <span className="oyuns-plus-membership-card__field-label">{referralLabel}</span>
              <span className="oyuns-plus-membership-card__field-value">{referralCode || "—"}</span>
            </span>
          </span>
        </span>
      </div>

      {orientationStatus !== "unsupported" && (
        <button
          type="button"
          className="oyuns-plus-orientation-button"
          data-slot="oyuns-plus-orientation-button"
          onClick={requestOrientation}
          aria-pressed={orientationStatus === "enabled"}
        >
          <span className="oyuns-plus-orientation-button__dot" aria-hidden="true" />
          {orientationStatus === "enabled" ? orientationEnabledLabel : orientationStatus === "denied" ? orientationDeniedLabel : orientationLabel}
        </button>
      )}
    </div>
  );
}
