import interact from 'interactjs';
import {
  ArrowLeft,
  Circle,
  Copy,
  Lock,
  LockOpen,
  Plus,
  Redo2,
  Square,
  Trash2,
  Undo2,
} from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { FrameSender } from '../controller/frame-sender';
import type { RenderedLayout } from '../controller/layout-renderer';
import { resolveLayout } from '../controller/layout-resolver';
import type { InputStateStore } from '../controller/state';
import { useInteractGeometry } from '../editor/use-interact-geometry';
import type { Control, LayoutDocument } from '../shared/layout';
import { validateLayout } from '../shared/layout';
import {
  addHitzone,
  clampDrag,
  clampGeometry,
  cloneDocument,
  deleteControl,
  duplicateControl,
  findControl,
  getHitzonesOf,
  isDefaultLocked,
  LayoutHistory,
  moveParentWithHitzones,
  resizeControl,
  updateControlGeometry,
} from '../shared/layout-editor';
import {
  loadPersonalLayouts,
  savePersonalLayout,
  slugify,
} from './personal-layouts';

const ONBOARDING_KEY = 'airdeck.phoneEditorOnboarded';

function effectiveHitShape(control: Control): 'rect' | 'ellipse' {
  if (control.type === 'dpad') return 'rect';
  if (control.type === 'hitzone')
    return control.shape === 'round' ? 'ellipse' : 'rect';
  if (control.type === 'label') return 'rect';
  if ((control as unknown as { hitShape?: string }).hitShape === 'rect')
    return 'rect';
  if (control.shape === 'round') return 'ellipse';
  return 'rect';
}

function PinchGestureIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 14 14"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <path
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="0.32"
        d="M6.95 7.574L5.993 3.29a1.196 1.196 0 0 1 .757-1.384v0a1.196 1.196 0 0 1 1.577.863l.888 3.976l.267-.097a2.144 2.144 0 0 1 2.75 1.278l.926 2.537M6.95 7.581l-1.57-2.74a1.22 1.22 0 0 0-1.474-.538v0a1.218 1.218 0 0 0-.662 1.706L5.13 9.633l-.36.215a1.715 1.715 0 0 0-.118 2.873l.242.171l.565.403M1.75.5L.5 1.75L1.75 3M.5 1.75h3M12.25.5l1.25 1.25L12.25 3m1.25-1.25h-3"
      />
    </svg>
  );
}

function TwoFingerTapIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 14 14"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <g
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="0.32"
      >
        <path d="M2.263 5.982a3.498 3.498 0 0 1 4.085-4.229a3.498 3.498 0 0 1 6.09 3.041" />
        <path d="m7.312 8.258l.616-4.69a1.29 1.29 0 0 1 1.278-1.122v0c.778 0 1.38.685 1.278 1.457l-.572 4.355h.473c1.185 0 2.145.96 2.145 2.144v3.08M7.31 8.266L6.733 4.91A1.31 1.31 0 0 0 5.44 3.82v0c-.793 0-1.405.697-1.302 1.483l.57 4.368l-.648.121a1.715 1.715 0 0 0-1.095 2.659l.298.432l.424.617" />
      </g>
    </svg>
  );
}

function ThreeFingerTapIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 14 14"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <g
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="0.32"
      >
        <path d="M0.965 4.414 C0.979 3.183 1.979 1.979 3.448 2.117" />
        <path d="M3.448 1.979 C4.249 0.277 6.033 0.227 7.012 1.203" />
        <path d="M7.116 1.278 C9.269 0.419 10.39 2.45 10.404 3.681" />
        <path d="M2.871 7.671 C2.871 7.671 2.46 4.543 2.46 4.543 C2.421 4.237 2.515 3.93 2.718 3.698 C2.922 3.467 3.215 3.334 3.523 3.334 C4.123 3.334 4.551 3.78 4.629 4.371 C4.629 4.371 5.057 7.071 5.057 7.071" />
        <path d="M4.843 7.243 C4.843 7.243 4.431 3.06 4.431 3.06 C4.4 2.749 4.501 2.44 4.71 2.208 C4.919 1.976 5.216 1.844 5.529 1.843 C6.146 1.843 6.634 2.349 6.634 2.966 C6.634 2.966 6.634 7.243 6.634 7.243" />
        <path d="M6.634 7.243 C6.634 7.243 6.703 3.377 6.703 3.377 C6.717 2.777 7.208 2.297 7.809 2.297 C8.426 2.297 8.914 2.794 8.914 3.411 C8.914 3.411 8.914 7.08 8.914 7.08 C8.914 7.08 9.171 7.08 9.171 7.08 C10.183 7.08 11.006 7.903 11.006 8.914 C11.006 8.914 11.006 11.554 11.006 11.554" />
        <path d="M2.871 7.671 C2.871 7.671 2.314 7.774 2.314 7.774 C1.826 7.867 1.417 8.2 1.226 8.659 C1.036 9.119 1.091 9.644 1.371 10.054 C1.371 10.054 1.629 10.423 1.629 10.423 C1.629 10.423 1.989 10.954 1.989 10.954" />
      </g>
    </svg>
  );
}

interface IslandProps {
  initialDoc: LayoutDocument;
  sender: FrameSender;
  state: InputStateStore;
  renderer: RenderedLayout | undefined;
  hostLayoutIds?: string[];
  onSave: (doc: LayoutDocument) => void;
  onCancel: () => void;
}

function PhoneEditorIsland({
  initialDoc,
  sender,
  state,
  renderer,
  hostLayoutIds,
  onSave,
  onCancel,
}: IslandProps) {
  const originalIdRef = useRef(initialDoc.id);
  const draftRef = useRef<LayoutDocument>(cloneDocument(initialDoc));
  const [draft, setDraft] = useState<LayoutDocument>(() =>
    cloneDocument(initialDoc),
  );
  const [name, setName] = useState(initialDoc.name);
  const [nameError, setNameError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [locks, setLocks] = useState<Record<string, boolean>>({});
  const [showOnboarding, setShowOnboarding] = useState(() => {
    try {
      return !localStorage.getItem(ONBOARDING_KEY);
    } catch {
      return false;
    }
  });
  const historyRef = useRef<LayoutHistory>(new LayoutHistory(50));
  const selectedRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const getHostViewport = (): { width: number; height: number } => {
    if (renderer?.root) {
      const comp = renderer.root.querySelector(
        '.controller-composition',
      ) as HTMLElement | null;
      if (comp) {
        const r = comp.getBoundingClientRect();
        if (r.width > 2 && r.height > 2)
          return { width: r.width, height: r.height };
      }
      const hostEl = document.querySelector(
        '.controller-host',
      ) as HTMLElement | null;
      if (hostEl) {
        const r = hostEl.getBoundingClientRect();
        const cs = getComputedStyle(hostEl);
        const padL = parseFloat(cs.paddingLeft) || 0;
        const padR = parseFloat(cs.paddingRight) || 0;
        const padT = parseFloat(cs.paddingTop) || 0;
        const padB = parseFloat(cs.paddingBottom) || 0;
        return {
          width: Math.max(1, r.width - padL - padR),
          height: Math.max(1, r.height - padT - padB),
        };
      }
    }
    return { width: window.innerWidth, height: window.innerHeight };
  };
  const getHostOrigin = (): { x: number; y: number } => {
    if (renderer?.root) {
      const comp = renderer.root.querySelector(
        '.controller-composition',
      ) as HTMLElement | null;
      if (comp) {
        const r = comp.getBoundingClientRect();
        return { x: r.left, y: r.top };
      }
    }
    const hostEl = document.querySelector(
      '.controller-host',
    ) as HTMLElement | null;
    if (hostEl) {
      const r = hostEl.getBoundingClientRect();
      const cs = getComputedStyle(hostEl);
      return {
        x: r.left + (parseFloat(cs.paddingLeft) || 0),
        y: r.top + (parseFloat(cs.paddingTop) || 0),
      };
    }
    return { x: 0, y: 0 };
  };
  const [viewport, setViewport] = useState(() => getHostViewport());

  // host viewport — matches runtime renderer composition size for pixel-perfect overlay
  useEffect(() => {
    const compute = () => {
      let w = window.innerWidth;
      let h = window.innerHeight;
      if (renderer?.root) {
        const comp = renderer.root.querySelector(
          '.controller-composition',
        ) as HTMLElement | null;
        if (comp) {
          const r = comp.getBoundingClientRect();
          if (r.width > 2 && r.height > 2) {
            w = r.width;
            h = r.height;
          }
        } else {
          const hostEl = document.querySelector(
            '.controller-host',
          ) as HTMLElement | null;
          if (hostEl) {
            const r = hostEl.getBoundingClientRect();
            const cs = getComputedStyle(hostEl);
            const padL = parseFloat(cs.paddingLeft) || 0;
            const padR = parseFloat(cs.paddingRight) || 0;
            const padT = parseFloat(cs.paddingTop) || 0;
            const padB = parseFloat(cs.paddingBottom) || 0;
            w = Math.max(1, r.width - padL - padR);
            h = Math.max(1, r.height - padT - padB);
          }
        }
      }
      setViewport({ width: w, height: h });
    };
    compute();
    window.addEventListener('resize', compute);
    window.addEventListener('orientationchange', compute);
    const ro =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(compute)
        : null;
    const hostEl = document.querySelector('.controller-host');
    if (hostEl && ro) ro.observe(hostEl);
    const compEl = renderer?.root?.querySelector('.controller-composition');
    if (compEl && ro) ro.observe(compEl);
    return () => {
      window.removeEventListener('resize', compute);
      window.removeEventListener('orientationchange', compute);
      ro?.disconnect();
    };
  }, [renderer]);

  const [hostOrigin, setHostOrigin] = useState(() => getHostOrigin());
  useEffect(() => {
    const computeOrigin = () => setHostOrigin(getHostOrigin());
    computeOrigin();
    window.addEventListener('resize', computeOrigin);
    window.addEventListener('orientationchange', computeOrigin);
    return () => {
      window.removeEventListener('resize', computeOrigin);
      window.removeEventListener('orientationchange', computeOrigin);
    };
  }, [renderer, viewport]);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  // live-sync the underlying renderer so the skin moves with the hit overlay
  useEffect(() => {
    if (!renderer) return;
    try {
      renderer.update(draft, {
        width: viewport.width,
        height: viewport.height,
      });
    } catch {
      try {
        renderer.update(draft);
      } catch {}
    }
  }, [draft, viewport, renderer]);

  const initialViewportRef = useRef(viewport);
  useEffect(() => {
    historyRef.current.reset(initialDoc);
    const wasRunning = sender.isRunning;
    if (wasRunning) sender.stop();
    renderer?.cancelPointers();
    state.reset();
    initialViewportRef.current = viewport;
    return () => {
      if (wasRunning) sender.start();
      try {
        renderer?.update(initialDoc, {
          width: initialViewportRef.current.width,
          height: initialViewportRef.current.height,
        });
      } catch {
        try {
          renderer?.update(initialDoc);
        } catch {}
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialDoc, sender, state, renderer]);

  const resolved = useMemo(() => {
    return resolveLayout(draft, viewport, 'landscape');
  }, [draft, viewport]);

  const selectedControl = selectedId
    ? findControl(draft, selectedId)?.control
    : null;

  const selectedPeerIds = useMemo(() => {
    if (!selectedId) return new Set<string>();
    const found = findControl(draft, selectedId);
    if (!found || found.control.type === 'hitzone') return new Set<string>();
    return new Set<string>(getHitzonesOf(draft, selectedId));
  }, [draft, selectedId]);

  const isParentWithHitzones = selectedControl
    ? getHitzonesOf(draft, selectedControl.id).length > 0
    : false;

  const locked = selectedControl
    ? (locks[selectedControl.id] ?? isDefaultLocked(selectedControl))
    : true;

  const selectedRect = useMemo(() => {
    if (!selectedId) return null;
    for (const section of resolved.sections) {
      for (const rc of section.controls) {
        if (rc.control.id === selectedId) return rc.visual;
      }
    }
    return null;
  }, [resolved, selectedId]);

  // gesture arbitration: second finger = pinch, not second drag
  const isPinchingRef = useRef(false);
  const isMultiTouchRef = useRef(false);
  const activePointersRef = useRef<Set<number>>(new Set());

  const handleDrag = useCallback(
    (deltaX: number, deltaY: number) => {
      if (!selectedId) return;
      if (isMultiTouchRef.current || isPinchingRef.current) return;
      let next: LayoutDocument;
      if (isParentWithHitzones) {
        next = moveParentWithHitzones(
          draftRef.current,
          selectedId,
          deltaX,
          deltaY,
        );
      } else {
        const found = findControl(draftRef.current, selectedId);
        if (!found) return;
        next = updateControlGeometry(
          draftRef.current,
          selectedId,
          clampDrag(found.control.geometry, deltaX, deltaY, found.section),
        );
      }
      draftRef.current = next;
      setDraft(next);
    },
    [selectedId, isParentWithHitzones],
  );

  const handleResize = useCallback(
    (deltaWidth: number, deltaHeight: number) => {
      if (!selectedId) return;
      if (isMultiTouchRef.current || isPinchingRef.current) return;
      const next = resizeControl(
        draftRef.current,
        selectedId,
        deltaWidth,
        deltaHeight,
        locked,
      );
      draftRef.current = next;
      setDraft(next);
    },
    [selectedId, locked],
  );

  const commit = useCallback(() => {
    if (isPinchingRef.current || isMultiTouchRef.current) return;
    historyRef.current.push(draftRef.current);
  }, []);

  const handleDelete = useCallback(() => {
    if (!selectedId) return;
    const next = deleteControl(draftRef.current, selectedId);
    draftRef.current = next;
    setDraft(next);
    historyRef.current.push(next);
    setSelectedId(null);
  }, [selectedId]);

  const handleDuplicate = useCallback(() => {
    if (!selectedId) return;
    const cur = draftRef.current;
    const found = findControl(cur, selectedId);
    if (!found) return;
    const next = duplicateControl(cur, selectedId);
    const section = next.sections.find((s) => s.id === found.section.id);
    const idx = section?.controls.findIndex((cc) => cc.id === selectedId) ?? -1;
    const newCtrl = section?.controls[idx + 1];
    draftRef.current = next;
    setDraft(next);
    historyRef.current.push(next);
    if (newCtrl) setSelectedId(newCtrl.id);
  }, [selectedId]);

  const handleAddHitzone = useCallback(() => {
    if (!selectedId) return;
    const cur = draftRef.current;
    const found = findControl(cur, selectedId);
    if (!found || found.control.type === 'hitzone') return;
    const next = addHitzone(cur, selectedId);
    if (!next) return;
    const section = next.sections.find((s) => s.id === found.section.id);
    const idx = section?.controls.findIndex((cc) => cc.id === selectedId) ?? -1;
    const newCtrl = section?.controls[idx + 1];
    draftRef.current = next;
    setDraft(next);
    historyRef.current.push(next);
    if (newCtrl) setSelectedId(newCtrl.id);
  }, [selectedId]);

  const handleToggleShape = useCallback(() => {
    if (!selectedId) return;
    const cur = draftRef.current;
    const found = findControl(cur, selectedId);
    if (!found) return;
    if (found.control.type === 'dpad' || found.control.type === 'label') return;
    const next = cloneDocument(cur);
    const target = next.sections
      .find((s) => s.id === found.section.id)
      ?.controls.find((cc) => cc.id === selectedId);
    if (!target) return;
    // toggle visual shape round <-> rect, hit follows shape
    if (target.shape === 'round') {
      target.shape = 'rect';
    } else {
      target.shape = 'round';
    }
    delete (target as unknown as Record<string, unknown>).hitShape;
    draftRef.current = next;
    setDraft(next);
    historyRef.current.push(next);
  }, [selectedId]);

  useInteractGeometry({
    enabled: Boolean(selectedRect && selectedId),
    targetRef: selectedRef,
    viewportHeight: viewport.height,
    scale: 1,
    key: selectedId ?? undefined,
    locked,
    edges: {
      left: '.phone-editor-handle.tl, .phone-editor-handle.bl',
      right: '.phone-editor-handle.tr, .phone-editor-handle.br',
      top: '.phone-editor-handle.tl, .phone-editor-handle.tr',
      bottom: '.phone-editor-handle.bl, .phone-editor-handle.br',
    },
    onDrag: handleDrag,
    onResize: handleResize,
    onDragEnd: commit,
    onResizeEnd: commit,
  });

  // native pinch + 2/3 finger tap undo/redo — replaces interact gesturable
  const selectedIdRef = useRef<string | null>(null);
  selectedIdRef.current = selectedId;
  const locksRef = useRef(locks);
  locksRef.current = locks;
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
        if (sid) {
          const found = findControl(draftRef.current, sid);
          if (found) {
            startSize = {
              w: found.control.geometry.size.width,
              h: found.control.geometry.size.height,
            };
            startLocked =
              (locksRef.current[sid] ??
                isDefaultLocked(found.control as never)) === true;
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
        // prevent page scroll/zoom while pinching the control
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
        if (!sid) return;
        const found = findControl(draftRef.current, sid);
        if (!found) return;
        const candidate = {
          position: { ...found.control.geometry.position },
          size: { width: targetW, height: targetH },
        };
        const clamped = clampGeometry(candidate, found.section);
        const next = updateControlGeometry(draftRef.current, sid, clamped);
        draftRef.current = next;
        setDraft(next);
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length !== 0) return;
      const dt = Date.now() - startTime;
      if (!didPinch && dt < 350 && dt > 0 && peakTouches >= 2) {
        if (peakTouches === 2) {
          const prev = historyRef.current.undo();
          if (prev) {
            draftRef.current = prev;
            setDraft(prev);
          }
          e.preventDefault();
          e.stopPropagation();
        } else if (peakTouches === 3) {
          const next = historyRef.current.redo();
          if (next) {
            draftRef.current = next;
            setDraft(next);
          }
          e.preventDefault();
          e.stopPropagation();
        }
      } else if (didPinch) {
        historyRef.current.push(draftRef.current);
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
        // block second finger from selecting/dragging another hit
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

    // use capture + non-passive so we can preventDefault on pinch move
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
      {
        capture: true,
      },
    );
    el.addEventListener('pointerup', onPointerUp as unknown as EventListener, {
      capture: true,
    });
    el.addEventListener(
      'pointercancel',
      onPointerCancel as unknown as EventListener,
      {
        capture: true,
      },
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
        {
          capture: true,
        } as unknown as EventListenerOptions,
      );
      el.removeEventListener(
        'pointerup',
        onPointerUp as unknown as EventListener,
        {
          capture: true,
        } as unknown as EventListenerOptions,
      );
      el.removeEventListener(
        'pointercancel',
        onPointerCancel as unknown as EventListener,
        {
          capture: true,
        } as unknown as EventListenerOptions,
      );
    };
  }, []);

  const handleSave = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError('Name is required.');
      return;
    }
    const slug = slugify(trimmed);
    const existing = loadPersonalLayouts();
    const isEditingExisting = !!existing[originalIdRef.current];
    if (existing[slug] && slug !== originalIdRef.current) {
      setNameError(`An edit named "${trimmed}" already exists.`);
      return;
    }
    if (hostLayoutIds?.includes(slug)) {
      setNameError(
        `"${trimmed}" collides with a host layout. Use a different name.`,
      );
      return;
    }
    const nextDoc: LayoutDocument = {
      ...cloneDocument(draftRef.current),
      id: slug,
      name: trimmed,
    };
    if (!validateLayout(nextDoc)) {
      setNameError('Layout is invalid.');
      return;
    }
    const err = savePersonalLayout(nextDoc);
    if (err) {
      setNameError(err);
      return;
    }
    if (isEditingExisting && originalIdRef.current !== slug) {
      try {
        const all = loadPersonalLayouts();
        delete all[originalIdRef.current];
        localStorage.setItem('airdeck.personalLayouts', JSON.stringify(all));
      } catch {
        // ignore
      }
    }
    state.reset();
    onSave(nextDoc);
  };

  const handleBack = () => {
    state.reset();
    try {
      renderer?.update(initialDoc, {
        width: viewport.width,
        height: viewport.height,
      });
    } catch {
      try {
        renderer?.update(initialDoc);
      } catch {}
    }
    onCancel();
  };

  const handleUndo = () => {
    const prev = historyRef.current.undo();
    if (prev) {
      draftRef.current = prev;
      setDraft(prev);
    }
  };

  const handleRedo = () => {
    const next = historyRef.current.redo();
    if (next) {
      draftRef.current = next;
      setDraft(next);
    }
  };

  const dismissOnboarding = () => {
    try {
      localStorage.setItem(ONBOARDING_KEY, '1');
    } catch {}
    setShowOnboarding(false);
  };

  const isSelectedHitzone = selectedControl?.type === 'hitzone';

  const onboardingLegend: { key: string; icon: ReactNode; label: string }[] = [
    {
      key: 'delete',
      icon: (
        <span className="grid size-6 shrink-0 place-items-center rounded border border-white/15 bg-red-500/90 text-white">
          <Trash2 size={12} strokeWidth={2} />
        </span>
      ),
      label: 'Delete control',
    },
    {
      key: 'lock',
      icon: (
        <span className="grid size-6 shrink-0 place-items-center rounded border border-white/15 bg-white/10 text-white">
          <LockOpen size={12} strokeWidth={2} />
        </span>
      ),
      label: 'Lock/Unlock aspect ratio',
    },
    {
      key: 'duplicate',
      icon: (
        <span className="grid size-6 shrink-0 place-items-center rounded border border-white/15 bg-white/10 text-white">
          <Copy size={12} strokeWidth={2} />
        </span>
      ),
      label: 'Duplicate control',
    },
    {
      key: 'hitzone',
      icon: (
        <span className="grid size-6 shrink-0 place-items-center rounded border border-white/15 bg-white/10 text-white">
          <span className="relative flex size-[14px] items-center justify-center overflow-hidden rounded-[3px] border border-dashed border-yellow-400 bg-violet-500/10">
            <span
              className="absolute inset-0 opacity-30"
              style={{
                backgroundImage:
                  'repeating-linear-gradient(135deg, rgb(139 92 246 / 0.5) 0 1px, transparent 1px 7px), repeating-linear-gradient(45deg, rgb(139 92 246 / 0.5) 0 1px, transparent 1px 7px)',
              }}
            />
            <Plus size={8} className="relative text-white" strokeWidth={2.5} />
          </span>
        </span>
      ),
      label: 'Add hitzone (extend touch area)',
    },
    {
      key: 'shape',
      icon: (
        <span className="grid size-6 shrink-0 place-items-center rounded border border-white/15 bg-white/10 text-white">
          <Square size={12} strokeWidth={2} />
        </span>
      ),
      label: 'Toggle shape',
    },
    {
      key: 'undo',
      icon: (
        <span className="grid size-6 shrink-0 place-items-center rounded border border-white/20 bg-transparent text-white">
          <Undo2 size={12} strokeWidth={2} />
        </span>
      ),
      label: 'Undo',
    },
    {
      key: 'redo',
      icon: (
        <span className="grid size-6 shrink-0 place-items-center rounded border border-white/20 bg-transparent text-white">
          <Redo2 size={12} strokeWidth={2} />
        </span>
      ),
      label: 'Redo',
    },
    {
      key: 'save',
      icon: (
        <span className="grid h-[22px] w-[44px] shrink-0 place-items-center rounded-md border border-white/20 bg-white text-[11px] font-semibold text-black">
          Save
        </span>
      ),
      label: 'Save layout',
    },
  ];

  return (
    <div
      ref={overlayRef}
      className="phone-editor-overlay fixed inset-0 z-40 touch-none select-none"
      data-phone-overlay
      onClick={(event) => {
        if (event.target === event.currentTarget) setSelectedId(null);
      }}
    >
      <div
        className="phone-editor-bar absolute top-0 left-0 right-0 h-8 flex items-center gap-2 px-2 bg-black/40 z-10 pointer-events-auto border-b border-white/10"
        data-phone-bar
      >
        <button
          type="button"
          className="grid place-items-center size-7 shrink-0 rounded border border-white/20 bg-white text-black cursor-pointer hover:bg-white/90"
          aria-label="Cancel"
          onClick={handleBack}
        >
          <ArrowLeft size={14} strokeWidth={2.5} />
        </button>
        <input
          type="text"
          enterKeyHint="done"
          inputMode="text"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          className={`w-[132px] max-w-[32vw] shrink-0 truncate bg-transparent border-0 border-b px-0.5 py-1 text-xs leading-none outline-none placeholder:text-white/50 ${nameError ? 'border-red-500 text-red-300 focus:border-red-500' : 'border-white/20 text-white focus:border-white/60'}`}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (nameError) setNameError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              (e.currentTarget as HTMLInputElement).blur();
            }
          }}
          placeholder="Layout name"
        />
        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            className="grid place-items-center size-6 shrink-0 rounded bg-red-500/90 hover:bg-red-500 border border-white/15 text-white cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
            aria-label="Delete control"
            title="Delete control"
            disabled={!selectedId}
            onClick={handleDelete}
          >
            <Trash2 size={12} />
          </button>
          <button
            type="button"
            className={`grid place-items-center size-6 shrink-0 rounded border cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed ${selectedId && locked ? 'bg-white text-black border-white hover:bg-white/90' : 'bg-white/10 text-white border-white/15 hover:bg-white/20'}`}
            aria-label={locked ? 'Unlock aspect ratio' : 'Lock aspect ratio'}
            title={locked ? 'Unlock aspect ratio' : 'Lock aspect ratio'}
            disabled={!selectedId}
            onClick={() => {
              if (!selectedId) return;
              const found = findControl(draftRef.current, selectedId);
              if (!found) return;
              setLocks((prev) => {
                const cur =
                  prev[selectedId] ?? isDefaultLocked(found.control as never);
                return { ...prev, [selectedId]: !cur };
              });
            }}
          >
            {locked ? <Lock size={12} /> : <LockOpen size={12} />}
          </button>
          <button
            type="button"
            className="grid place-items-center size-6 shrink-0 rounded border bg-white/10 text-white border-white/15 hover:bg-white/20 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
            aria-label="Duplicate control"
            title="Duplicate control"
            disabled={!selectedId}
            onClick={handleDuplicate}
          >
            <Copy size={12} />
          </button>
          <button
            type="button"
            className="grid place-items-center size-6 shrink-0 rounded border bg-white/10 text-white border-white/15 hover:bg-white/20 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
            aria-label="Add hitzone"
            title="Add hitzone"
            disabled={!selectedControl || selectedControl.type === 'hitzone'}
            onClick={handleAddHitzone}
          >
            <span className="relative flex items-center justify-center size-[14px] rounded-[3px] border border-dashed border-yellow-400 bg-violet-500/10 overflow-hidden">
              <span
                className="absolute inset-0 opacity-30"
                style={{
                  backgroundImage:
                    'repeating-linear-gradient(135deg, rgb(139 92 246 / 0.5) 0 1px, transparent 1px 7px), repeating-linear-gradient(45deg, rgb(139 92 246 / 0.5) 0 1px, transparent 1px 7px)',
                }}
              />
              <Plus
                size={8}
                className="relative text-white"
                strokeWidth={2.5}
              />
            </span>
          </button>
          <button
            type="button"
            className={`grid place-items-center size-6 shrink-0 rounded border cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed ${selectedControl && (selectedControl.type === 'dpad' || selectedControl.type === 'label') ? 'bg-white/10 text-white/40 border-white/10' : selectedControl && selectedControl.shape === 'round' ? 'bg-white text-black border-white hover:bg-white/90' : 'bg-white/10 text-white border-white/15 hover:bg-white/20'}`}
            aria-label="Toggle shape"
            title={
              selectedControl?.shape === 'round'
                ? 'Shape: round → rect'
                : 'Shape: rect → round'
            }
            disabled={
              !selectedControl ||
              selectedControl.type === 'dpad' ||
              selectedControl.type === 'label'
            }
            onClick={handleToggleShape}
          >
            {selectedControl?.shape === 'round' ? (
              <Circle size={12} />
            ) : (
              <Square size={12} />
            )}
          </button>
          <button
            type="button"
            className="grid size-6 shrink-0 place-items-center rounded border border-white/20 bg-transparent text-white cursor-pointer disabled:opacity-40"
            aria-label="Undo"
            onClick={handleUndo}
            disabled={!historyRef.current.canUndo}
            style={{ opacity: historyRef.current.canUndo ? 1 : 0.4 }}
          >
            <Undo2 size={12} strokeWidth={2} />
          </button>
          <button
            type="button"
            className="grid size-6 shrink-0 place-items-center rounded border border-white/20 bg-transparent text-white cursor-pointer disabled:opacity-40"
            aria-label="Redo"
            onClick={handleRedo}
            disabled={!historyRef.current.canRedo}
            style={{ opacity: historyRef.current.canRedo ? 1 : 0.4 }}
          >
            <Redo2 size={12} strokeWidth={2} />
          </button>
          <div
            className="w-px h-4 bg-white/15 shrink-0 mx-1"
            aria-hidden="true"
          />
          <button
            type="button"
            className="h-[22px] px-1 shrink-0 rounded-md border border-white/20 bg-white text-black text-xs font-semibold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed hover:bg-white/90 mr-1.5"
            onClick={handleSave}
          >
            {loadPersonalLayouts()[originalIdRef.current] ? 'Save' : 'Create'}
          </button>
        </div>
      </div>
      {nameError && (
        <div
          className="absolute top-8 left-0 right-0 bg-red-500/90 text-white text-[11px] px-2 py-0.5 z-[11]"
          style={{ background: 'rgba(239,68,68,0.9)' }}
        >
          {nameError}
        </div>
      )}

      <div
        className="absolute inset-0 pointer-events-none"
        data-phone-canvas-wrap
        style={{ top: 32 }}
        onClick={(e) => {
          // clicking empty canvas (where no hit) deselects — the hit buttons stop propagation
          if (e.target === e.currentTarget) setSelectedId(null);
        }}
      >
        {resolved.sections.flatMap((section) =>
          section.controls.map((rc) => {
            const isSelected = rc.control.id === selectedId;
            const isHitzone = rc.control.type === 'hitzone';
            const hitShape = effectiveHitShape(rc.control as Control);
            const BAR_H = 32;
            const left = hostOrigin.x + rc.visual.left;
            const top = hostOrigin.y + rc.visual.top - BAR_H;
            const isPeer = selectedPeerIds.has(rc.control.id);
            const isForgiving =
              isSelected &&
              hitShape === 'rect' &&
              rc.control.shape === 'round' &&
              !isHitzone &&
              rc.control.type !== 'label' &&
              rc.control.type !== 'dpad';
            const showHitzoneHatch = isHitzone && (isPeer || isSelected);
            return (
              <PhoneHit
                key={rc.control.id}
                control={rc.control}
                left={left}
                top={top}
                width={rc.visual.width}
                height={rc.visual.height}
                hitShape={hitShape}
                isSelected={isSelected}
                isHitzone={isHitzone}
                isPeer={isPeer}
                isForgiving={isForgiving}
                showHitzoneHatch={showHitzoneHatch}
                viewportHeight={viewport.height}
                draftRef={draftRef}
                selectedId={selectedId}
                onSelect={(id) => setSelectedId(id)}
                onDraftChange={(next, commit) => {
                  draftRef.current = next;
                  setDraft(next);
                  if (commit) historyRef.current.push(next);
                }}
                selectedRef={selectedRef}
                locked={locked}
                onToggleLock={() => {
                  setLocks((prev) => {
                    const cur =
                      prev[rc.control.id] ??
                      isDefaultLocked(rc.control as never);
                    return { ...prev, [rc.control.id]: !cur };
                  });
                }}
                onDelete={handleDelete}
                isSelectedHitzone={isSelectedHitzone}
                isMultiTouchRef={isMultiTouchRef}
                isPinchingRef={isPinchingRef}
              />
            );
          }),
        )}
      </div>

      {showOnboarding && (
        <div
          className="absolute inset-0 z-30 flex items-center justify-center bg-black/70 p-2 backdrop-blur-[2px]"
          data-phone-onboarding
          role="dialog"
          aria-label="Editor guide"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget) dismissOnboarding();
          }}
        >
          <div className="flex max-h-[92dvh] w-[98vw] max-w-[600px] flex-col overflow-hidden rounded-2xl border border-white/10 bg-black/85 backdrop-blur-xl shadow-[0_20px_60px_rgba(0,0,0,0.6)]">
            <div className="flex-1 overflow-y-auto p-3">
              <div className="grid gap-3">
                <div className="grid grid-flow-col grid-cols-3 grid-rows-3 gap-x-3 gap-y-1.5">
                  {onboardingLegend.map((item) => (
                    <div
                      key={item.key}
                      className="flex items-center gap-2 py-1"
                    >
                      {item.icon}
                      <span className="min-w-0 text-[12px] leading-none text-white">
                        <span className="text-white/40">:</span> {item.label}
                      </span>
                    </div>
                  ))}
                </div>

                <div className="rounded-xl border border-white/10 bg-white/[0.07] px-3 py-2.5 text-center text-[12px] font-medium leading-4 text-white">
                  Touch and drag controls to select / move. Drag corners to
                  resize.
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <div className="flex flex-col items-center gap-2 px-1 py-2">
                    <PinchGestureIcon className="size-[64px] text-white sm:size-[72px]" />
                    <p className="text-center text-[11px] font-medium leading-tight text-white/80">
                      Pinch to <b className="text-white">Resize</b> control
                    </p>
                  </div>
                  <div className="flex flex-col items-center gap-2 px-1 py-2">
                    <TwoFingerTapIcon className="size-[64px] text-white sm:size-[72px]" />
                    <p className="text-center text-[11px] font-medium leading-tight text-white/80">
                      2 finger tap to <b className="text-white">Undo</b>
                    </p>
                  </div>
                  <div className="flex flex-col items-center gap-2 px-1 py-2">
                    <ThreeFingerTapIcon className="size-[64px] text-white sm:size-[72px]" />
                    <p className="text-center text-[11px] font-medium leading-tight text-white/80">
                      3 finger tap to <b className="text-white">Redo</b>
                    </p>
                  </div>
                </div>
              </div>
            </div>
            <div className="shrink-0 border-t border-white/10 p-3 pt-2.5">
              <button
                type="button"
                className="h-10 w-full rounded-full bg-white text-[14px] font-semibold text-black transition hover:bg-white/90 active:scale-[0.99]"
                onClick={dismissOnboarding}
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const PhoneHit = memo(function PhoneHit({
  control,
  left,
  top,
  width,
  height,
  hitShape,
  isSelected,
  isHitzone,
  isPeer,
  isForgiving,
  showHitzoneHatch,
  viewportHeight,
  draftRef,
  selectedId,
  onSelect,
  onDraftChange,
  selectedRef,
  locked,
  onToggleLock,
  onDelete,
  isSelectedHitzone,
  isMultiTouchRef,
  isPinchingRef,
}: {
  control: Control;
  left: number;
  top: number;
  width: number;
  height: number;
  hitShape: 'rect' | 'ellipse';
  isSelected: boolean;
  isHitzone: boolean;
  isPeer: boolean;
  isForgiving: boolean;
  showHitzoneHatch: boolean;
  viewportHeight: number;
  draftRef: React.MutableRefObject<LayoutDocument>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDraftChange: (next: LayoutDocument, commit: boolean) => void;
  selectedRef: React.RefObject<HTMLDivElement | null>;
  locked: boolean;
  onToggleLock: () => void;
  onDelete: () => void;
  isSelectedHitzone: boolean;
  isMultiTouchRef: React.MutableRefObject<boolean>;
  isPinchingRef: React.MutableRefObject<boolean>;
}) {
  const hitRef = useRef<HTMLButtonElement>(null);
  const vhRef = useRef(viewportHeight);
  const selectedIdRef = useRef(selectedId);
  const isSelectedRef = useRef(isSelected);
  const onSelectRef = useRef(onSelect);
  const onDraftRef = useRef(onDraftChange);
  vhRef.current = viewportHeight;
  selectedIdRef.current = selectedId;
  isSelectedRef.current = isSelected;
  onSelectRef.current = onSelect;
  onDraftRef.current = onDraftChange;
  const startWasSelectedRef = useRef(false);
  const isParentRef = useRef(false);
  void locked;
  void onToggleLock;
  void onDelete;
  void isSelectedHitzone;
  const isDpad = control.type === 'dpad';
  // keep parent check fresh without re-binding interact
  const parentCheck = getHitzonesOf(draftRef.current, control.id).length > 0;
  isParentRef.current = parentCheck && control.type !== 'hitzone';

  useEffect(() => {
    const el = hitRef.current;
    if (!el) return;
    const instance = interact(el).draggable({
      // don't steal handles — those are handled by useInteractGeometry on selectedRef
      ignoreFrom: '[data-phone-handles], [data-phone-handles] *',
      listeners: {
        start() {
          if (isMultiTouchRef.current || isPinchingRef.current) return;
          startWasSelectedRef.current = isSelectedRef.current;
          if (!isSelectedRef.current) {
            onSelectRef.current(control.id);
          }
        },
        move(event: { dx: number; dy: number }) {
          if (isMultiTouchRef.current || isPinchingRef.current) return;
          if (startWasSelectedRef.current) return;
          const vh = Math.max(1, vhRef.current);
          const deltaX = event.dx / vh;
          const deltaY = event.dy / vh;
          const latest = draftRef.current;
          if (isParentRef.current) {
            const next = moveParentWithHitzones(
              latest,
              control.id,
              deltaX,
              deltaY,
            );
            draftRef.current = next;
            onDraftRef.current(next, false);
          } else {
            const found = findControl(latest, control.id);
            if (!found) return;
            const next = updateControlGeometry(
              latest,
              control.id,
              clampDrag(found.control.geometry, deltaX, deltaY, found.section),
            );
            draftRef.current = next;
            onDraftRef.current(next, false);
          }
        },
        end() {
          if (isMultiTouchRef.current || isPinchingRef.current) return;
          if (startWasSelectedRef.current) return;
          onDraftRef.current(draftRef.current, true);
        },
      },
    });
    return () => instance.unset();
  }, [control.id, draftRef]);

  return (
    <button
      type="button"
      ref={hitRef}
      data-phone-hit
      className={
        'phone-editor-hit absolute rounded touch-none cursor-grab select-none border pointer-events-auto ' +
        (isDpad
          ? 'border-transparent bg-transparent ' + (isSelected ? 'z-10 ' : '')
          : isSelected
            ? 'border-[#7c86ff] bg-[rgba(124,134,255,0.08)] z-10 '
            : isHitzone
              ? 'border-dashed border-white/35 bg-white/[0.06] opacity-35 '
              : 'border-white/10 bg-transparent ') +
        (isPeer && !isSelected && !isDpad
          ? '!border-dashed !border-[rgb(250_204_21/0.95)] !bg-[rgb(250_204_21/0.12)] ' +
            (isHitzone ? '!bg-[rgb(250_204_21/0.14)] ' : '')
          : '') +
        (isSelected && isHitzone ? '!opacity-60 ' : '')
      }
      style={{
        left,
        top,
        width,
        height,
        borderRadius: hitShape === 'ellipse' ? '50%' : undefined,
      }}
      data-control-id={control.id}
      data-hit-shape={hitShape}
      onClick={(e) => {
        if (isMultiTouchRef.current || isPinchingRef.current) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        e.stopPropagation();
        onSelect(control.id);
      }}
    >
      {isForgiving && (
        <div className="editor-forgiving-hatch" aria-hidden="true" />
      )}
      {showHitzoneHatch && (
        <div className="editor-hitzone-hatch" aria-hidden="true" />
      )}
      {isSelected && (
        <>
          <div
            className="absolute -inset-[1px] border-2 border-[#7c86ff] rounded-[6px] pointer-events-none shadow-[0_0_0_1px_rgba(124,134,255,0.25)]"
            aria-hidden="true"
          />
          <div
            ref={selectedRef}
            className="absolute inset-0 pointer-events-auto touch-none"
            data-phone-handles
          >
            <span className="phone-editor-handle tl absolute size-6 grid place-items-center bg-transparent pointer-events-auto touch-none top-[-12px] left-[-12px]">
              <span className="size-2 bg-[#7c86ff] rounded-[1px] block shadow-[0_1px_3px_rgba(0,0,0,0.35)]" />
            </span>
            <span className="phone-editor-handle tr absolute size-6 grid place-items-center bg-transparent pointer-events-auto touch-none top-[-12px] right-[-12px]">
              <span className="size-2 bg-[#7c86ff] rounded-[1px] block shadow-[0_1px_3px_rgba(0,0,0,0.35)]" />
            </span>
            <span className="phone-editor-handle bl absolute size-6 grid place-items-center bg-transparent pointer-events-auto touch-none bottom-[-12px] left-[-12px]">
              <span className="size-2 bg-[#7c86ff] rounded-[1px] block shadow-[0_1px_3px_rgba(0,0,0,0.35)]" />
            </span>
            <span className="phone-editor-handle br absolute size-6 grid place-items-center bg-transparent pointer-events-auto touch-none bottom-[-12px] right-[-12px]">
              <span className="size-2 bg-[#7c86ff] rounded-[1px] block shadow-[0_1px_3px_rgba(0,0,0,0.35)]" />
            </span>
          </div>
        </>
      )}
    </button>
  );
});

export interface PhoneEditorHandle {
  unmount: () => void;
  isDestroyed: () => boolean;
}

export function mountPhoneEditor(
  hostEl: HTMLElement,
  options: {
    document: LayoutDocument;
    sender: FrameSender;
    state: InputStateStore;
    renderer?: RenderedLayout;
    hostLayoutIds?: string[];
    onSave: (doc: LayoutDocument) => void;
    onCancel: () => void;
  },
): PhoneEditorHandle {
  const container = document.createElement('div');
  hostEl.append(container);
  const root: Root = createRoot(container);
  let destroyed = false;

  const cleanup = () => {
    if (destroyed) return;
    destroyed = true;
    try {
      root.unmount();
    } catch {}
    container.remove();
  };

  const handleSave = (doc: LayoutDocument) => {
    cleanup();
    options.onSave(doc);
  };
  const handleCancel = () => {
    cleanup();
    options.onCancel();
  };

  root.render(
    <PhoneEditorIsland
      initialDoc={options.document}
      sender={options.sender}
      state={options.state}
      renderer={options.renderer}
      hostLayoutIds={options.hostLayoutIds}
      onSave={handleSave}
      onCancel={handleCancel}
    />,
  );

  return {
    unmount: cleanup,
    isDestroyed: () => destroyed,
  };
}
