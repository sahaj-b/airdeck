import interact from 'interactjs';
import { Hand, Mouse } from 'lucide-react';
import {
  memo,
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
  type ResolvedLayout,
  resolveLayout,
} from '@/controller/layout-resolver';
import { InputStateStore } from '@/controller/state';
import { cn } from '@/lib/utils';
import type {
  Control,
  Document as LayoutDocument,
} from '@/shared/generated/layout';
import {
  clampSectionDivider,
  effectiveHitShape,
  findControl,
  getHitzonesOf,
  getSectionControlMin,
  isDefaultLocked,
  moveControlAcross,
  moveParentWithHitzonesAcross,
  resizeControl,
} from '@/shared/layout-editor';
import { useInteractGeometry } from '../use-interact-geometry';
import { ControlOverlay } from './control-overlay';

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

const VIEWPORT_MIN_W = 320;
const VIEWPORT_MAX_W = 1400;
const VIEWPORT_MIN_H = 320;
const VIEWPORT_MAX_H = 1400;

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

  const scheduleLive = useCallback((doc: LayoutDocument) => {
    pendingLiveRef.current = doc;
    if (liveRafRef.current === null) {
      liveRafRef.current = requestAnimationFrame(() => {
        liveRafRef.current = null;
        const pending = pendingLiveRef.current;
        pendingLiveRef.current = null;
        if (pending) onDraftChangeRef.current(pending, false);
      });
    }
  }, []);

  const flushLive = useCallback(() => {
    if (liveRafRef.current !== null) {
      cancelAnimationFrame(liveRafRef.current);
      liveRafRef.current = null;
    }
    pendingLiveRef.current = null;
  }, []);

  const batchedHitDraftChange = useCallback(
    (doc: LayoutDocument, commit: boolean) => {
      latestRef.current = doc;
      if (commit) {
        flushLive();
        onDraftChangeRef.current(doc, true);
      } else {
        scheduleLive(doc);
      }
    },
    [scheduleLive, flushLive],
  );

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

  const fitScale = useMemo(() => {
    if (available.width === 0 || available.height === 0) return 1;
    return Math.min(
      available.width / viewport.width,
      available.height / viewport.height,
    );
  }, [available, viewport]);

  const scale = fitScale * zoom;
  const pixelViewport = useMemo(
    () => ({ width: viewport.width * scale, height: viewport.height * scale }),
    [viewport, scale],
  );

  const resolved: ResolvedLayout | null = useMemo(
    () =>
      resolveLayout(
        document,
        { width: pixelViewport.width, height: pixelViewport.height },
        'landscape',
      ),
    [document, pixelViewport],
  );

  const mountedStructureRef = useRef<string | null>(null);
  const ensureGhostChrome = useCallback(() => {
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

  const zoomAtCenter = useCallback(
    (factor: number): void => {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      applyZoom(
        zoomRef.current * factor,
        rect.left + rect.width / 2,
        rect.top + rect.height / 2,
      );
    },
    [applyZoom],
  );

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

  const selectedPeerIds = useMemo(() => {
    if (!selectedControlId) return new Set<string>();
    const found = findControl(document, selectedControlId);
    if (!found || found.control.type === 'hitzone') return new Set<string>();
    const hitzones = getHitzonesOf(document, selectedControlId);
    return new Set<string>(hitzones);
  }, [document, selectedControlId]);

  const hoveredPeerIds = useMemo(() => {
    if (!hoveredControlId) return new Set<string>();
    const found = findControl(document, hoveredControlId);
    if (!found || found.control.type === 'hitzone') return new Set<string>();
    return new Set<string>(getHitzonesOf(document, hoveredControlId));
  }, [document, hoveredControlId]);

  const locked = selectedControl
    ? (locks[selectedControl.id] ?? isDefaultLocked(selectedControl))
    : true;

  const { resolvedRect } = useMemo(() => {
    if (!resolved || !selectedControlId) return { resolvedRect: null };
    let rect: {
      left: number;
      top: number;
      width: number;
      height: number;
    } | null = null;
    for (const section of resolved.sections) {
      for (const control of section.controls) {
        if (control.control.id === selectedControlId) {
          rect = control.visual;
          break;
        }
      }
      if (rect) break;
    }
    return {
      resolvedRect: rect,
    };
  }, [resolved, selectedControlId]);

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
      const hasHitzones = getHitzonesOf(cur, selectedControlId).length > 0;
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
              const isParent =
                getHitzonesOf(document, rc.control.id).length > 0;
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
            applyZoom(
              1,
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

const ControlHit = memo(function ControlHit({
  control,
  rect,
  isSelected,
  isParent,
  isPeer,
  isSelectedPeer,
  isHovered,
  viewport,
  viewportHeight,
  scale,
  latestRef,
  selectedRef,
  onSelectControl,
  onSelectSection,
  onDraftChange,
}: {
  control: Control;
  rect: { left: number; top: number; width: number; height: number };
  isSelected: boolean;
  isParent: boolean;
  isPeer: boolean;
  isSelectedPeer: boolean;
  isHovered: boolean;
  viewport: { width: number; height: number };
  viewportHeight: number;
  scale: number;
  latestRef: React.MutableRefObject<LayoutDocument>;
  selectedRef: React.RefObject<HTMLDivElement | null>;
  onSelectControl: (id: string | null) => void;
  onSelectSection: (id: string | null) => void;
  onDraftChange: (next: LayoutDocument, commit: boolean) => void;
}) {
  const hitRef = useRef<HTMLButtonElement>(null);
  const scaleRef = useRef(scale);
  const vhRef = useRef(viewportHeight);
  const viewportRef = useRef(viewport);
  const onSelectRef = useRef(onSelectControl);
  const onDraftRef = useRef(onDraftChange);
  const isSelectedRef = useRef(isSelected);
  const isParentRef = useRef(isParent);
  const onSelectSectionRef = useRef(onSelectSection);
  const startWasSelectedRef = useRef(false);
  const isHitzone = control.type === 'hitzone';
  const isDpad = control.type === 'dpad';
  const hitShape = effectiveHitShape(control);

  // direct sync without effects - cheaper than 7 useEffects
  scaleRef.current = scale;
  vhRef.current = viewportHeight;
  viewportRef.current = viewport;
  onSelectRef.current = onSelectControl;
  onDraftRef.current = onDraftChange;
  isSelectedRef.current = isSelected;
  isParentRef.current = isParent;
  onSelectSectionRef.current = onSelectSection;

  useEffect(() => {
    const el = hitRef.current;
    if (!el) return;
    const instance = interact(el).draggable({
      listeners: {
        start() {
          startWasSelectedRef.current = isSelectedRef.current;
          if (!isSelectedRef.current) {
            onSelectRef.current(control.id);
            onSelectSectionRef.current(null);
          }
        },
        move(event: { dx: number; dy: number }) {
          if (startWasSelectedRef.current) return;
          const vh = Math.max(1, vhRef.current);
          const s = scaleRef.current || 1;
          const deltaX = event.dx / s / vh;
          const deltaY = event.dy / s / vh;
          const latest = latestRef.current;
          const isParentWithHitzones =
            isParentRef.current && control.type !== 'hitzone';
          let next: LayoutDocument;
          if (isParentWithHitzones) {
            next = moveParentWithHitzonesAcross(
              latest,
              control.id,
              deltaX,
              deltaY,
              viewportRef.current,
            );
          } else {
            next = moveControlAcross(
              latest,
              control.id,
              deltaX,
              deltaY,
              viewportRef.current,
            );
          }
          latestRef.current = next;
          onDraftRef.current(next, false);
        },
        end() {
          if (startWasSelectedRef.current) return;
          onDraftRef.current(latestRef.current, true);
        },
      },
    });
    return () => instance.unset();
  }, [control.id, control.type, latestRef]);

  const isForgiving =
    isSelected &&
    hitShape === 'rect' &&
    control.shape === 'round' &&
    !isHitzone &&
    control.type !== 'label' &&
    control.type !== 'dpad';
  const showHitzoneHatch = isHitzone && (isSelectedPeer || isSelected);

  return (
    <button
      type="button"
      ref={hitRef}
      className={cn(
        'editor-control-hit',
        isDpad && 'editor-control-dpad',
        isHitzone && 'editor-hit-only',
        !isDpad && isSelected && 'editor-control-selected',
        !isDpad && isPeer && !isSelected && 'editor-control-peer',
        !isDpad &&
          isHovered &&
          !isSelected &&
          !isPeer &&
          'editor-control-hovered',
      )}
      style={{
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      }}
      data-control-id={control.id}
      data-hit-shape={hitShape}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.stopPropagation();
        onSelectControl(control.id);
        onSelectSection(null);
      }}
      onClick={(event) => {
        event.stopPropagation();
        onSelectControl(control.id);
        onSelectSection(null);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.stopPropagation();
          onSelectControl(control.id);
          onSelectSection(null);
        }
      }}
    >
      {isForgiving && (
        <div className="editor-forgiving-hatch" aria-hidden="true" />
      )}
      {showHitzoneHatch && (
        <div className="editor-hitzone-hatch" aria-hidden="true" />
      )}
      {isSelected && (
        <div ref={selectedRef} className="editor-interaction-layer">
          <ControlOverlay selected isHitzone={isHitzone} isDpad={isDpad} />
        </div>
      )}
    </button>
  );
});

function ViewportSlider({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="flex min-w-0 max-w-[180px] flex-1 items-center gap-2">
      <span className="w-3 shrink-0 text-[10px] font-medium text-muted-foreground">
        {label}
      </span>
      <Slider
        className="min-w-0 flex-1"
        value={Math.round(value)}
        min={min}
        max={max}
        step={1}
        onValueChange={(v: number | readonly number[]) => {
          const next = Array.isArray(v) ? v[0] : v;
          if (typeof next === 'number') onChange(Math.round(next));
        }}
      />
    </div>
  );
}

function SectionDivider({
  side,
  document,
  viewport,
  scale,
  x,
  onDraftChange,
  onSelectSection,
  onSelectControl,
}: {
  side: 'left' | 'right';
  document: LayoutDocument;
  viewport: { width: number; height: number };
  scale: number;
  x: number;
  onDraftChange: (next: LayoutDocument, commit: boolean) => void;
  onSelectSection: (id: string | null) => void;
  onSelectControl: (id: string | null) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const startRef = useRef(0);
  const accRef = useRef(0);
  const startScaleRef = useRef(scale);
  const documentRef = useRef(document);
  const viewportRef = useRef(viewport);
  const scaleRef = useRef(scale);
  const onDraftChangeRef = useRef(onDraftChange);
  const onSelectSectionRef = useRef(onSelectSection);
  const onSelectControlRef = useRef(onSelectControl);
  documentRef.current = document;
  viewportRef.current = viewport;
  scaleRef.current = scale;
  onDraftChangeRef.current = onDraftChange;
  onSelectSectionRef.current = onSelectSection;
  onSelectControlRef.current = onSelectControl;
  startScaleRef.current = scale;

  const sideSection = document.sections[side === 'left' ? 0 : 2];
  const controlMin = getSectionControlMin(sideSection);
  const currentWidth = sideSection.relativeWidth;
  const isBlockedByControls = currentWidth <= controlMin + 0.001;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const instance = interact(el).draggable({
      lockAxis: 'x',
      startAxis: 'x',
      cursorChecker: () => 'ew-resize',
      listeners: {
        start() {
          const section = documentRef.current.sections.find(
            (s) => s.id === side,
          );
          startRef.current = section?.relativeWidth ?? 0;
          startScaleRef.current = scaleRef.current;
          accRef.current = 0;
          onSelectSectionRef.current(side);
          onSelectControlRef.current(null);
        },
        move(event: { dx: number }) {
          accRef.current += event.dx;
          const vp = viewportRef.current;
          const delta =
            accRef.current / startScaleRef.current / Math.max(1, vp.height);
          const proposed =
            side === 'left'
              ? startRef.current + delta
              : startRef.current - delta;
          const clamped = clampSectionDivider(
            documentRef.current,
            side,
            proposed,
            vp,
          );
          const clampedDelta =
            side === 'left'
              ? clamped - startRef.current
              : startRef.current - clamped;
          const clampedAcc =
            clampedDelta * startScaleRef.current * Math.max(1, vp.height);
          if (Math.abs(clamped - proposed) > 1e-9) {
            accRef.current = clampedAcc;
          }
          const next = structuredClone(
            documentRef.current,
          ) as typeof documentRef.current;
          const sec = next.sections.find((s) => s.id === side);
          if (sec) sec.relativeWidth = clamped;
          documentRef.current = next;
          onDraftChangeRef.current(next, false);
        },
        end() {
          onDraftChangeRef.current(documentRef.current, true);
        },
      },
    });
    return () => instance.unset();
  }, [side]);

  let tooltipText: string;
  if (isBlockedByControls) {
    const maxAbsX = Math.max(
      ...sideSection.controls.map((c) => Math.abs(c.geometry.position.x)),
    );
    const limiting = sideSection.controls.filter(
      (c) => Math.abs(c.geometry.position.x) >= maxAbsX - 0.005,
    );
    const name = limiting[0]?.label || limiting[0]?.id || 'control';
    tooltipText = `Can't shrink, ${name} is in the way`;
  } else {
    tooltipText = 'Drag to resize';
  }

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <div
            ref={ref}
            className="editor-section-divider"
            style={{ left: x }}
            aria-label={`Resize ${side} section`}
          />
        }
      />
      <TooltipContent side="top">{tooltipText}</TooltipContent>
    </Tooltip>
  );
}

function ViewportEdgeHandles({
  viewport,
  scale,
  onViewportChange,
}: {
  viewport: { width: number; height: number };
  scale: number;
  onViewportChange: (next: { width: number; height: number }) => void;
}) {
  const rightRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const cornerRef = useRef<HTMLDivElement>(null);
  const startRef = useRef({ width: 0, height: 0 });
  const accRef = useRef({ x: 0, y: 0 });
  const startScaleRef = useRef(scale);
  const viewportRef = useRef(viewport);
  const scaleRef = useRef(scale);
  const onViewportChangeRef = useRef(onViewportChange);
  viewportRef.current = viewport;
  scaleRef.current = scale;
  onViewportChangeRef.current = onViewportChange;

  useEffect(() => {
    const el = rightRef.current;
    if (!el) return;
    const instance = interact(el).draggable({
      lockAxis: 'x',
      startAxis: 'x',
      listeners: {
        start() {
          startRef.current = {
            width: viewportRef.current.width,
            height: viewportRef.current.height,
          };
          startScaleRef.current = scaleRef.current;
          accRef.current = { x: 0, y: 0 };
        },
        move(event: { dx: number }) {
          accRef.current.x += event.dx;
          const width = clamp(
            startRef.current.width + accRef.current.x / startScaleRef.current,
            VIEWPORT_MIN_W,
            VIEWPORT_MAX_W,
          );
          onViewportChangeRef.current({
            width,
            height: startRef.current.height,
          });
        },
      },
    });
    return () => instance.unset();
  }, []);

  useEffect(() => {
    const el = bottomRef.current;
    if (!el) return;
    const instance = interact(el).draggable({
      lockAxis: 'y',
      startAxis: 'y',
      listeners: {
        start() {
          startRef.current = {
            width: viewportRef.current.width,
            height: viewportRef.current.height,
          };
          startScaleRef.current = scaleRef.current;
          accRef.current = { x: 0, y: 0 };
        },
        move(event: { dy: number }) {
          accRef.current.y += event.dy;
          const height = clamp(
            startRef.current.height + accRef.current.y / startScaleRef.current,
            VIEWPORT_MIN_H,
            VIEWPORT_MAX_H,
          );
          onViewportChangeRef.current({
            width: startRef.current.width,
            height,
          });
        },
      },
    });
    return () => instance.unset();
  }, []);

  useEffect(() => {
    const el = cornerRef.current;
    if (!el) return;
    const instance = interact(el).draggable({
      listeners: {
        start() {
          startRef.current = {
            width: viewportRef.current.width,
            height: viewportRef.current.height,
          };
          startScaleRef.current = scaleRef.current;
          accRef.current = { x: 0, y: 0 };
        },
        move(event: { dx: number; dy: number }) {
          accRef.current.x += event.dx;
          accRef.current.y += event.dy;
          const width = clamp(
            startRef.current.width + accRef.current.x / startScaleRef.current,
            VIEWPORT_MIN_W,
            VIEWPORT_MAX_W,
          );
          const height = clamp(
            startRef.current.height + accRef.current.y / startScaleRef.current,
            VIEWPORT_MIN_H,
            VIEWPORT_MAX_H,
          );
          onViewportChangeRef.current({ width, height });
        },
      },
    });
    return () => instance.unset();
  }, []);

  return (
    <>
      <div
        ref={rightRef}
        className="editor-viewport-handle editor-handle-right"
      />
      <div
        ref={bottomRef}
        className="editor-viewport-handle editor-handle-bottom"
      />
      <div
        ref={cornerRef}
        className="editor-viewport-handle editor-handle-corner"
      />
    </>
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
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
