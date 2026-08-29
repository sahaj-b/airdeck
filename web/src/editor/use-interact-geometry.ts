import interact from 'interactjs';
import { useEffect, useRef } from 'react';

export interface InteractGeometryOptions {
  enabled: boolean;
  targetRef: React.RefObject<HTMLElement | null>;
  viewportHeight: number;
  scale: number;
  onDrag: (deltaX: number, deltaY: number) => void;
  onResize: (deltaWidth: number, deltaHeight: number, locked: boolean) => void;
  onDragEnd: () => void;
  onResizeEnd: () => void;
  locked: boolean;
}

export function useInteractGeometry(options: InteractGeometryOptions): void {
  const onDragRef = useRef(options.onDrag);
  const onResizeRef = useRef(options.onResize);
  const onDragEndRef = useRef(options.onDragEnd);
  const onResizeEndRef = useRef(options.onResizeEnd);
  onDragRef.current = options.onDrag;
  onResizeRef.current = options.onResize;
  onDragEndRef.current = options.onDragEnd;
  onResizeEndRef.current = options.onResizeEnd;

  useEffect(() => {
    const element = options.targetRef.current;
    if (!element || !options.enabled) return;

    const instance = interact(element);

    instance.draggable({
      listeners: {
        move(event: { dx: number; dy: number }) {
          const scale = options.scale || 1;
          const deltaX = event.dx / scale / Math.max(1, options.viewportHeight);
          const deltaY = event.dy / scale / Math.max(1, options.viewportHeight);
          onDragRef.current(deltaX, deltaY);
        },
        end() {
          onDragEndRef.current();
        },
      },
    });

    instance.resizable({
      edges: { left: true, right: true, bottom: true, top: true },
      listeners: {
        move(event: { deltaRect: { width: number; height: number } }) {
          const scale = options.scale || 1;
          const locked = options.locked;
          const deltaWidth =
            event.deltaRect.width / scale / Math.max(1, options.viewportHeight);
          const deltaHeight =
            event.deltaRect.height /
            scale /
            Math.max(1, options.viewportHeight);
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
    options.locked,
    options.scale,
    options.targetRef,
    options.viewportHeight,
  ]);
}
