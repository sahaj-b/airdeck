import interact from 'interactjs';
import { memo, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import type {
  Control,
  Document as LayoutDocument,
} from '@/shared/generated/layout';
import {
  effectiveHitShape,
  moveControlAcross,
  moveParentWithHitzonesAcross,
  rotationOf,
  updateControlRotation,
} from '@/shared/layout-editor';
import { ControlOverlay } from './control-overlay';

export const ControlHit = memo(function ControlHit({
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
      ignoreFrom: '.editor-rotate-handle',
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
  const rotation = isHitzone ? rotationOf(control) : 0;

  return (
    <button
      type="button"
      ref={hitRef}
      className={cn(
        'editor-control-hit',
        isDpad && 'editor-control-dpad',
        isHitzone && 'editor-hit-only',
        isSelected && 'editor-control-selected',
        isPeer && !isSelected && 'editor-control-peer',
        isHovered && !isSelected && !isPeer && 'editor-control-hovered',
      )}
      style={{
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        transform: rotation !== 0 ? `rotate(${rotation}deg)` : undefined,
        transformOrigin: 'center',
      }}
      data-control-id={control.id}
      data-hit-shape={hitShape}
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
          <ControlOverlay selected isHitzone={isHitzone} />
          {isHitzone && (
            <RotateHandle
              hitRef={hitRef}
              controlId={control.id}
              rotation={rotation}
              latestRef={latestRef}
              onDraftChange={onDraftChange}
            />
          )}
        </div>
      )}
    </button>
  );
});

function RotateHandle({
  hitRef,
  controlId,
  rotation,
  latestRef,
  onDraftChange,
}: {
  hitRef: React.RefObject<HTMLButtonElement | null>;
  controlId: string;
  rotation: number;
  latestRef: React.MutableRefObject<LayoutDocument>;
  onDraftChange: (next: LayoutDocument, commit: boolean) => void;
}) {
  const dragRef = useRef<{ centerX: number; centerY: number } | null>(null);

  return (
    <div
      role="slider"
      aria-label="Rotate hitzone"
      aria-valuemin={0}
      aria-valuemax={359}
      aria-valuenow={Math.round(rotation)}
      tabIndex={0}
      title={`Rotate ${Math.round(rotation)}deg (Shift snaps to 15deg)`}
      className="editor-rotate-handle"
      onKeyDown={(event) => {
        if (
          event.key !== 'ArrowLeft' &&
          event.key !== 'ArrowRight' &&
          event.key !== 'ArrowUp' &&
          event.key !== 'ArrowDown'
        )
          return;
        event.stopPropagation();
        event.preventDefault();
        const step = event.shiftKey ? 15 : 1;
        const delta =
          event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -step : step;
        const next = updateControlRotation(
          latestRef.current,
          controlId,
          rotation + delta,
        );
        latestRef.current = next;
        onDraftChange(next, true);
      }}
      onPointerDown={(event) => {
        event.stopPropagation();
        event.preventDefault();
        const el = hitRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        dragRef.current = {
          centerX: rect.left + rect.width / 2,
          centerY: rect.top + rect.height / 2,
        };
        (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
      }}
      onPointerMove={(event) => {
        const center = dragRef.current;
        if (!center) return;
        event.stopPropagation();
        event.preventDefault();
        const dx = event.clientX - center.centerX;
        const dy = event.clientY - center.centerY;
        if (dx * dx + dy * dy < 4) return;
        let deg = (Math.atan2(dx, -dy) * 180) / Math.PI;
        if (event.shiftKey) deg = Math.round(deg / 15) * 15;
        const next = updateControlRotation(latestRef.current, controlId, deg);
        latestRef.current = next;
        onDraftChange(next, false);
      }}
      onPointerUp={(event) => {
        if (!dragRef.current) return;
        event.stopPropagation();
        dragRef.current = null;
        onDraftChange(latestRef.current, true);
      }}
      onPointerCancel={(event) => {
        if (!dragRef.current) return;
        event.stopPropagation();
        dragRef.current = null;
        onDraftChange(latestRef.current, true);
      }}
    />
  );
}
