import interact from 'interactjs';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  cloneDocument,
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

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
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
  const canvasWrapRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef({ zoom: 1, pan: { x: 0, y: 0 } });
  const [zoom, setZoom] = useState(1);
  const [viewport, setViewport] = useState(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));

  // sync refs
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  // init history + pause sender
  useEffect(() => {
    historyRef.current.reset(initialDoc);
    const wasRunning = sender.isRunning;
    if (wasRunning) sender.stop();
    renderer?.cancelPointers();
    state.reset();
    return () => {
      if (wasRunning) sender.start();
    };
  }, [initialDoc, sender, state, renderer]);

  // keep viewport updated
  useEffect(() => {
    const onResize = () => {
      setViewport({ width: window.innerWidth, height: window.innerHeight });
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, []);

  // JS pinch-zoom + 2-finger tap undo via gesturable — overlay owns it, ignores controls/bar
  // if you instantly lift 2 fingers (no pinch) -> undo, if you pinch -> zoom
  useEffect(() => {
    const el = overlayRef.current;
    const wrap = canvasWrapRef.current;
    if (!el || !wrap) return;
    let startZoom = 1;
    let startTime = 0;
    let didPinch = false;
    const gesturable = (
      interact(el) as unknown as {
        gesturable: (opts: unknown) => { unset: () => void };
      }
    ).gesturable;
    if (!gesturable) return;
    const inst = gesturable({
      ignoreFrom:
        '[data-phone-hit], [data-phone-handles], [data-phone-bar], [data-phone-onboarding]',
      listeners: {
        start() {
          startZoom = zoomRef.current.zoom;
          startTime = Date.now();
          didPinch = false;
        },
        move(event: unknown) {
          const e = event as {
            scale: number;
            clientX: number;
            clientY: number;
            dx: number;
            dy: number;
          };
          if (
            Math.abs(e.scale - 1) > 0.06 ||
            Math.hypot(e.dx ?? 0, e.dy ?? 0) > 14
          )
            didPinch = true;
          if (!didPinch) return;
          const rect = wrap.getBoundingClientRect();
          const cx = e.clientX - rect.left;
          const cy = e.clientY - rect.top;
          const next = clampNumber(startZoom * e.scale, 1, 5);
          const k = next / zoomRef.current.zoom;
          zoomRef.current.pan.x = cx - (cx - zoomRef.current.pan.x) * k;
          zoomRef.current.pan.y = cy - (cy - zoomRef.current.pan.y) * k;
          zoomRef.current.zoom = next;
          wrap.style.transform = `translate(${zoomRef.current.pan.x}px, ${zoomRef.current.pan.y}px) scale(${next})`;
          setZoom(next);
        },
        end(event: unknown) {
          const e = event as { scale: number };
          const dt = Date.now() - startTime;
          const scaleDelta = Math.abs(startZoom * (e.scale ?? 1) - startZoom);
          if (!didPinch && dt < 300 && scaleDelta < 0.06) {
            const prev = historyRef.current.undo();
            if (prev) {
              draftRef.current = prev;
              setDraft(prev);
            }
          }
        },
      },
    });
    return () => inst.unset();
  }, []);

  // 3-finger quick tap -> redo (2-finger tap is now undo via gesturable)
  useEffect(() => {
    const el = overlayRef.current;
    if (!el) return;
    let startTime = 0;
    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length === 3) startTime = Date.now();
    };
    const onTouchEnd = (event: TouchEvent) => {
      if (
        event.touches.length === 0 &&
        Date.now() - startTime < 300 &&
        startTime !== 0
      ) {
        // check that it was a 3-finger lift (changedTouches)
        const changed = (event as TouchEvent).changedTouches;
        if (changed.length === 3) {
          const next = historyRef.current.redo();
          if (next) {
            draftRef.current = next;
            setDraft(next);
          }
        }
        startTime = 0;
      }
    };
    el.addEventListener('touchstart', onTouchStart);
    el.addEventListener('touchend', onTouchEnd);
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchend', onTouchEnd);
    };
  }, []);

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

  useInteractGeometry({
    enabled: Boolean(selectedRect && selectedId),
    targetRef: selectedRef,
    viewportHeight: viewport.height,
    scale: 1,
    getScale: () => zoomRef.current.zoom,
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
      onPointerDown={(event) => {
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
        {zoom !== 1 && (
          <button
            type="button"
            className="rounded border border-white/20 bg-transparent px-1.5 py-0.5 text-white text-[11px] cursor-pointer"
            onClick={() => {
              zoomRef.current = { zoom: 1, pan: { x: 0, y: 0 } };
              if (canvasWrapRef.current) {
                canvasWrapRef.current.style.transform = '';
              }
              setZoom(1);
            }}
          >
            {Math.round(zoom * 100)}%
          </button>
        )}
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
        ref={canvasWrapRef}
        className="absolute inset-x-0 bottom-0 top-7 origin-top-left will-change-transform pointer-events-none"
        data-phone-canvas-wrap
        style={
          zoom !== 1
            ? {
                transform: `translate(${zoomRef.current.pan.x}px, ${zoomRef.current.pan.y}px) scale(${zoom})`,
              }
            : undefined
        }
      >
        {resolved.sections.flatMap((section) =>
          section.controls.map((rc) => {
            const isSelected = rc.control.id === selectedId;
            const isHitzone = rc.control.type === 'hitzone';
            const isPeer = selectedPeerIds.has(rc.control.id);
            const hitShape = effectiveHitShape(rc.control as Control);
            return (
              <button
                type="button"
                key={rc.control.id}
                data-phone-hit
                className={
                  'phone-editor-hit absolute rounded touch-none cursor-grab select-none border pointer-events-auto ' +
                  (isSelected
                    ? 'border-[#7c86ff] bg-[rgba(124,134,255,0.08)] '
                    : isHitzone
                      ? 'border-dashed border-white/35 bg-white/[0.06] opacity-35 '
                      : 'border-transparent ') +
                  (isPeer && !isSelected
                    ? '!border-dashed !border-[rgb(250_204_21/0.95)] !bg-[rgb(250_204_21/0.12)] ' +
                      (isHitzone ? '!bg-[rgb(250_204_21/0.14)] ' : '')
                    : '') +
                  (isSelected && isHitzone ? '!opacity-60 ' : '')
                }
                style={{
                  left: rc.visual.left,
                  top: rc.visual.top,
                  width: rc.visual.width,
                  height: rc.visual.height,
                  borderRadius: hitShape === 'ellipse' ? '50%' : undefined,
                }}
                data-control-id={rc.control.id}
                data-hit-shape={hitShape}
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedId(rc.control.id);
                }}
              >
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
                    <div className="absolute left-1/2 -translate-x-1/2 -top-7 flex items-center gap-1.5 bg-black/70 backdrop-blur-md px-1.5 py-0.5 rounded-md text-[11px] text-white whitespace-nowrap pointer-events-auto">
                      <button
                        type="button"
                        className="rounded border border-white/20 bg-transparent px-1.5 py-0.5 text-white text-[11px] cursor-pointer"
                        onClick={(e) => {
                          e.stopPropagation();
                          setLocks((prev) => {
                            const next = { ...prev };
                            const cur =
                              prev[rc.control.id] ??
                              isDefaultLocked(rc.control as never);
                            next[rc.control.id] = !cur;
                            return next;
                          });
                        }}
                        title={
                          locked ? 'Unlock aspect ratio' : 'Lock aspect ratio'
                        }
                      >
                        {locked ? '🔒' : '🔓'}
                      </button>
                      {isSelectedHitzone && (
                        <span title="hitzone">◈ hitzone</span>
                      )}
                    </div>
                  </div>
                )}
              </button>
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
            Drag to move, drag corners to resize.
            <br />
            Pinch to zoom, 2-finger tap undo, 3-finger tap redo.
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
