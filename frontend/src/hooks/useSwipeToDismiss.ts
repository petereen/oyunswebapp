import { useRef, useState, useCallback, type TouchEvent, type CSSProperties } from "react";

interface SwipeToDismissOptions {
  onDismiss?: () => void;
  threshold?: number; // px to trigger dismiss (default 100)
}

export function useSwipeToDismiss({ onDismiss, threshold = 100 }: SwipeToDismissOptions) {
  const startX = useRef(0);
  const startY = useRef(0);
  const locked = useRef(false); // locks direction once determined
  const isHorizontal = useRef(false);
  const [offsetX, setOffsetX] = useState(0);
  const [dismissed, setDismissed] = useState(false);

  const onTouchStart = useCallback((e: TouchEvent) => {
    startX.current = e.touches[0].clientX;
    startY.current = e.touches[0].clientY;
    locked.current = false;
    isHorizontal.current = false;
  }, []);

  const onTouchMove = useCallback((e: TouchEvent) => {
    const dx = e.touches[0].clientX - startX.current;
    const dy = e.touches[0].clientY - startY.current;

    if (!locked.current) {
      if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
        locked.current = true;
        isHorizontal.current = Math.abs(dx) > Math.abs(dy);
      }
      return;
    }

    if (!isHorizontal.current) return;

    setOffsetX(dx);
  }, []);

  const onTouchEnd = useCallback(() => {
    if (Math.abs(offsetX) > threshold) {
      const direction = offsetX > 0 ? 1 : -1;
      setDismissed(true);
      setOffsetX(direction * window.innerWidth);
      setTimeout(() => onDismiss?.(), 250);
    } else {
      setOffsetX(0);
    }
    locked.current = false;
  }, [offsetX, threshold, onDismiss]);

  const style: CSSProperties = {
    transform: `translateX(${offsetX}px)`,
    transition: dismissed || offsetX === 0 ? "transform 0.25s ease-out, opacity 0.25s ease-out" : "none",
    opacity: dismissed ? 0 : 1 - Math.min(Math.abs(offsetX) / (threshold * 3), 0.5),
  };

  return {
    swipeHandlers: { onTouchStart, onTouchMove, onTouchEnd },
    swipeStyle: style,
  };
}
