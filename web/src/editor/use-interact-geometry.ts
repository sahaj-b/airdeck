import interact from 'interactjs';
import { useEffect, useRef } from 'react';

export interface InteractGeometryOptions {
  enabled: boolean;
  targetRef: React.RefObject<HTMLElement | null>;
  viewportHeight: number;
  scale: number;
  getScale?: () => number;
  onDrag: (deltaX: number, deltaY: number) => void;
  onResize: (deltaWidth: number, deltaHeight: number, locked: boolean) => void;
  onDragEnd: () => void;
  onResizeEnd: () => void;
  locked: boolean;
  key?: string;
  edges?: {
    left?: boolean | string;
    right?: boolean | string;
    top?: boolean | string;
    bottom?: boolean | string;
  };
}

export function useInteractGeometry(options: InteractGeometryOptions): void {
  const onDragRef = useRef(options.onDrag);
  const onResizeRef = useRef(options.onResize);
  const onDragEndRef = useRef(options.onDragEnd);
  const onResizeEndRef = useRef(options.onResizeEnd);
  const getScaleRef = useRef(options.getScale);
  const lockedRef = useRef(options.locked);
  const viewportHeightRef = useRef(options.viewportHeight);
  const scaleRef = useRef(options.scale);
  const edgesRef = useRef(options.edges);
  useEffect(() => {
    onDragRef.current = options.onDrag;
  }, [options.onDrag]);
  useEffect(() => {
    onResizeRef.current = options.onResize;
  }, [options.onResize]);
  useEffect(() => {
    onDragEndRef.current = options.onDragEnd;
  }, [options.onDragEnd]);
  useEffect(() => {
    onResizeEndRef.current = options.onResizeEnd;
  }, [options.onResizeEnd]);
  useEffect(() => {
    getScaleRef.current = options.getScale;
  }, [options.getScale]);
  useEffect(() => {
    lockedRef.current = options.locked;
  }, [options.locked]);
  useEffect(() => {
    viewportHeightRef.current = options.viewportHeight;
  }, [options.viewportHeight]);
  useEffect(() => {
    scaleRef.current = options.scale;
  }, [options.scale]);
  useEffect(() => {
    edgesRef.current = options.edges;
  }, [options.edges]);

  useEffect(() => {
    const element = options.targetRef.current;
    if (!element || !options.enabled) return;

    const instance = interact(element);

    instance.draggable({
      listeners: {
        move(event: { dx: number; dy: number }) {
          const scale = getScaleRef.current
            ? getScaleRef.current()
            : scaleRef.current || 1;
          const vh = Math.max(1, viewportHeightRef.current);
          const deltaX = event.dx / scale / vh;
          const deltaY = event.dy / scale / vh;
          onDragRef.current(deltaX, deltaY);
        },
        end() {
          onDragEndRef.current();
        },
      },
    });

    const edges = edgesRef.current ?? {
      left: true,
      right: true,
      top: true,
      bottom: true,
    };

    instance.resizable({
      edges,
      listeners: {
        move(event: { deltaRect: { width: number; height: number } }) {
          const scale = getScaleRef.current
            ? getScaleRef.current()
            : scaleRef.current || 1;
          const vh = Math.max(1, viewportHeightRef.current);
          const locked = lockedRef.current;
          const deltaWidth = event.deltaRect.width / scale / vh;
          const deltaHeight = event.deltaRect.height / scale / vh;
          onResizeRef.current(deltaWidth, deltaHeight, locked);
        },
        end() {
          onResizeEndRef.current();
        },
      },
    });

    return () => {
      instance.unset();
    };
  }, [
    options.enabled,
    options.targetRef,
    options.viewportHeight,
    options.scale,
    options.key,
  ]);
}
