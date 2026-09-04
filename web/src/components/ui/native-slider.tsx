import { useCallback, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import './native-slider.css';

interface NativeSliderProps {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  label: string;
  onChange: (next: number) => void;
  onCommit?: (next: number) => void;
  className?: string;
}

const THUMB_HIT_SLOP = 28;
const DRAG_THRESHOLD = 8;

function roundToStep(v: number, step: number, min: number) {
  const steps = Math.round((v - min) / step);
  return min + steps * step;
}

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

function valueFromClientX(
  clientX: number,
  rect: DOMRect,
  min: number,
  max: number,
  step: number,
) {
  const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
  const raw = min + ratio * (max - min);
  return clamp(roundToStep(raw, step, min), min, max);
}

// Custom slider that fixes the "snap on vertical scroll" problem.
// Native <input type=range> commits the track position on pointerdown
// immediately, so a vertical scroll starting on the control still mutates
// the value before we can tell it's a scroll. This version is thumb-only
// for touch (track taps are ignored, they just scroll) and direction-locked:
// a vertical drag never changes the value, only a horizontal intent does.
export function NativeSlider({
  value,
  min = 0,
  max = 100,
  step = 5,
  label,
  onChange,
  onCommit,
  className,
}: NativeSliderProps) {
  const trackRef = useRef<HTMLDivElement>(null);

  // Doc listeners are added per-gesture so we store the exact handlers to remove.
  const docHandlersRef = useRef<{
    move: (e: PointerEvent) => void;
    up: (e: PointerEvent) => void;
  } | null>(null);

  const removeDocListeners = useCallback(() => {
    const h = docHandlersRef.current;
    if (!h) return;
    document.removeEventListener('pointermove', h.move);
    document.removeEventListener('pointerup', h.up);
    document.removeEventListener('pointercancel', h.up);
    docHandlersRef.current = null;
  }, []);

  useEffect(() => removeDocListeners, [removeDocListeners]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      const track = trackRef.current;
      if (!track) return;

      const isMouse = e.pointerType === 'mouse';
      const rect = track.getBoundingClientRect();
      const ratio = (value - min) / (max - min);
      const thumbX = rect.left + ratio * rect.width;
      // Gesture-local live value; the `value` prop only refreshes between
      // gestures since handlers are recreated per render.
      let current = value;

      if (!isMouse) {
        // Thumb-only for touch: ignore track taps, they just scroll.
        if (Math.abs(e.clientX - thumbX) > THUMB_HIT_SLOP) return;
      } else {
        const hitThumb = Math.abs(e.clientX - thumbX) <= THUMB_HIT_SLOP;
        if (!hitThumb) {
          const next = valueFromClientX(e.clientX, rect, min, max, step);
          onChange(next);
          onCommit?.(next);
          return;
        }
      }

      // Thumb drag: don't snap yet, wait for direction lock. Don't
      // preventDefault here or a vertical drag starting on the thumb
      // would lose its scroll.

      const startX = e.clientX;
      const startY = e.clientY;
      const pointerId = e.pointerId;
      // Mouse has no scroll-jacking problem — skip direction lock.
      let locked: 'h' | 'v' | null = isMouse ? 'h' : null;
      let dragging = false;
      if (isMouse) {
        try {
          track.setPointerCapture?.(pointerId);
        } catch {}
      }

      const onMove = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;

        if (!locked) {
          if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD)
            return;
          if (Math.abs(dy) > Math.abs(dx)) {
            locked = 'v';
            removeDocListeners();
            return;
          }
          locked = 'h';
          try {
            track.setPointerCapture?.(pointerId);
          } catch {}
        }

        if (locked !== 'h') return;
        dragging = true;
        const r = track.getBoundingClientRect();
        const next = valueFromClientX(ev.clientX, r, min, max, step);
        if (next !== current) {
          current = next;
          onChange(next);
        }
      };

      const onUp = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        const wasDragging = dragging;
        const finalValue = current;
        removeDocListeners();
        try {
          track.releasePointerCapture?.(pointerId);
        } catch {}
        if (wasDragging) onCommit?.(finalValue);
      };

      docHandlersRef.current = { move: onMove, up: onUp };
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
      document.addEventListener('pointercancel', onUp);
    },
    [max, min, onChange, onCommit, removeDocListeners, step, value],
  );

  const handleKeyDown = useCallback(
    (ev: React.KeyboardEvent) => {
      let next: number | null = null;
      if (ev.key === 'ArrowLeft' || ev.key === 'ArrowDown') next = value - step;
      else if (ev.key === 'ArrowRight' || ev.key === 'ArrowUp')
        next = value + step;
      else if (ev.key === 'Home') next = min;
      else if (ev.key === 'End') next = max;
      if (next == null) return;
      ev.preventDefault();
      const clamped = clamp(roundToStep(next, step, min), min, max);
      onChange(clamped);
      onCommit?.(clamped);
    },
    [max, min, onChange, onCommit, step, value],
  );

  const fill = ((value - min) / (max - min)) * 100;

  return (
    <div
      ref={trackRef}
      role="slider"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      tabIndex={0}
      className={cn('native-slider w-full', className)}
      onPointerDown={handlePointerDown}
      onKeyDown={handleKeyDown}
    >
      <div className="native-slider-track">
        <div className="native-slider-fill" style={{ width: `${fill}%` }} />
      </div>
      <div
        className="native-slider-thumb"
        style={{ left: `calc(${fill}% - 6px)` }}
        aria-hidden="true"
      />
    </div>
  );
}
