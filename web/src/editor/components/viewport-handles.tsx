import interact from 'interactjs';
import { useEffect, useRef } from 'react';
import { Slider } from '@/components/ui/slider';

export const VIEWPORT_MIN_W = 320;
export const VIEWPORT_MAX_W = 1400;
export const VIEWPORT_MIN_H = 320;
export const VIEWPORT_MAX_H = 1400;

export function ViewportSlider({
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

export function ViewportEdgeHandles({
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
  const viewportRef = useRef(viewport);
  const scaleRef = useRef(scale);
  const onViewportChangeRef = useRef(onViewportChange);
  viewportRef.current = viewport;
  scaleRef.current = scale;
  onViewportChangeRef.current = onViewportChange;

  useEffect(() => {
    const el = rightRef.current;
    if (!el) return;
    const start = { width: 0, height: 0 };
    let accX = 0;
    let startScale = 1;
    const instance = interact(el).draggable({
      lockAxis: 'x',
      startAxis: 'x',
      cursorChecker: () => 'ew-resize',
      listeners: {
        start() {
          start.width = viewportRef.current.width;
          start.height = viewportRef.current.height;
          startScale = scaleRef.current || 1;
          accX = 0;
        },
        move(event: { dx: number }) {
          accX += event.dx;
          const width = clamp(
            start.width + accX / startScale,
            VIEWPORT_MIN_W,
            VIEWPORT_MAX_W,
          );
          onViewportChangeRef.current({
            width,
            height: start.height,
          });
        },
      },
    });
    return () => instance.unset();
  }, []);

  useEffect(() => {
    const el = bottomRef.current;
    if (!el) return;
    const start = { width: 0, height: 0 };
    let accY = 0;
    let startScale = 1;
    const instance = interact(el).draggable({
      lockAxis: 'y',
      startAxis: 'y',
      cursorChecker: () => 'ns-resize',
      listeners: {
        start() {
          start.width = viewportRef.current.width;
          start.height = viewportRef.current.height;
          startScale = scaleRef.current || 1;
          accY = 0;
        },
        move(event: { dy: number }) {
          accY += event.dy;
          const height = clamp(
            start.height + accY / startScale,
            VIEWPORT_MIN_H,
            VIEWPORT_MAX_H,
          );
          onViewportChangeRef.current({
            width: start.width,
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
    const start = { width: 0, height: 0 };
    let accX = 0;
    let accY = 0;
    let startScale = 1;
    const instance = interact(el).draggable({
      cursorChecker: () => 'nwse-resize',
      listeners: {
        start() {
          start.width = viewportRef.current.width;
          start.height = viewportRef.current.height;
          startScale = scaleRef.current || 1;
          accX = 0;
          accY = 0;
        },
        move(event: { dx: number; dy: number }) {
          accX += event.dx;
          accY += event.dy;
          const width = clamp(
            start.width + accX / startScale,
            VIEWPORT_MIN_W,
            VIEWPORT_MAX_W,
          );
          const height = clamp(
            start.height + accY / startScale,
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
        title="Drag to resize width (horizontal)"
      />
      <div
        ref={bottomRef}
        className="editor-viewport-handle editor-handle-bottom"
        title="Drag to resize height (vertical)"
      />
      <div
        ref={cornerRef}
        className="editor-viewport-handle editor-handle-corner"
        title="Drag to resize (diagonal)"
      />
    </>
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
