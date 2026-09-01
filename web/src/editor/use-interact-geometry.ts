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
  const shiftHeldRef = useRef(false);

  // direct sync without effects - cheaper than 9 useEffects
  onDragRef.current = options.onDrag;
  onResizeRef.current = options.onResize;
  onDragEndRef.current = options.onDragEnd;
  onResizeEndRef.current = options.onResizeEnd;
  getScaleRef.current = options.getScale;
  lockedRef.current = options.locked;
  viewportHeightRef.current = options.viewportHeight;
  scaleRef.current = options.scale;
  edgesRef.current = options.edges;

  useEffect(() => {
    const update = (event: KeyboardEvent): void => {
      shiftHeldRef.current = event.shiftKey;
    };
    const clear = (): void => {
      shiftHeldRef.current = false;
    };
    window.addEventListener('keydown', update);
    window.addEventListener('keyup', update);
    window.addEventListener('blur', clear);
    return () => {
      window.removeEventListener('keydown', update);
      window.removeEventListener('keyup', update);
      window.removeEventListener('blur', clear);
    };
  }, []);

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
          const baseLocked = lockedRef.current;
          const shiftLocked = shiftHeldRef.current;
          const eventShift =
            (event as unknown as { shiftKey?: boolean }).shiftKey ?? false;
          const locked = baseLocked || shiftLocked || eventShift;
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
  }, [options.enabled, options.targetRef, options.key]);
}
