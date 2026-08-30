import interact from 'interactjs';
import { useEffect, useMemo, useRef, useState } from 'react';
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
import type { Document as LayoutDocument } from '@/shared/generated/layout';
import {
  clampDrag,
  clampSectionDivider,
  findControl,
  getHitfillsOf,
  isDefaultLocked,
  moveParentWithHitfills,
  resizeControl,
  updateControlGeometry,
  updateSectionWidth,
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

const VIEWPORT_MIN_W = 320;
const VIEWPORT_MAX_W = 1400;
const VIEWPORT_MIN_H = 320;
const VIEWPORT_MAX_H = 1400;

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
  const rendererRef = useRef<RenderedLayout | null>(null);
  const selectedRef = useRef<HTMLDivElement>(null);
  const latestRef = useRef<LayoutDocument>(document);
  useEffect(() => {
    latestRef.current = document;
  }, [document]);
  const [available, setAvailable] = useState({ width: 0, height: 0 });
  const [viewport, setViewport] = useState({ width: 844, height: 390 });

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

  const scale = useMemo(() => {
    if (available.width === 0 || available.height === 0) return 1;
    return Math.min(
      available.width / viewport.width,
      available.height / viewport.height,
    );
  }, [available, viewport]);

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
  useEffect(() => {
    const key = structureSignature(document);
    if (key !== mountedStructureRef.current) {
      rendererRef.current?.destroy();
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
  }, [document, pixelViewport]);

  useEffect(
    () => () => {
      rendererRef.current?.destroy();
      rendererRef.current = null;
    },
    [],
  );

  const selectedControl = selectedControlId
    ? findControl(document, selectedControlId)?.control
    : null;

  const selectedPeerIds = useMemo(() => {
    if (!selectedControlId) return new Set<string>();
    const found = findControl(document, selectedControlId);
    if (!found || found.control.type === 'hitfill') return new Set<string>();
    const hitfills = getHitfillsOf(document, selectedControlId);
    return new Set<string>(hitfills);
  }, [document, selectedControlId]);

  const locked = selectedControl
    ? (locks[selectedControl.id] ?? isDefaultLocked(selectedControl))
    : true;
  const isParentWithHitfills = selectedControl
    ? getHitfillsOf(document, selectedControl.id).length > 0
    : false;

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
      let next: LayoutDocument;
      if (isParentWithHitfills) {
        next = moveParentWithHitfills(
          document,
          selectedControlId,
          deltaX,
          deltaY,
        );
      } else {
        const found = findControl(document, selectedControlId);
        if (!found) return;
        next = updateControlGeometry(
          document,
          selectedControlId,
          clampDrag(found.control.geometry, deltaX, deltaY, found.section),
        );
      }
      latestRef.current = next;
      onDraftChange(next, false);
    },
    onResize: (deltaWidth, deltaHeight, isLocked) => {
      if (!selectedControlId) return;
      const found = findControl(document, selectedControlId);
      if (!found) return;
      const next = resizeControl(
        document,
        selectedControlId,
        deltaWidth,
        deltaHeight,
        isLocked,
      );
      latestRef.current = next;
      onDraftChange(next, false);
    },
    onDragEnd: () => {
      onDraftChange(latestRef.current, true);
    },
    onResizeEnd: () => {
      onDraftChange(latestRef.current, true);
    },
  });

  const viewportSizeLabel = `${Math.round(viewport.width)} × ${Math.round(viewport.height)}`;

  return (
    <section className="editor-canvas-panel">
      <div className="editor-canvas-toolbar">
        <div className="editor-canvas-toolbar__sliders">
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
        <div className="editor-canvas-toolbar__presets">
          {PRESETS.map((preset) => (
            <Tooltip key={preset.id}>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    variant={
                      viewport.width === preset.width &&
                      viewport.height === preset.height
                        ? 'default'
                        : 'outline'
                    }
                    size="sm"
                    className="h-7 px-2.5 text-xs"
                    onClick={() =>
                      setViewport({
                        width: preset.width,
                        height: preset.height,
                      })
                    }
                    aria-pressed={
                      viewport.width === preset.width &&
                      viewport.height === preset.height
                    }
                  >
                    {preset.label}
                  </Button>
                }
              />
              <TooltipContent side="top" className="flex items-center gap-1.5">
                <span className="font-medium">{preset.fullName}</span>
                <span className="text-muted-foreground">
                  {preset.width}×{preset.height}
                </span>
              </TooltipContent>
            </Tooltip>
          ))}
        </div>
        <span className="editor-canvas-toolbar__size">{viewportSizeLabel}</span>
      </div>

      <div
        ref={containerRef}
        className="editor-canvas"
        onPointerDown={(event) => {
          if (event.target === event.currentTarget) {
            onSelectControl(null);
            onSelectSection(null);
          }
        }}
      >
        <div
          className="editor-scaled"
          style={{ width: pixelViewport.width, height: pixelViewport.height }}
          onPointerDown={(event) => {
            const target = event.target as HTMLElement;
            if (target.closest('.editor-control-hit')) return;
            if (target.closest('.editor-section-divider')) return;
            if (target.closest('.editor-viewport-handle')) return;
            if (target.closest('.editor-section-label')) return;
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
                getHitfillsOf(document, rc.control.id).length > 0;
              const isPeer = selectedPeerIds.has(rc.control.id);
              const isHovered = hoveredControlId === rc.control.id;
              const isHoveredPeer =
                hoveredControlId !== null &&
                hoveredControlId !== undefined &&
                (() => {
                  if (!hoveredControlId) return false;
                  const hoveredFound = findControl(document, hoveredControlId);
                  if (!hoveredFound) return false;
                  if (hoveredFound.control.type === 'hitfill') return false;
                  const hits = getHitfillsOf(document, hoveredControlId);
                  return hits.includes(rc.control.id);
                })();
              return (
                <ControlHit
                  key={rc.control.id}
                  control={rc.control}
                  rect={rect}
                  isSelected={isSelected}
                  isParent={isParent}
                  isPeer={isPeer || isHoveredPeer}
                  isHovered={isHovered}
                  viewportHeight={viewport.height}
                  scale={scale}
                  latestRef={latestRef}
                  selectedRef={selectedRef}
                  onSelectControl={onSelectControl}
                  onSelectSection={onSelectSection}
                  onDraftChange={onDraftChange}
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
    </section>
  );
}

function ControlHit({
  control,
  rect,
  isSelected,
  isParent,
  isPeer,
  isHovered,
  viewportHeight,
  scale,
  latestRef,
  selectedRef,
  onSelectControl,
  onSelectSection,
  onDraftChange,
}: {
  control: LayoutDocument['sections'][number]['controls'][number];
  rect: { left: number; top: number; width: number; height: number };
  isSelected: boolean;
  isParent: boolean;
  isPeer: boolean;
  isHovered: boolean;
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
  const onSelectRef = useRef(onSelectControl);
  const onDraftRef = useRef(onDraftChange);
  const isSelectedRef = useRef(isSelected);
  const isParentRef = useRef(isParent);
  const onSelectSectionRef = useRef(onSelectSection);
  const startWasSelectedRef = useRef(false);
  const isHitfill = control.type === 'hitfill';

  useEffect(() => {
    scaleRef.current = scale;
  }, [scale]);
  useEffect(() => {
    vhRef.current = viewportHeight;
  }, [viewportHeight]);
  useEffect(() => {
    onSelectRef.current = onSelectControl;
  }, [onSelectControl]);
  useEffect(() => {
    onDraftRef.current = onDraftChange;
  }, [onDraftChange]);
  useEffect(() => {
    isSelectedRef.current = isSelected;
  }, [isSelected]);
  useEffect(() => {
    isParentRef.current = isParent;
  }, [isParent]);
  useEffect(() => {
    onSelectSectionRef.current = onSelectSection;
  }, [onSelectSection]);

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
          const isParentWithHitfills =
            isParentRef.current && control.type !== 'hitfill';
          let next: LayoutDocument;
          if (isParentWithHitfills) {
            next = moveParentWithHitfills(latest, control.id, deltaX, deltaY);
          } else {
            const found = findControl(latest, control.id);
            if (!found) return;
            next = updateControlGeometry(
              latest,
              control.id,
              clampDrag(found.control.geometry, deltaX, deltaY, found.section),
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
  }, [control.id]);

  return (
    <button
      type="button"
      ref={hitRef}
      className={cn(
        'editor-control-hit',
        isHitfill && 'editor-hit-only',
        isSelected && 'editor-control-selected',
        isPeer && !isSelected && 'editor-control-peer',
        isHovered && !isSelected && !isPeer && 'editor-control-hovered',
      )}
      style={{
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      }}
      data-control-id={control.id}
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
      {isSelected && (
        <div ref={selectedRef} className="editor-interaction-layer">
          <ControlOverlay selected isHitfill={isHitfill} />
        </div>
      )}
    </button>
  );
}

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
}: {
  side: 'left' | 'right';
  document: LayoutDocument;
  viewport: { width: number; height: number };
  scale: number;
  x: number;
  onDraftChange: (next: LayoutDocument, commit: boolean) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const startRef = useRef(0);
  const accRef = useRef(0);
  const startScaleRef = useRef(scale);
  const documentRef = useRef(document);
  const viewportRef = useRef(viewport);
  const scaleRef = useRef(scale);
  const onDraftChangeRef = useRef(onDraftChange);
  useEffect(() => {
    documentRef.current = document;
  }, [document]);
  useEffect(() => {
    viewportRef.current = viewport;
  }, [viewport]);
  useEffect(() => {
    scaleRef.current = scale;
  }, [scale]);
  useEffect(() => {
    onDraftChangeRef.current = onDraftChange;
  }, [onDraftChange]);

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
          const next = updateSectionWidth(documentRef.current, side, clamped);
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
      <TooltipContent side="top">Drag to resize {side} section</TooltipContent>
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
  useEffect(() => {
    viewportRef.current = viewport;
  }, [viewport]);
  useEffect(() => {
    scaleRef.current = scale;
  }, [scale]);
  useEffect(() => {
    onViewportChangeRef.current = onViewportChange;
  }, [onViewportChange]);

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
  return JSON.stringify(
    document.sections.map((section) => ({
      id: section.id,
      controls: section.controls.map((control) => ({
        id: control.id,
        type: control.type,
        parentId: control.parentId,
        shape: control.shape,
        asset: control.asset,
        binding: control.binding,
        bindings: control.bindings,
        label: control.label,
      })),
    })),
  );
}
