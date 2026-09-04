import { useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { clampFloatCenter } from '../controller/pointer-input';
import './stick-feel.css';
import type { MountOptions } from './settings-island';
import type { StickFeelSetting, StickGrabSetting } from './settings-store';

const BASE_R = 30;
const PAD_H = 128;
const THUMB_TRAVEL_PX = 18;

const FEEL_COPY: Record<StickFeelSetting, { title: string; sub: string }> = {
  fixed: { title: 'Stay put', sub: 'You find the stick' },
  floating: { title: 'Jump to thumb', sub: 'Stick meets you' },
  following: { title: 'Glide with thumb', sub: 'Center stays close' },
};

export function StickFeelSettings({ opts }: { opts: MountOptions }) {
  const store = opts.store;
  const feel = useStore(store, (s) => s.stickFeel);
  const grab = useStore(store, (s) => s.stickGrab);
  const setFeel = useStore(store, (s) => s.setStickFeel);
  const setGrab = useStore(store, (s) => s.setStickGrab);

  return (
    <div className="relative mt-6 rounded-xl border bg-card">
      <div className="absolute -top-2 left-1/2 -translate-x-1/2 whitespace-nowrap bg-card px-2 text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
        Stick Feel
      </div>
      <div className="space-y-3 p-3 pt-4">
        <TryPad feel={feel} grab={grab} />
        <fieldset className="grid grid-cols-3 gap-2">
          <legend className="sr-only">Stick feel</legend>
          {(Object.keys(FEEL_COPY) as StickFeelSetting[]).map((value) => {
            const active = feel === value;
            const copy = FEEL_COPY[value];
            return (
              <button
                key={value}
                type="button"
                aria-pressed={active}
                aria-label={`Stick feel ${copy.title}`}
                onClick={() => setFeel(value)}
                className={`flex flex-col items-center gap-1.5 rounded-xl border p-2.5 text-center transition-colors active:scale-[0.97] ${
                  active
                    ? 'border-white/15 bg-primary/10'
                    : 'border-white/30 bg-card hover:bg-accent/30'
                }`}
              >
                <span
                  className={`stick-mini stick-mini--${value}`}
                  aria-hidden="true"
                >
                  <span className="stick-mini-base">
                    <span className="stick-mini-thumb" />
                  </span>
                </span>
                <span className="text-xs font-semibold leading-none">
                  {copy.title}
                </span>
                <span className="text-[10px] leading-tight text-muted-foreground">
                  {copy.sub}
                </span>
              </button>
            );
          })}
        </fieldset>
        {feel !== 'fixed' && (
          <fieldset className="grid grid-cols-2 gap-2">
            <legend className="sr-only">Grab area</legend>
            <button
              type="button"
              aria-pressed={grab === 'wide'}
              aria-label="Grab area whole side"
              onClick={() => setGrab('wide')}
              className={`flex items-center gap-2.5 rounded-xl border p-2.5 text-left transition-colors active:scale-[0.98] ${
                grab === 'wide'
                  ? 'border-white/15 bg-primary/10'
                  : 'border-white/30 bg-card hover:bg-accent/30'
              }`}
            >
              <span
                className="grab-thumb grab-thumb--wide"
                aria-hidden="true"
              />
              <span className="min-w-0">
                <span className="block text-xs font-semibold leading-tight">
                  Whole side
                </span>
                <span className="block text-[10px] leading-tight text-muted-foreground">
                  Empty space grabs
                </span>
              </span>
            </button>
            <button
              type="button"
              aria-pressed={grab === 'precise'}
              aria-label="Grab area stick only"
              onClick={() => setGrab('precise')}
              className={`flex items-center gap-2.5 rounded-xl border p-2.5 text-left transition-colors active:scale-[0.98] ${
                grab === 'precise'
                  ? 'border-white/15 bg-primary/10'
                  : 'border-white/30 bg-card hover:bg-accent/30'
              }`}
            >
              <span
                className="grab-thumb grab-thumb--precise"
                aria-hidden="true"
              />
              <span className="min-w-0">
                <span className="block text-xs font-semibold leading-tight">
                  Stick only
                </span>
                <span className="block text-[10px] leading-tight text-muted-foreground">
                  + Hitzones
                </span>
              </span>
            </button>
          </fieldset>
        )}
      </div>
    </div>
  );
}

function TryPad({
  feel,
  grab,
}: {
  feel: StickFeelSetting;
  grab: StickGrabSetting;
}) {
  const padRef = useRef<HTMLDivElement>(null);
  const [base, setBase] = useState<{ x: number; y: number } | null>(null);
  const [thumb, setThumb] = useState({ x: 0, y: 0 });
  const sessionRef = useRef<{ x: number; y: number } | null>(null);
  const activeRef = useRef(false);
  const pointerRef = useRef<number | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: feel/grab are props; the preview session must reset when either changes
  useEffect(() => {
    activeRef.current = false;
    pointerRef.current = null;
    sessionRef.current = null;
    setBase(null);
    setThumb({ x: 0, y: 0 });
  }, [feel, grab]);

  const updateFromPoint = (clientX: number, clientY: number) => {
    if (!activeRef.current) return;
    const el = padRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;

    if (feel === 'fixed') {
      const cx = rect.width / 2;
      const cy = rect.height / 2;
      const dx = px - cx;
      const dy = py - cy;
      const len = Math.hypot(dx, dy) || 1;
      const clamped = Math.min(1, len / BASE_R);
      const next = { x: cx, y: cy };
      sessionRef.current = next;
      setBase(next);
      setThumb({ x: (dx / len) * clamped, y: (dy / len) * clamped });
      return;
    }

    // Moves never start a session. A queued move landing after lift must not
    // resurrect a base + deflected thumb from stale coords.
    const prev = sessionRef.current;
    if (!prev) return;
    let bx = prev.x;
    let by = prev.y;
    if (feel === 'following') {
      const dx = px - bx;
      const dy = py - by;
      const len = Math.hypot(dx, dy);
      if (len > BASE_R) {
        const clamped = clampFloatCenter(
          { x: px, y: py },
          { x: dx / len, y: dy / len },
          BASE_R,
          { left: 0, top: 0, width: rect.width, height: rect.height },
        );
        bx = clamped.x;
        by = clamped.y;
      }
    }
    const dx = px - bx;
    const dy = py - by;
    const len = Math.hypot(dx, dy) || 1;
    const clamped = Math.min(1, len / BASE_R);
    const next = { x: bx, y: by };
    sessionRef.current = next;
    setBase(next);
    setThumb({ x: (dx / len) * clamped, y: (dy / len) * clamped });
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (activeRef.current) return;
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    const el = padRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    if (feel === 'fixed') {
      const cx = rect.width / 2;
      const cy = rect.height / 2;
      if (Math.hypot(px - cx, py - cy) > BASE_R) return;
    } else if (grab === 'precise') {
      const cx = sessionRef.current?.x ?? rect.width / 2;
      const cy = sessionRef.current?.y ?? rect.height / 2;
      if (Math.hypot(px - cx, py - cy) > BASE_R) return;
    }
    activeRef.current = true;
    pointerRef.current = e.pointerId;
    if (feel === 'fixed') {
      updateFromPoint(e.clientX, e.clientY);
      return;
    }
    const next = {
      x: Math.max(BASE_R, Math.min(rect.width - BASE_R, px)),
      y: Math.max(BASE_R, Math.min(rect.height - BASE_R, py)),
    };
    sessionRef.current = next;
    setBase(next);
    setThumb({ x: 0, y: 0 });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!activeRef.current || pointerRef.current !== e.pointerId) return;
    e.preventDefault();
    updateFromPoint(e.clientX, e.clientY);
  };

  const end = (e?: React.PointerEvent) => {
    if (e && pointerRef.current !== null && e.pointerId !== pointerRef.current)
      return;
    activeRef.current = false;
    pointerRef.current = null;
    sessionRef.current = null;
    setBase(null);
    setThumb({ x: 0, y: 0 });
  };

  const showWide = feel !== 'fixed' && grab === 'wide';
  const showPrecise = feel !== 'fixed' && grab === 'precise';

  return (
    <div
      ref={padRef}
      data-base-ui-swipe-ignore
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
      role="application"
      aria-label="Try stick feel. Touch and drag."
      className="try-pad relative w-full touch-none select-none overflow-hidden rounded-lg border border-white/15 bg-black/30"
      style={{ height: PAD_H }}
    >
      {showWide && <div className="try-pad-wide" aria-hidden="true" />}
      <p className="pointer-events-none absolute top-2 right-0 left-0 px-6 text-center text-xs text-white/60">
        Drag to feel it
      </p>
      <div
        className={`try-pad-base${showPrecise ? ' try-pad-base--precise' : ''}`}
        aria-hidden="true"
        style={
          base
            ? {
                left: base.x - BASE_R,
                top: base.y - BASE_R,
                width: BASE_R * 2,
                height: BASE_R * 2,
              }
            : {
                left: `calc(50% - ${BASE_R}px)`,
                top: `calc(50% - ${BASE_R}px)`,
                width: BASE_R * 2,
                height: BASE_R * 2,
              }
        }
      >
        <div
          className="try-pad-thumb"
          style={{
            transform: `translate(${thumb.x * THUMB_TRAVEL_PX}px, ${thumb.y * THUMB_TRAVEL_PX}px)`,
          }}
        />
      </div>
    </div>
  );
}
