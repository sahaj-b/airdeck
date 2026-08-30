import interact from 'interactjs';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
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
  FACE_BINDINGS,
  findControl,
  isDefaultLocked,
  moveLinkedGroup,
  resizeControl,
  updateControlGeometry,
  updateSectionWidth,
} from '@/shared/layout-editor';
import { useInteractGeometry } from '../use-interact-geometry';
import { ControlOverlay } from './control-overlay';

const PRESETS = [
  { id: 'se', label: 'SE 375×667', width: 375, height: 667 },
  { id: 'pixel', label: 'Pixel 390×844', width: 390, height: 844 },
  { id: 'ipad', label: 'iPad 600×1024', width: 600, height: 1024 },
] as const;

const VIEWPORT_MIN_W = 320;
const VIEWPORT_MAX_W = 1024;
const VIEWPORT_MIN_H = 480;
const VIEWPORT_MAX_H = 1200;

export interface LayoutCanvasProps {
  document: LayoutDocument;
  selectedControlId: string | null;
  onSelectControl: (id: string | null) => void;
  onSelectSection: (id: string | null) => void;
  onDraftChange: (next: LayoutDocument, commit: boolean) => void;
  locks: Record<string, boolean>;
  detached: Set<string>;
  onToggleDetach: (id: string) => void;
}

const emptyStore = new InputStateStore();

export function LayoutCanvas({
  document,
  selectedControlId,
  onSelectControl,
  onSelectSection,
  onDraftChange,
  locks,
  detached,
  onToggleDetach,
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
  const [viewport, setViewport] = useState({ width: 390, height: 844 });

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

  // Mount the non-interactive renderer; remount only when the control
  // structure changes, otherwise push geometry updates into the live renderer.
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

  // Linked groups: face button + fillers sharing a binding, computed once per
  // render instead of re-scanning per control in the hit layer.
  const linkedIds = useMemo(() => {
    const ids = new Set<string>();
    for (const section of document.sections) {
      const byBinding = new Map<string, string[]>();
      for (const control of section.controls) {
        if (control.binding && FACE_BINDINGS.has(control.binding)) {
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
  }, [document]);

  const locked = selectedControl
    ? (locks[selectedControl.id] ?? isDefaultLocked(selectedControl))
    : true;
  const selectedLinked = selectedControl
    ? linkedIds.has(selectedControl.id) && !detached.has(selectedControl.id)
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
    onDrag: (deltaX, deltaY) => {
      if (!selectedControlId) return;
      let next: LayoutDocument;
      if (selectedLinked) {
        next = moveLinkedGroup(document, selectedControlId, deltaX, deltaY);
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
    onDragEnd: () => onDraftChange(latestRef.current, true),
    onResizeEnd: () => onDraftChange(latestRef.current, true),
  });

  return (
    <section className="editor-canvas-panel">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Preview
        </h2>
        <div className="flex items-center gap-1">
          {PRESETS.map((preset) => (
            <Button
              key={preset.id}
              type="button"
              variant={
                viewport.width === preset.width &&
                viewport.height === preset.height
                  ? 'default'
                  : 'outline'
              }
              size="sm"
              onClick={() =>
                setViewport({ width: preset.width, height: preset.height })
              }
            >
              {preset.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="mb-2 flex items-center gap-4">
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
        <span className="font-mono text-[10px] text-white/40">
          {viewport.width}×{viewport.height}
        </span>
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
        >
          <div ref={mountRef} className="editor-renderer-mount" />

          {/* Section boundaries + dividers */}
          {resolved?.sections.map((section, index) => {
            const rect = section.rect;
            const isRightEdge = index === resolved.sections.length - 1;
            const side = index === 0 ? 'left' : index === 2 ? 'right' : null;
            return (
              <div key={section.section.id}>
                {side && (
                  <SectionDivider
                    side={side}
                    document={document}
                    viewport={viewport}
                    scale={scale}
                    x={rect.left + rect.width}
                    onDraftChange={onDraftChange}
                  />
                )}
                {!isRightEdge && (
                  <button
                    type="button"
                    className="editor-section-label"
                    style={{
                      left: rect.left + 4,
                      top: 4,
                    }}
                    onClick={() => onSelectSection(section.section.id)}
                  >
                    {section.section.id}
                  </button>
                )}
              </div>
            );
          })}

          {/* Control hit layers */}
          {resolved?.sections.flatMap((section) =>
            section.controls.map((rc) => {
              const rect = rc.visual;
              const isSelected = rc.control.id === selectedControlId;
              const isLinked = linkedIds.has(rc.control.id);
              return (
                <button
                  type="button"
                  key={rc.control.id}
                  className={cn(
                    'editor-control-hit',
                    rc.control.hitOnly && 'editor-hit-only',
                    isSelected && 'editor-control-selected',
                    isLinked && 'editor-control-linked',
                  )}
                  style={{
                    left: rect.left,
                    top: rect.top,
                    width: rect.width,
                    height: rect.height,
                  }}
                  data-control-id={rc.control.id}
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelectControl(rc.control.id);
                    onSelectSection(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.stopPropagation();
                      onSelectControl(rc.control.id);
                      onSelectSection(null);
                    }
                  }}
                >
                  {isSelected && (
                    <div ref={selectedRef} className="editor-interaction-layer">
                      <ControlOverlay
                        selected
                        hitOnly={rc.control.hitOnly}
                        linked={isLinked && !detached.has(rc.control.id)}
                        onToggleLink={() => onToggleDetach(rc.control.id)}
                      />
                    </div>
                  )}
                </button>
              );
            }),
          )}

          {/* Viewport edge resize handles */}
          <ViewportEdgeHandles
            viewport={viewport}
            scale={scale}
            onViewportChange={setViewport}
          />
        </div>
      </div>
    </section>
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
    <div className="flex items-center gap-2">
      <span className="w-3 text-[10px] text-muted-foreground">{label}</span>
      <Slider
        className="w-28"
        value={value}
        min={min}
        max={max}
        step={1}
        onValueChange={(v: number | readonly number[]) => {
          const next = Array.isArray(v) ? v[0] : v;
          if (typeof next === 'number') onChange(next);
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
      listeners: {
        start() {
          const section = documentRef.current.sections.find(
            (s) => s.id === side,
          );
          startRef.current = section?.relativeWidth ?? 0;
        },
        move(event: { dx: number }) {
          const vp = viewportRef.current;
          const proposed =
            startRef.current +
            event.dx / scaleRef.current / Math.max(1, vp.height);
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
    <div
      ref={ref}
      className="editor-section-divider"
      style={{ left: x }}
      title={`Drag to resize ${side} section`}
    />
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
        },
        move(event: { dx: number }) {
          const width = clamp(
            startRef.current.width + event.dx / scaleRef.current,
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
        },
        move(event: { dy: number }) {
          const height = clamp(
            startRef.current.height + event.dy / scaleRef.current,
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
        },
        move(event: { dx: number; dy: number }) {
          const width = clamp(
            startRef.current.width + event.dx / scaleRef.current,
            VIEWPORT_MIN_W,
            VIEWPORT_MAX_W,
          );
          const height = clamp(
            startRef.current.height + event.dy / scaleRef.current,
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
        visible: control.visible,
        hitOnly: control.hitOnly,
        shape: control.shape,
        asset: control.asset,
        binding: control.binding,
        bindings: control.bindings,
        label: control.label,
      })),
    })),
  );
}
