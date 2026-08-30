import interact from 'interactjs';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { FrameSender } from '../controller/frame-sender';
import type { RenderedLayout } from '../controller/layout-renderer';
import { resolveLayout } from '../controller/layout-resolver';
import type { InputStateStore } from '../controller/state';
import type { LayoutDocument } from '../shared/layout';
import { validateLayout } from '../shared/layout';
import {
  clampDrag,
  cloneDocument,
  FACE_BINDINGS,
  findControl,
  isDefaultLocked,
  LayoutHistory,
  moveLinkedGroup,
  resizeControl,
  updateControlGeometry,
} from '../shared/layout-editor';
import './phone-editor.css';
import { useInteractGeometry } from '../editor/use-interact-geometry';
import {
  loadPersonalLayouts,
  savePersonalLayout,
  slugify,
} from './personal-layouts';

const ONBOARDING_KEY = 'airdeck.phoneEditorOnboarded';

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
  const [detached, setDetached] = useState<Set<string>>(new Set());
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
        '.phone-editor-hit, .phone-editor-overlay-handles, .phone-editor-bar, .phone-editor-onboarding',
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

  const linkedIds = useMemo(() => {
    const ids = new Set<string>();
    for (const section of draft.sections) {
      const byBinding = new Map<string, string[]>();
      for (const control of section.controls) {
        if (
          control.binding &&
          FACE_BINDINGS.has(control.binding as unknown as string)
        ) {
          const list = byBinding.get(control.binding) ?? [];
          list.push(control.id);
          byBinding.set(control.binding, list);
        }
      }
      for (const group of byBinding.values()) {
        if (group.length > 1) for (const id of group) ids.add(id);
      }
    }
    return ids;
  }, [draft]);

  const isLinked =
    selectedControl &&
    linkedIds.has(selectedControl.id) &&
    !detached.has(selectedControl.id);

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
      if (isLinked) {
        next = moveLinkedGroup(draftRef.current, selectedId, deltaX, deltaY);
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
    [selectedId, isLinked],
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
    locked,
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

  const hitOnlySelected = selectedControl?.hitOnly ?? false;

  return (
    <div
      ref={overlayRef}
      className="phone-editor-overlay"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) setSelectedId(null);
      }}
    >
      <div className="phone-editor-bar">
        <button
          type="button"
          className="phone-editor-back"
          aria-label="Cancel"
          onClick={handleBack}
        >
          ←
        </button>
        <input
          className={`phone-editor-name${nameError ? ' error' : ''}`}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (nameError) setNameError(null);
          }}
          placeholder="Layout name"
        />
        <button
          type="button"
          className="phone-editor-link-btn"
          aria-label="Undo"
          onClick={handleUndo}
          disabled={!historyRef.current.canUndo}
          style={{ opacity: historyRef.current.canUndo ? 1 : 0.4 }}
        >
          ↩
        </button>
        <button
          type="button"
          className="phone-editor-link-btn"
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
            className="phone-editor-link-btn"
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
          className="phone-editor-save"
          onClick={handleSave}
        >
          {loadPersonalLayouts()[originalIdRef.current] ? 'Update' : 'Save'}
        </button>
      </div>
      {nameError && (
        <div
          style={{
            position: 'absolute',
            top: '28px',
            left: 0,
            right: 0,
            background: 'rgba(239,68,68,0.9)',
            color: 'white',
            fontSize: '11px',
            padding: '2px 8px',
            zIndex: 11,
          }}
        >
          {nameError}
        </div>
      )}

      <div
        ref={canvasWrapRef}
        className="phone-editor-canvas-wrap"
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
            const isHitOnly = rc.control.hitOnly;
            return (
              <button
                type="button"
                key={rc.control.id}
                className={
                  'phone-editor-hit' +
                  (isSelected ? ' selected' : '') +
                  (isHitOnly ? ' hit-only' : '')
                }
                style={{
                  left: rc.visual.left,
                  top: rc.visual.top,
                  width: rc.visual.width,
                  height: rc.visual.height,
                }}
                data-control-id={rc.control.id}
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedId(rc.control.id);
                }}
              >
                {isSelected && (
                  <div
                    ref={selectedRef}
                    className="phone-editor-overlay-handles"
                  >
                    <span className="phone-editor-handle tl" />
                    <span className="phone-editor-handle tr" />
                    <span className="phone-editor-handle bl" />
                    <span className="phone-editor-handle br" />
                    <div className="phone-editor-float">
                      <button
                        type="button"
                        className="phone-editor-link-btn"
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
                      <span>⛓️ {isLinked ? 'Linked' : 'Detached'}</span>
                      <button
                        type="button"
                        className="phone-editor-link-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDetached((prev) => {
                            const next = new Set(prev);
                            if (next.has(rc.control.id))
                              next.delete(rc.control.id);
                            else next.add(rc.control.id);
                            return next;
                          });
                        }}
                      >
                        {isLinked ? 'Detach' : 'Link'}
                      </button>
                      {hitOnlySelected && <span title="hitOnly">◈</span>}
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
          className="phone-editor-onboarding"
          role="dialog"
          aria-label="Editor tips"
        >
          <p>
            Drag to move, drag corners to resize.
            <br />
            Pinch to zoom, 2-finger tap undo, 3-finger tap redo.
          </p>
          <button type="button" onClick={dismissOnboarding}>
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
