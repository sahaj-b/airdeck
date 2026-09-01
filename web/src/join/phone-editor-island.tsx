import interact from 'interactjs';
import { Lock, LockOpen, Trash2 } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { FrameSender } from '../controller/frame-sender';
import type { RenderedLayout } from '../controller/layout-renderer';
import { resolveLayout } from '../controller/layout-resolver';
import type { InputStateStore } from '../controller/state';
import { useInteractGeometry } from '../editor/use-interact-geometry';
import type { Control, LayoutDocument } from '../shared/layout';
import { validateLayout } from '../shared/layout';
import {
  clampDrag,
  clampGeometry,
  cloneDocument,
  deleteControl,
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
        if (r.width > 2 && r.height > 2) return { width: r.width, height: r.height };
      }
      const hostEl = document.querySelector('.controller-host') as HTMLElement | null;
      if (hostEl) {
        const r = hostEl.getBoundingClientRect();
        const cs = getComputedStyle(hostEl);
        const padL = parseFloat(cs.paddingLeft) || 0;
        const padR = parseFloat(cs.paddingRight) || 0;
        const padT = parseFloat(cs.paddingTop) || 0;
        const padB = parseFloat(cs.paddingBottom) || 0;
        return { width: Math.max(1, r.width - padL - padR), height: Math.max(1, r.height - padT - padB) };
      }
    }
    return { width: window.innerWidth, height: window.innerHeight };
  };
  const getHostOrigin = (): { x: number; y: number } => {
    if (renderer?.root) {
      const comp = renderer.root.querySelector('.controller-composition') as HTMLElement | null;
      if (comp) {
        const r = comp.getBoundingClientRect();
        return { x: r.left, y: r.top };
      }
    }
    const hostEl = document.querySelector('.controller-host') as HTMLElement | null;
    if (hostEl) {
      const r = hostEl.getBoundingClientRect();
      const cs = getComputedStyle(hostEl);
      return { x: r.left + (parseFloat(cs.paddingLeft) || 0), y: r.top + (parseFloat(cs.paddingTop) || 0) };
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

  const handleDrag = useCallback(
    (deltaX: number, deltaY: number) => {
      if (!selectedId) return;
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
      if (e.touches.length === 2 && startSize && startDist > 0) {
        const curDist = dist(e.touches[0], e.touches[1]);
        const scale = curDist / startDist;
        if (Math.abs(scale - 1) < 0.04) return;
        didPinch = true;
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
        className="phone-editor-bar absolute top-0 left-0 right-0 h-7 flex items-center gap-1.5 px-1.5 bg-black/70 backdrop-blur-md z-10 pointer-events-auto"
        data-phone-bar
      >
        <button
          type="button"
          className="grid place-items-center size-7 shrink-0 border-0 bg-transparent text-white text-base cursor-pointer hover:bg-white/10 rounded"
          aria-label="Cancel"
          onClick={handleBack}
        >
          ←
        </button>
        <input
          className={`flex-1 min-w-0 bg-transparent border-0 border-b px-0.5 py-1 text-xs leading-none outline-none placeholder:text-white/50 ${nameError ? 'border-red-500 text-red-300 focus:border-red-500' : 'border-white/20 text-white focus:border-white/60'}`}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (nameError) setNameError(null);
          }}
          placeholder="Layout name"
        />
        <button
          type="button"
          className="rounded border border-white/20 bg-transparent px-1.5 py-0.5 text-white text-[11px] cursor-pointer disabled:opacity-40"
          aria-label="Undo"
          onClick={handleUndo}
          disabled={!historyRef.current.canUndo}
          style={{ opacity: historyRef.current.canUndo ? 1 : 0.4 }}
        >
          ↩
        </button>
        <button
          type="button"
          className="rounded border border-white/20 bg-transparent px-1.5 py-0.5 text-white text-[11px] cursor-pointer disabled:opacity-40"
          aria-label="Redo"
          onClick={handleRedo}
          disabled={!historyRef.current.canRedo}
          style={{ opacity: historyRef.current.canRedo ? 1 : 0.4 }}
        >
          ↪
        </button>
        <button
          type="button"
          className="h-[22px] w-[50px] shrink-0 rounded-md border border-white/20 bg-white text-black text-xs font-semibold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed hover:bg-white/90"
          onClick={handleSave}
        >
          {loadPersonalLayouts()[originalIdRef.current] ? 'Update' : 'Save'}
        </button>
      </div>
      {nameError && (
        <div
          className="absolute top-7 left-0 right-0 bg-red-500/90 text-white text-[11px] px-2 py-0.5 z-[11]"
          style={{ background: 'rgba(239,68,68,0.9)' }}
        >
          {nameError}
        </div>
      )}

      <div
        className="absolute inset-0 pointer-events-none"
        data-phone-canvas-wrap
        style={{ top: 28 }}
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
            const BAR_H = 28;
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
              />
            );
          }),
        )}
      </div>

      {showOnboarding && (
        <div
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-black/80 backdrop-blur-md border border-white/10 rounded-[10px] p-3 px-3.5 text-white text-xs leading-relaxed max-w-[280px] text-center pointer-events-auto"
          data-phone-onboarding
          role="dialog"
          aria-label="Editor tips"
        >
          <p>
            Drag any control to move, drag corners to resize.
            <br />
            Pinch selected control to resize, 2-finger tap undo, 3-finger tap
            redo.
          </p>
          <button
            type="button"
            className="mt-2 rounded-md border border-white/20 bg-white px-2.5 py-1 text-black text-xs cursor-pointer hover:bg-white/90"
            onClick={dismissOnboarding}
          >
            Got it
          </button>
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
          startWasSelectedRef.current = isSelectedRef.current;
          if (!isSelectedRef.current) {
            onSelectRef.current(control.id);
          }
        },
        move(event: { dx: number; dy: number }) {
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
        <div
          ref={selectedRef}
          className="absolute inset-0 pointer-events-auto touch-none"
          data-phone-handles
        >
          <span className="phone-editor-handle tl absolute size-2 bg-[#7c86ff] rounded-[1px] pointer-events-auto touch-none top-[-4px] left-[-4px]" />
          <span className="phone-editor-handle tr absolute size-2 bg-[#7c86ff] rounded-[1px] pointer-events-auto touch-none top-[-4px] right-[-4px]" />
          <span className="phone-editor-handle bl absolute size-2 bg-[#7c86ff] rounded-[1px] pointer-events-auto touch-none bottom-[-4px] left-[-4px]" />
          <span className="phone-editor-handle br absolute size-2 bg-[#7c86ff] rounded-[1px] pointer-events-auto touch-none bottom-[-4px] right-[-4px]" />
          <div className="absolute left-1/2 -translate-x-1/2 -top-8 flex items-center gap-1 bg-black/75 backdrop-blur-md px-1.5 py-1 rounded-md text-white whitespace-nowrap pointer-events-auto shadow-lg">
            <button
              type="button"
              className="grid place-items-center size-6 rounded bg-white/10 hover:bg-white/20 border border-white/15 cursor-pointer"
              onClick={(e) => {
                e.stopPropagation();
                onToggleLock();
              }}
              title={locked ? 'Unlock aspect ratio' : 'Lock aspect ratio'}
              aria-label={locked ? 'Unlock aspect ratio' : 'Lock aspect ratio'}
            >
              {locked ? <Lock size={12} /> : <LockOpen size={12} />}
            </button>
            <button
              type="button"
              className="grid place-items-center size-6 rounded bg-red-500/90 hover:bg-red-500 border border-white/15 cursor-pointer text-white"
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              title="Delete control"
              aria-label="Delete control"
            >
              <Trash2 size={12} />
            </button>
            {isSelectedHitzone && (
              <span className="text-[11px] opacity-80" title="hitzone">
                ◈ hitzone
              </span>
            )}
          </div>
        </div>
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
