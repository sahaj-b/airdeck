import interact from 'interactjs';
import { useEffect, useRef, useState } from 'react';
import { isEditableTarget } from './dom';

export interface InteractGeometryOptions {
  enabled: boolean;
  targetRef: React.RefObject<HTMLElement | null>;
  viewportHeight: number;
  scale: number;
  getScale?: () => number;
  onDrag: (deltaX: number, deltaY: number) => void;
  onResize: (
    deltaWidth: number,
    deltaHeight: number,
    deltaLeft: number,
    deltaTop: number,
    locked: boolean,
  ) => void;
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

function shouldIgnoreShift(eventTarget: EventTarget | null): boolean {
  return (
    isEditableTarget(eventTarget) || isEditableTarget(document.activeElement)
  );
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
      if (shouldIgnoreShift(event.target)) {
        shiftHeldRef.current = false;
        return;
      }
      shiftHeldRef.current = event.shiftKey;
    };
    const clear = (): void => {
      shiftHeldRef.current = false;
    };
    const handleFocusIn = (): void => {
      if (isEditableTarget(document.activeElement))
        shiftHeldRef.current = false;
    };
    window.addEventListener('keydown', update);
    window.addEventListener('keyup', update);
    window.addEventListener('blur', clear);
    window.addEventListener('focusin', handleFocusIn);
    return () => {
      window.removeEventListener('keydown', update);
      window.removeEventListener('keyup', update);
      window.removeEventListener('blur', clear);
      window.removeEventListener('focusin', handleFocusIn);
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
        move(event: {
          deltaRect: {
            left: number;
            top: number;
            width: number;
            height: number;
          };
        }) {
          const scale = getScaleRef.current
            ? getScaleRef.current()
            : scaleRef.current || 1;
          const vh = Math.max(1, viewportHeightRef.current);
          const baseLocked = lockedRef.current;
          const ignoreShift = shouldIgnoreShift(null);
          const shiftLocked = ignoreShift ? false : shiftHeldRef.current;
          const eventShift = ignoreShift
            ? false
            : ((event as unknown as { shiftKey?: boolean }).shiftKey ?? false);
          const locked = baseLocked || shiftLocked || eventShift;
          const deltaWidth = event.deltaRect.width / scale / vh;
          const deltaHeight = event.deltaRect.height / scale / vh;
          const deltaLeft = event.deltaRect.left / scale / vh;
          const deltaTop = event.deltaRect.top / scale / vh;
          onResizeRef.current(
            deltaWidth,
            deltaHeight,
            deltaLeft,
            deltaTop,
            locked,
          );
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

export function useIsShiftHeld(): boolean {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    const update = (event: KeyboardEvent): void => {
      if (shouldIgnoreShift(event.target)) {
        setHeld(false);
        return;
      }
      setHeld(event.shiftKey);
    };
    const clear = (): void => setHeld(false);
    const handleFocusIn = (): void => {
      if (isEditableTarget(document.activeElement)) setHeld(false);
    };
    window.addEventListener('keydown', update);
    window.addEventListener('keyup', update);
    window.addEventListener('blur', clear);
    window.addEventListener('focusin', handleFocusIn);
    return () => {
      window.removeEventListener('keydown', update);
      window.removeEventListener('keyup', update);
      window.removeEventListener('blur', clear);
      window.removeEventListener('focusin', handleFocusIn);
    };
  }, []);
  return held;
}
