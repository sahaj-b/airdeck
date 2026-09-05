import { Hand, Mouse } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  type RenderedLayout,
  renderLayout,
} from '@/controller/layout-renderer';
import {
  findControlVisual,
  type ResolvedLayout,
  resolveLayout,
} from '@/controller/layout-resolver';
import { InputStateStore } from '@/controller/state';
import { cn } from '@/lib/utils';
import type { Document as LayoutDocument } from '@/shared/generated/layout';
import {
  findControl,
  moveControlAcross,
  moveParentWithHitzonesAcross,
  resizeControl,
  resolveAspectLock,
} from '@/shared/layout-editor';
import { useInteractGeometry } from '../use-interact-geometry';
import { ControlHit } from './control-hit';
import { SectionDivider } from './section-divider';
import {
  VIEWPORT_MAX_H,
  VIEWPORT_MAX_W,
  VIEWPORT_MIN_H,
  VIEWPORT_MIN_W,
  ViewportEdgeHandles,
  ViewportSlider,
} from './viewport-handles';

const PRESETS = [
  { id: 'se', label: 'SE', fullName: 'iPhone SE', width: 667, height: 375 },
  {
    id: 'iphone',
    label: 'iPhone',
    fullName: 'iPhone 15',
    width: 844,
    height: 390,
  },
  { id: 'pixel', label: 'Pixel', fullName: 'Pixel 7', width: 915, height: 412 },
  {
    id: 'ultra',
    label: 'Ultra',
    fullName: 'Galaxy S Ultra',
    width: 932,
    height: 412,
  },
] as const;

const GHOST_GEAR_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><circle cx="12" cy="12" r="3.2"/><path d="M19.4 13.5a7.6 7.6 0 0 0 0-3l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-2.6-1.5L14 2.5h-4l-.4 2.5a7.6 7.6 0 0 0-2.6 1.5l-2.4-1-2 3.4 2 1.6a7.6 7.6 0 0 0 0 3l-2 1.6 2 3.4 2.4-1a7.6 7.6 0 0 0 2.6 1.5l.4 2.5h4l.4-2.5a7.6 7.6 0 0 0 2.6-1.5l2.4 1 2-3.4z"/></svg>';
const GHOST_EXPAND_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>';

const ZOOM_MIN = 0.4;
const ZOOM_MAX = 6;
const ZOOM_STEP = 1.2;
const WHEEL_ZOOM_SENSITIVITY = 0.0015;

export interface LayoutCanvasProps {
  document: LayoutDocument;
  selectedControlId: string | null;
  selectedSectionId?: string | null;
  hoveredControlId?: string | null;
  hoveredSectionId?: string | null;
  onSelectControl: (id: string | null) => void;
  onSelectSection: (id: string | null) => void;
  onHoverSection?: (id: string | null) => void;
  onDraftChange: (next: LayoutDocument, commit: boolean) => void;
  locks: Record<string, boolean>;
}

const emptyStore = new InputStateStore();

export function LayoutCanvas({
  document,
  selectedControlId,
  selectedSectionId,
  hoveredControlId,
  hoveredSectionId,
  onSelectControl,
  onSelectSection,
  onHoverSection,
  onDraftChange,
  locks,
}: LayoutCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mountRef = useRef<HTMLDivElement>(null);
  const scaledRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<RenderedLayout | null>(null);
  const selectedRef = useRef<HTMLDivElement>(null);
  const ghostRef = useRef<HTMLElement | null>(null);
  const latestRef = useRef<LayoutDocument>(document);
  latestRef.current = document;
  const onDraftChangeRef = useRef(onDraftChange);
  onDraftChangeRef.current = onDraftChange;
  const liveRafRef = useRef<number | null>(null);
  const pendingLiveRef = useRef<LayoutDocument | null>(null);

  const scheduleLive = (doc: LayoutDocument): void => {
    pendingLiveRef.current = doc;
    if (liveRafRef.current === null) {
      liveRafRef.current = requestAnimationFrame(() => {
        liveRafRef.current = null;
        const pending = pendingLiveRef.current;
        pendingLiveRef.current = null;
        if (pending) onDraftChangeRef.current(pending, false);
      });
    }
  };

  const flushLive = (): void => {
    if (liveRafRef.current !== null) {
      cancelAnimationFrame(liveRafRef.current);
      liveRafRef.current = null;
    }
    pendingLiveRef.current = null;
  };

  const batchedHitDraftChange = (
    doc: LayoutDocument,
    commit: boolean,
  ): void => {
    latestRef.current = doc;
    if (commit) {
      flushLive();
      onDraftChangeRef.current(doc, true);
    } else {
      scheduleLive(doc);
    }
  };

  useEffect(() => {
    return () => {
      if (liveRafRef.current !== null) cancelAnimationFrame(liveRafRef.current);
    };
  }, []);
  const [available, setAvailable] = useState({ width: 0, height: 0 });
  const [viewport, setViewport] = useState({ width: 844, height: 390 });
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const [spaceHeld, setSpaceHeld] = useState(false);
  const spaceHeldRef = useRef(spaceHeld);
  spaceHeldRef.current = spaceHeld;
  const [panning, setPanning] = useState(false);
  const panningRef = useRef(false);
  const panStartRef = useRef({ x: 0, y: 0, sl: 0, st: 0 });
  const pendingZoomAnchorRef = useRef<{
    clientX: number;
    clientY: number;
    ax: number;
    ay: number;
    k: number;
    preScrollLeft: number;
    preScrollTop: number;
  } | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) setAvailable({ width: rect.width, height: rect.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Viewport now maps directly to pixels via zoom, FIT is a one-time zoom level
  // instead of a permanent clamp. This lets the frame grow into empty space
  // when zoomed out, instead of staying locked to available * zoom.
  const scale = zoom;
  const pixelViewport = useMemo(
    () => ({ width: viewport.width * scale, height: viewport.height * scale }),
    [viewport, scale],
  );

  // Auto-fit on first mount so the phone fits without manual zoom.
  const hasAutoFittedRef = useRef(false);
  useEffect(() => {
    if (available.width === 0 || available.height === 0) return;
    if (hasAutoFittedRef.current) return;
    hasAutoFittedRef.current = true;
    const fit = Math.min(
      available.width / viewport.width,
      available.height / viewport.height,
    );
    const nextZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, fit));
    if (Math.abs(nextZoom - zoomRef.current) > 1e-4) {
      setZoom(nextZoom);
    }
  }, [available, viewport.width, viewport.height]);

  const resolved: ResolvedLayout | null = resolveLayout(
    document,
    { width: pixelViewport.width, height: pixelViewport.height },
    'landscape',
  );

  const mountedStructureRef = useRef<string | null>(null);
  const ensureGhostChrome = useCallback((): void => {
    const mount = mountRef.current;
    if (!mount) return;
    const center = mount.querySelector(
      '[data-section-id="center"]',
    ) as HTMLElement | null;
    if (!center) return;
    if (!ghostRef.current) {
      const doc = mount.ownerDocument;
      const ghost = doc.createElement('div');
      ghost.className = 'controller-runtime-chrome editor-ghost-chrome';
      ghost.setAttribute('aria-hidden', 'true');
      ghost.setAttribute('data-ghost-chrome', 'true');
      const identity = doc.createElement('div');
      identity.className = 'controller-identity';
      identity.innerHTML =
        '<span class="controller-slot">Player 1</span><span class="controller-name">Name</span>';
      const centerWrap = doc.createElement('div');
      centerWrap.className = 'controller-center';
      centerWrap.innerHTML = `<p class="controller-status">Ready</p><button class="icon-button" tabindex="-1" aria-hidden="true">${GHOST_GEAR_ICON}</button>`;
      const fsBtn = doc.createElement('button');
      fsBtn.className = 'icon-button fullscreen-button';
      fsBtn.setAttribute('tabindex', '-1');
      fsBtn.setAttribute('aria-hidden', 'true');
      fsBtn.innerHTML = GHOST_EXPAND_ICON;
      ghost.append(identity, centerWrap, fsBtn);
      ghostRef.current = ghost;
    }
    if (ghostRef.current.parentElement !== center) {
      center.append(ghostRef.current);
    }
  }, []);

  useEffect(() => {
    const key = structureSignature(document);
    if (key !== mountedStructureRef.current) {
      rendererRef.current?.destroy();
      ghostRef.current?.remove();
      ghostRef.current = null;
      const el = mountRef.current;
      if (el) {
        rendererRef.current = renderLayout(el, document, {
          state: emptyStore,
          orientation: 'landscape',
          interactive: false,
        });
      }
      mountedStructureRef.current = key;
    }
    rendererRef.current?.update(document, pixelViewport);
    rendererRef.current?.setOrientation('landscape', pixelViewport);
    ensureGhostChrome();
  }, [document, pixelViewport, ensureGhostChrome]);

  useEffect(
    () => () => {
      ghostRef.current?.remove();
      ghostRef.current = null;
      rendererRef.current?.destroy();
      rendererRef.current = null;
    },
    [],
  );

  // Zoom to an absolute multiplier, anchored so the content point under
  // (clientX, clientY) stays fixed. The scroll correction is applied in the
  // useLayoutEffect below after the re-resolved box has painted.
  const applyZoom = useCallback(
    (targetZoom: number, clientX: number, clientY: number): void => {
      const el = containerRef.current;
      const scaledEl = scaledRef.current;
      if (!el || !scaledEl) return;
      const nextZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, targetZoom));
      const oldZoom = zoomRef.current;
      if (Math.abs(nextZoom - oldZoom) < 1e-4) {
        setZoom(nextZoom);
        return;
      }
      const preRect = scaledEl.getBoundingClientRect();
      pendingZoomAnchorRef.current = {
        clientX,
        clientY,
        ax: clientX - preRect.left,
        ay: clientY - preRect.top,
        k: nextZoom / oldZoom,
        preScrollLeft: el.scrollLeft,
        preScrollTop: el.scrollTop,
      };
      setZoom(nextZoom);
    },
    [],
  );

  const zoomAtCenter = (factor: number): void => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    applyZoom(
      zoomRef.current * factor,
      rect.left + rect.width / 2,
      rect.top + rect.height / 2,
    );
  };

  // Wheel = zoom (pointer-anchored); Space+drag = pan (Excalidraw-style).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      let delta = event.deltaY;
      if (event.deltaMode === 1) delta *= 16;
      else if (event.deltaMode === 2) delta *= el.clientHeight;
      const factor = Math.exp(-delta * WHEEL_ZOOM_SENSITIVITY);
      applyZoom(zoomRef.current * factor, event.clientX, event.clientY);
    };

    const onPointerDown = (event: PointerEvent): void => {
      if (!spaceHeldRef.current) return;
      panningRef.current = true;
      setPanning(true);
      panStartRef.current = {
        x: event.clientX,
        y: event.clientY,
        sl: el.scrollLeft,
        st: el.scrollTop,
      };
      event.preventDefault();
      event.stopPropagation();
      el.setPointerCapture(event.pointerId);
    };
    const onPointerMove = (event: PointerEvent): void => {
      if (!panningRef.current) return;
      el.scrollLeft =
        panStartRef.current.sl - (event.clientX - panStartRef.current.x);
      el.scrollTop =
        panStartRef.current.st - (event.clientY - panStartRef.current.y);
    };
    const endPan = (event: PointerEvent): void => {
      if (!panningRef.current) return;
      panningRef.current = false;
      setPanning(false);
      if (el.hasPointerCapture(event.pointerId)) {
        el.releasePointerCapture(event.pointerId);
      }
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('pointerdown', onPointerDown, { capture: true });
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', endPan);
    el.addEventListener('pointercancel', endPan);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('pointerdown', onPointerDown, { capture: true });
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', endPan);
      el.removeEventListener('pointercancel', endPan);
    };
  }, [applyZoom]);

  // Hold Space to enter grab mode (ignore while typing in inputs).
  useEffect(() => {
    const isEditable = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false;
      if (target.isContentEditable) return true;
      const tag = target.tagName;
      return (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        Boolean(target.closest('[contenteditable="true"]'))
      );
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.code !== 'Space') return;
      if (isEditable(event.target)) {
        setSpaceHeld(false);
        return;
      }
      if (!event.repeat) {
        setSpaceHeld(true);
        event.preventDefault();
      }
    };
    const onKeyUp = (event: KeyboardEvent): void => {
      if (event.code !== 'Space') return;
      setSpaceHeld(false);
    };
    const onBlur = (): void => setSpaceHeld(false);
    // Capture phase so Space wins even when a selected control button is
    // focused (its own onKeyDown calls stopPropagation for Space).
    window.addEventListener('keydown', onKeyDown, { capture: true });
    window.addEventListener('keyup', onKeyUp, { capture: true });
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown, { capture: true });
      window.removeEventListener('keyup', onKeyUp, { capture: true });
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  // Restore the pointer anchor after a zoom re-renders the scaled box.
  useLayoutEffect(() => {
    const pending = pendingZoomAnchorRef.current;
    if (!pending) return;
    pendingZoomAnchorRef.current = null;
    const el = containerRef.current;
    const scaledEl = scaledRef.current;
    if (!el || !scaledEl) return;
    const postRect = scaledEl.getBoundingClientRect();
    el.scrollLeft =
      pending.preScrollLeft +
      (postRect.left + pending.ax * pending.k) -
      pending.clientX;
    el.scrollTop =
      pending.preScrollTop +
      (postRect.top + pending.ay * pending.k) -
      pending.clientY;
  }, [zoom]);

  const selectedControl = selectedControlId
    ? findControl(document, selectedControlId)?.control
    : null;

  // One pass over controls instead of a scan per hitzone lookup per render.
  const hitzonesByParent = indexHitzonesByParent(document);

  const selectedPeerIds = new Set(
    selectedControlId ? hitzonesByParent.get(selectedControlId) : undefined,
  );

  const hoveredPeerIds = new Set(
    hoveredControlId ? hitzonesByParent.get(hoveredControlId) : undefined,
  );

  const locked = selectedControl
    ? resolveAspectLock(selectedControl, locks)
    : true;

  const resolvedRect = findControlVisual(resolved, selectedControlId);

  useInteractGeometry({
    enabled: Boolean(resolvedRect && selectedControlId),
    targetRef: selectedRef,
    viewportHeight: viewport.height,
    scale,
    locked,
    key: selectedControlId ?? undefined,
    edges: {
      left: '.editor-handle-tl, .editor-handle-bl',
      right: '.editor-handle-tr, .editor-handle-br',
      top: '.editor-handle-tl, .editor-handle-tr',
      bottom: '.editor-handle-bl, .editor-handle-br',
    },
    onDrag: (deltaX, deltaY) => {
      if (!selectedControlId) return;
      const cur = latestRef.current;
      const hasHitzones = hitzonesByParent.has(selectedControlId);
      let next: LayoutDocument;
      if (hasHitzones) {
        next = moveParentWithHitzonesAcross(
          cur,
          selectedControlId,
          deltaX,
          deltaY,
          viewport,
        );
      } else {
        next = moveControlAcross(
          cur,
          selectedControlId,
          deltaX,
          deltaY,
          viewport,
        );
      }
      latestRef.current = next;
      scheduleLive(next);
    },
    onResize: (deltaWidth, deltaHeight, deltaLeft, deltaTop, isLocked) => {
      if (!selectedControlId) return;
      const cur = latestRef.current;
      const found = findControl(cur, selectedControlId);
      if (!found) return;
      const next = resizeControl(
        cur,
        selectedControlId,
        deltaWidth,
        deltaHeight,
        isLocked,
        deltaLeft,
        deltaTop,
      );
      latestRef.current = next;
      scheduleLive(next);
    },
    onDragEnd: () => {
      flushLive();
      onDraftChangeRef.current(latestRef.current, true);
    },
    onResizeEnd: () => {
      flushLive();
      onDraftChangeRef.current(latestRef.current, true);
    },
  });

  const viewportSizeLabel = `${Math.round(viewport.width)} × ${Math.round(viewport.height)}`;

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background gap-1.5">
      <div className="mt-1.5 flex min-h-9 items-stretch overflow-hidden rounded-[10px] border bg-card">
        <div className="flex min-w-[150px] flex-1 items-center gap-2.5 px-2">
          <ViewportSlider
            label="W"
            value={viewport.width}
            min={VIEWPORT_MIN_W}
            max={VIEWPORT_MAX_W}
            onChange={(width) => setViewport((v) => ({ ...v, width }))}
          />
          <ViewportSlider
            label="H"
            value={viewport.height}
            min={VIEWPORT_MIN_H}
            max={VIEWPORT_MAX_H}
            onChange={(height) => setViewport((v) => ({ ...v, height }))}
          />
        </div>
        <div className="flex shrink-0 items-stretch">
          {PRESETS.map((preset) => {
            const isActive =
              viewport.width === preset.width &&
              viewport.height === preset.height;
            return (
              <Tooltip key={preset.id}>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      className={cn(
                        'grid min-w-[46px] place-items-center border-l border-border/70 px-2.5 text-xs font-medium transition-colors hover:cursor-pointer hover:bg-muted',
                        isActive
                          ? 'bg-muted text-foreground'
                          : 'text-muted-foreground',
                      )}
                      onClick={() =>
                        setViewport({
                          width: preset.width,
                          height: preset.height,
                        })
                      }
                      aria-pressed={isActive}
                    >
                      {preset.label}
                    </button>
                  }
                />
                <TooltipContent
                  side="top"
                  className="flex items-center gap-1.5"
                >
                  <span className="font-medium">{preset.fullName}</span>
                  <span className="text-muted-foreground">
                    {preset.width}×{preset.height}
                  </span>
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
        <span className="flex items-center border-l border-border/70 px-2 font-mono text-xs font-medium tracking-wide text-muted-foreground whitespace-nowrap">
          {viewportSizeLabel}
        </span>
      </div>

      <div
        ref={containerRef}
        className={cn(
          'editor-canvas',
          spaceHeld && 'editor-canvas--space',
          panning && 'editor-canvas--panning',
        )}
        onPointerDown={(event) => {
          if (event.target === event.currentTarget) {
            onSelectControl(null);
            onSelectSection(null);
          }
        }}
      >
        <div
          ref={scaledRef}
          className="editor-scaled"
          style={{ width: pixelViewport.width, height: pixelViewport.height }}
          onPointerDown={(event) => {
            const target = event.target as HTMLElement;
            if (target.closest('.editor-control-hit')) return;
            if (target.closest('.editor-section-divider')) return;
            if (target.closest('.editor-viewport-handle')) return;
            if (target.closest('.editor-section-chip')) return;
            onSelectControl(null);
            onSelectSection(null);
          }}
        >
          <div ref={mountRef} className="editor-renderer-mount" />

          {/* Section boundaries + dividers */}
          {resolved?.sections.map((section, index) => {
            const rect = section.rect;
            const side = index === 0 ? 'left' : index === 2 ? 'right' : null;
            const dividerX =
              side === 'left'
                ? rect.left + rect.width
                : side === 'right'
                  ? rect.left
                  : 0;
            const isHoveredSection = hoveredSectionId === section.section.id;
            return (
              <div key={section.section.id}>
                {isHoveredSection && (
                  <div
                    className="editor-section-hover"
                    style={{
                      left: rect.left,
                      top: rect.top,
                      width: rect.width,
                      height: rect.height,
                    }}
                    aria-hidden="true"
                  />
                )}
                {side && (
                  <SectionDivider
                    side={side}
                    document={document}
                    viewport={viewport}
                    scale={scale}
                    x={dividerX}
                    onDraftChange={onDraftChange}
                    onSelectSection={onSelectSection}
                    onSelectControl={onSelectControl}
                  />
                )}
              </div>
            );
          })}

          {/* Control hit layers — auto-select on drag */}
          {resolved?.sections.flatMap((section) =>
            section.controls.map((rc) => {
              const rect = rc.visual;
              const isSelected = rc.control.id === selectedControlId;
              const isParent = hitzonesByParent.has(rc.control.id);
              const isSelectedPeer = selectedPeerIds.has(rc.control.id);
              const isPeer =
                isSelectedPeer || hoveredPeerIds.has(rc.control.id);
              const isHovered = hoveredControlId === rc.control.id;
              return (
                <ControlHit
                  key={rc.control.id}
                  control={rc.control}
                  rect={rect}
                  isSelected={isSelected}
                  isParent={isParent}
                  isPeer={isPeer}
                  isSelectedPeer={isSelectedPeer}
                  isHovered={isHovered}
                  viewport={viewport}
                  viewportHeight={viewport.height}
                  scale={scale}
                  latestRef={latestRef}
                  selectedRef={selectedRef}
                  onSelectControl={onSelectControl}
                  onSelectSection={onSelectSection}
                  onDraftChange={batchedHitDraftChange}
                />
              );
            }),
          )}

          {/* Viewport edge resize handles */}
          <ViewportEdgeHandles
            viewport={viewport}
            scale={scale}
            onViewportChange={setViewport}
          />

          {/* Section chips — inside canvas but below controller frame, aligned to sections */}
          {resolved?.sections.map((section) => {
            const rect = section.rect;
            const isSelected =
              selectedSectionId === section.section.id && !selectedControlId;
            const isHovered = hoveredSectionId === section.section.id;
            return (
              <button
                key={`chip-${section.section.id}`}
                type="button"
                className={cn(
                  'editor-section-chip editor-section-chip--aligned',
                  isSelected && 'editor-section-chip--selected',
                  isHovered && 'editor-section-chip--hovered',
                )}
                style={{
                  left: rect.left + rect.width / 2,
                  top: rect.height + 10,
                }}
                onClick={() => {
                  onSelectSection(section.section.id);
                  onSelectControl(null);
                }}
                onMouseEnter={() => onHoverSection?.(section.section.id)}
                onMouseLeave={() => onHoverSection?.(null)}
                aria-pressed={isSelected}
              >
                {section.section.id}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5 rounded-[10px] border bg-card px-2 py-1.5">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-6 w-6 p-0"
          onClick={() => zoomAtCenter(1 / ZOOM_STEP)}
          aria-label="Zoom out"
          title="Zoom out"
        >
          −
        </Button>
        <div className="w-36 shrink-0">
          <Slider
            className="w-full"
            value={Math.round(zoom * 100)}
            min={ZOOM_MIN * 100}
            max={ZOOM_MAX * 100}
            step={1}
            onValueChange={(v: number | readonly number[]) => {
              const next = Array.isArray(v) ? v[0] : v;
              if (typeof next !== 'number') return;
              const el = containerRef.current;
              if (!el) return;
              const rect = el.getBoundingClientRect();
              applyZoom(
                next / 100,
                rect.left + rect.width / 2,
                rect.top + rect.height / 2,
              );
            }}
          />
        </div>
        <span className="w-10 shrink-0 text-right text-[11px] font-medium tabular-nums text-muted-foreground">
          {Math.round(zoom * 100)}%
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-6 w-6 p-0"
          onClick={() => zoomAtCenter(ZOOM_STEP)}
          aria-label="Zoom in"
          title="Zoom in"
        >
          +
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-6 px-2 text-[11px]"
          onClick={() => {
            const el = containerRef.current;
            if (!el) return;
            const rect = el.getBoundingClientRect();
            const fit = (() => {
              if (available.width === 0 || available.height === 0) return 1;
              return Math.min(
                available.width / viewport.width,
                available.height / viewport.height,
              );
            })();
            const target = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, fit));
            applyZoom(
              target,
              rect.left + rect.width / 2,
              rect.top + rect.height / 2,
            );
          }}
        >
          Fit
        </Button>
        <div className="ml-auto flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Mouse className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="whitespace-nowrap">Scroll to zoom</span>
          <span className="opacity-60">·</span>
          <Hand className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="whitespace-nowrap">Space to pan</span>
        </div>
      </div>
    </section>
  );
}

function indexHitzonesByParent(
  document: LayoutDocument,
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const section of document.sections) {
    for (const control of section.controls) {
      if (control.type !== 'hitzone' || !control.parentId) continue;
      const ids = map.get(control.parentId);
      if (ids) ids.push(control.id);
      else map.set(control.parentId, [control.id]);
    }
  }
  return map;
}

function structureSignature(document: LayoutDocument): string {
  // lightweight signature without JSON.stringify allocation per control
  let sig = '';
  for (const section of document.sections) {
    sig += `${section.id}|`;
    for (const c of section.controls) {
      sig += `${c.id},${c.type},${c.parentId ?? ''},${c.shape ?? ''},${c.binding ?? ''},${c.label};`;
    }
    sig += '||';
  }
  return sig;
}
