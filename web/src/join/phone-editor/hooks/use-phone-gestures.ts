import { useEffect, useRef } from 'react';
import type { Document as LayoutDocument } from '@/shared/generated/layout';
import {
  clampGeometry,
  findControl,
  isDefaultLocked,
  updateControlGeometry,
} from '@/shared/layout-editor';
import { usePhoneEditorStore } from '../store/phone-editor-store';

export interface PhoneGestureRefs {
  isPinching: React.MutableRefObject<boolean>;
  isMultiTouch: React.MutableRefObject<boolean>;
  activePointers: React.MutableRefObject<Set<number>>;
}

export function usePhoneGestures(
  overlayRef: React.RefObject<HTMLDivElement | null>,
  gestureRefs: PhoneGestureRefs,
  draftRef: React.MutableRefObject<LayoutDocument | null>,
  selectedIdRef: React.MutableRefObject<string | null>,
  locksRef: React.MutableRefObject<Record<string, boolean>>,
  setDraftLive: (doc: LayoutDocument) => void,
): void {
  const isPinchingRef = gestureRefs.isPinching;
  const isMultiTouchRef = gestureRefs.isMultiTouch;
  const activePointersRef = gestureRefs.activePointers;

  const setDraftLiveRef = useRef(setDraftLive);
  setDraftLiveRef.current = setDraftLive;

  useEffect(() => {
    const el = overlayRef.current;
    if (!el) return;

    let startDist = 0;
    let startTime = 0;
    let startSize: { w: number; h: number } | null = null;
    let startLocked = true;
    let didPinch = false;
    let peakTouches = 0;

    const dist = (a: Touch, b: Touch) =>
      Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);

    const onTouchStart = (e: TouchEvent) => {
      peakTouches = Math.max(peakTouches, e.touches.length);
      if (e.touches.length >= 2) isMultiTouchRef.current = true;
      if (e.touches.length === 2) {
        startTime = Date.now();
        didPinch = false;
        const sid = selectedIdRef.current;
        const draft = draftRef.current;
        if (sid && draft) {
          const found = findControl(draft, sid);
          if (found) {
            startSize = {
              w: found.control.geometry.size.width,
              h: found.control.geometry.size.height,
            };
            const locks = locksRef.current;
            startLocked =
              (locks[sid] ?? isDefaultLocked(found.control as never)) === true;
            startDist = dist(e.touches[0], e.touches[1]);
          } else {
            startSize = null;
            startDist = dist(e.touches[0], e.touches[1]);
          }
        } else {
          startSize = null;
          startDist = dist(e.touches[0], e.touches[1]);
        }
      } else if (e.touches.length === 3) {
        startTime = Date.now();
        didPinch = false;
        startDist = 0;
        startSize = null;
      } else if (e.touches.length === 1) {
        startDist = 0;
        startSize = null;
        if (peakTouches < 2) startTime = Date.now();
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      peakTouches = Math.max(peakTouches, e.touches.length);
      if (e.touches.length >= 2) isMultiTouchRef.current = true;
      if (e.touches.length === 2 && startSize && startDist > 0) {
        const curDist = dist(e.touches[0], e.touches[1]);
        const scale = curDist / startDist;
        if (Math.abs(scale - 1) < 0.04) return;
        didPinch = true;
        isPinchingRef.current = true;
        isMultiTouchRef.current = true;
        e.preventDefault();
        let targetW = startSize.w * scale;
        let targetH = startSize.h * scale;
        if (startLocked) {
          const ratio = startSize.w / startSize.h || 1;
          if (
            Math.abs(targetW - startSize.w) > Math.abs(targetH - startSize.h)
          ) {
            targetH = targetW / ratio;
          } else {
            targetW = targetH * ratio;
          }
        }
        const sid = selectedIdRef.current;
        const draft = draftRef.current;
        if (!sid || !draft) return;
        const found = findControl(draft, sid);
        if (!found) return;
        const candidate = {
          position: { ...found.control.geometry.position },
          size: { width: targetW, height: targetH },
        };
        const clamped = clampGeometry(candidate, found.section);
        const next = updateControlGeometry(draft, sid, clamped);
        setDraftLiveRef.current(next);
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length !== 0) return;
      const dt = Date.now() - startTime;
      const store = usePhoneEditorStore.getState();
      if (!didPinch && dt < 350 && dt > 0 && peakTouches >= 2) {
        if (peakTouches === 2) {
          const prev = store.historyUndo();
          if (prev) setDraftLiveRef.current(prev);
          e.preventDefault();
          e.stopPropagation();
        } else if (peakTouches === 3) {
          const next = store.historyRedo();
          if (next) setDraftLiveRef.current(next);
          e.preventDefault();
          e.stopPropagation();
        }
      } else if (didPinch) {
        const draft = draftRef.current;
        if (draft) store.commitDraft(draft);
      }
      startSize = null;
      startDist = 0;
      didPinch = false;
      startTime = 0;
      peakTouches = 0;
      isPinchingRef.current = false;
      isMultiTouchRef.current = false;
      activePointersRef.current.clear();
    };

    const onPointerDown = (e: PointerEvent) => {
      if ((e as PointerEvent).pointerType === 'mouse') return;
      activePointersRef.current.add((e as PointerEvent).pointerId);
      if (activePointersRef.current.size >= 2) {
        isMultiTouchRef.current = true;
        e.stopPropagation();
        const anyTarget = e.target as HTMLElement | null;
        if (anyTarget?.closest?.('[data-phone-hit]')) {
          e.preventDefault();
        }
      }
    };
    const onPointerUp = (e: PointerEvent) => {
      activePointersRef.current.delete((e as PointerEvent).pointerId);
      if (activePointersRef.current.size < 2) {
        isMultiTouchRef.current = false;
        if (activePointersRef.current.size === 0) {
          isPinchingRef.current = false;
        }
      }
    };
    const onPointerCancel = (e: PointerEvent) => {
      activePointersRef.current.delete((e as PointerEvent).pointerId);
      if (activePointersRef.current.size < 2) {
        isMultiTouchRef.current = false;
        if (activePointersRef.current.size === 0) {
          isPinchingRef.current = false;
        }
      }
    };

    el.addEventListener('touchstart', onTouchStart, {
      passive: false,
      capture: true,
    });
    el.addEventListener('touchmove', onTouchMove, {
      passive: false,
      capture: true,
    });
    el.addEventListener('touchend', onTouchEnd, { capture: true });
    el.addEventListener(
      'pointerdown',
      onPointerDown as unknown as EventListener,
      { capture: true },
    );
    el.addEventListener('pointerup', onPointerUp as unknown as EventListener, {
      capture: true,
    });
    el.addEventListener(
      'pointercancel',
      onPointerCancel as unknown as EventListener,
      { capture: true },
    );
    return () => {
      el.removeEventListener('touchstart', onTouchStart, {
        capture: true,
      } as unknown as EventListenerOptions);
      el.removeEventListener('touchmove', onTouchMove, {
        capture: true,
      } as unknown as EventListenerOptions);
      el.removeEventListener('touchend', onTouchEnd, {
        capture: true,
      } as unknown as EventListenerOptions);
      el.removeEventListener(
        'pointerdown',
        onPointerDown as unknown as EventListener,
        { capture: true } as unknown as EventListenerOptions,
      );
      el.removeEventListener(
        'pointerup',
        onPointerUp as unknown as EventListener,
        { capture: true } as unknown as EventListenerOptions,
      );
      el.removeEventListener(
        'pointercancel',
        onPointerCancel as unknown as EventListener,
        { capture: true } as unknown as EventListenerOptions,
      );
    };
  }, [overlayRef, isMultiTouchRef, isPinchingRef, activePointersRef]);
}
