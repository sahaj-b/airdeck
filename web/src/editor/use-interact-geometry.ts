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
}

export function useInteractGeometry(options: InteractGeometryOptions): void {
  const onDragRef = useRef(options.onDrag);
  const onResizeRef = useRef(options.onResize);
  const onDragEndRef = useRef(options.onDragEnd);
  const onResizeEndRef = useRef(options.onResizeEnd);
  const getScaleRef = useRef(options.getScale);
  const lockedRef = useRef(options.locked);
  onDragRef.current = options.onDrag;
  onResizeRef.current = options.onResize;
  onDragEndRef.current = options.onDragEnd;
  onResizeEndRef.current = options.onResizeEnd;
  getScaleRef.current = options.getScale;
  lockedRef.current = options.locked;

  useEffect(() => {
    const element = options.targetRef.current;
    if (!element || !options.enabled) return;

    const instance = interact(element);

    instance.draggable({
      listeners: {
        move(event: { dx: number; dy: number }) {
          const scale = getScaleRef.current
            ? getScaleRef.current()
            : options.scale || 1;
          const deltaX = event.dx / scale / Math.max(1, options.viewportHeight);
          const deltaY = event.dy / scale / Math.max(1, options.viewportHeight);
          onDragRef.current(deltaX, deltaY);
        },
        end() {
          onDragEndRef.current();
        },
      },
    });

    const isPhoneEditor = element.classList.contains(
      'phone-editor-overlay-handles',
    );
    const edges = isPhoneEditor
      ? {
          left: '.phone-editor-handle.tl, .phone-editor-handle.bl',
          right: '.phone-editor-handle.tr, .phone-editor-handle.br',
          top: '.phone-editor-handle.tl, .phone-editor-handle.tr',
          bottom: '.phone-editor-handle.bl, .phone-editor-handle.br',
        }
      : { left: true, right: true, bottom: true, top: true };

    instance.resizable({
      edges,
      listeners: {
        move(event: { deltaRect: { width: number; height: number } }) {
          const scale = getScaleRef.current
            ? getScaleRef.current()
            : options.scale || 1;
          const locked = lockedRef.current;
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
  }, [options.enabled, options.targetRef, options.viewportHeight]);
}
