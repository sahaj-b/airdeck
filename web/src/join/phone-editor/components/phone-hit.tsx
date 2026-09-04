import interact from 'interactjs';
import { memo, useEffect, useRef } from 'react';
import type {
  Control,
  Document as LayoutDocument,
} from '@/shared/generated/layout';
import {
  getHitzonesOf,
  moveControlAcross,
  moveParentWithHitzonesAcross,
} from '@/shared/layout-editor';

interface PhoneHitProps {
  control: Control;
  left: number;
  top: number;
  width: number;
  height: number;
  hitShape: 'rect' | 'ellipse';
  isSelected: boolean;
  isHitzone: boolean;
  isPeer: boolean;
  isForgiving: boolean;
  showHitzoneHatch: boolean;
  viewport: { width: number; height: number };
  viewportHeight: number;
  draftRef: React.MutableRefObject<LayoutDocument | null>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDraftLive: (next: LayoutDocument) => void;
  onCommit: (next: LayoutDocument) => void;
  selectedRef: React.RefObject<HTMLDivElement | null>;
  locked: boolean;
  isMultiTouchRef: React.MutableRefObject<boolean>;
  isPinchingRef: React.MutableRefObject<boolean>;
}

export const PhoneHit = memo(function PhoneHit({
  control,
  left,
  top,
  width,
  height,
  hitShape,
  isSelected,
  isHitzone,
  isPeer,
  isForgiving,
  showHitzoneHatch,
  viewport,
  viewportHeight,
  draftRef,
  selectedId,
  onSelect,
  onDraftLive,
  onCommit,
  selectedRef,
  isMultiTouchRef,
  isPinchingRef,
}: PhoneHitProps) {
  const hitRef = useRef<HTMLButtonElement>(null);
  const vhRef = useRef(viewportHeight);
  const viewportRef = useRef(viewport);
  const selectedIdRef = useRef(selectedId);
  const isSelectedRef = useRef(isSelected);
  const onSelectRef = useRef(onSelect);
  const onDraftLiveRef = useRef(onDraftLive);
  const onCommitRef = useRef(onCommit);
  vhRef.current = viewportHeight;
  viewportRef.current = viewport;
  selectedIdRef.current = selectedId;
  isSelectedRef.current = isSelected;
  onSelectRef.current = onSelect;
  onDraftLiveRef.current = onDraftLive;
  onCommitRef.current = onCommit;
  const startWasSelectedRef = useRef(false);
  const isParentRef = useRef(false);
  const parentCheck = draftRef.current
    ? getHitzonesOf(draftRef.current, control.id).length > 0
    : false;
  isParentRef.current = parentCheck && control.type !== 'hitzone';

  useEffect(() => {
    const el = hitRef.current;
    if (!el) return;
    const instance = interact(el).draggable({
      ignoreFrom: '[data-phone-handles], [data-phone-handles] *',
      listeners: {
        start() {
          if (isMultiTouchRef.current || isPinchingRef.current) return;
          startWasSelectedRef.current = isSelectedRef.current;
          if (!isSelectedRef.current) {
            onSelectRef.current(control.id);
          }
        },
        move(event: { dx: number; dy: number }) {
          if (isMultiTouchRef.current || isPinchingRef.current) return;
          if (startWasSelectedRef.current) return;
          const vh = Math.max(1, vhRef.current);
          const deltaX = event.dx / vh;
          const deltaY = event.dy / vh;
          const latest = draftRef.current;
          if (!latest) return;
          let next: LayoutDocument;
          if (isParentRef.current) {
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
          draftRef.current = next;
          onDraftLiveRef.current(next);
        },
        end() {
          if (isMultiTouchRef.current || isPinchingRef.current) return;
          if (startWasSelectedRef.current) return;
          const cur = draftRef.current;
          if (cur) onCommitRef.current(cur);
        },
      },
    });
    return () => instance.unset();
  }, [control.id]);

  return (
    <button
      type="button"
      ref={hitRef}
      data-phone-hit
      className={
        'phone-editor-hit absolute rounded touch-none cursor-grab select-none border pointer-events-auto ' +
        (isSelected
          ? 'border-[#7c86ff] bg-[rgba(124,134,255,0.08)] z-10 '
          : isHitzone
            ? 'border-dashed border-white/35 bg-white/[0.06] opacity-35 '
            : 'border-white/10 bg-transparent ') +
        (isPeer && !isSelected
          ? '!border-dashed !border-[rgb(250_204_21/0.95)] !bg-[rgb(250_204_21/0.12)] ' +
            (isHitzone ? '!bg-[rgb(250_204_21/0.14)] ' : '')
          : '') +
        (isSelected && isHitzone ? '!opacity-60 ' : '')
      }
      style={{
        left,
        top,
        width,
        height,
        borderRadius: hitShape === 'ellipse' ? '50%' : undefined,
      }}
      data-control-id={control.id}
      data-hit-shape={hitShape}
      onClick={(e) => {
        if (isMultiTouchRef.current || isPinchingRef.current) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        e.stopPropagation();
        onSelect(control.id);
      }}
    >
      {isForgiving && (
        <div className="editor-forgiving-hatch" aria-hidden="true" />
      )}
      {showHitzoneHatch && (
        <div className="editor-hitzone-hatch" aria-hidden="true" />
      )}
      {isSelected && (
        <>
          <div
            className="absolute -inset-[1px] border-2 border-[#7c86ff] rounded-[6px] pointer-events-none shadow-[0_0_0_1px_rgba(124,134,255,0.25)]"
            aria-hidden="true"
          />
          <div
            ref={selectedRef}
            className="absolute inset-0 pointer-events-auto touch-none"
            data-phone-handles
          >
            <span className="phone-editor-handle tl absolute size-6 grid place-items-center bg-transparent pointer-events-auto touch-none top-[-12px] left-[-12px]">
              <span className="size-2 bg-[#7c86ff] rounded-[1px] block shadow-[0_1px_3px_rgba(0,0,0,0.35)]" />
            </span>
            <span className="phone-editor-handle tr absolute size-6 grid place-items-center bg-transparent pointer-events-auto touch-none top-[-12px] right-[-12px]">
              <span className="size-2 bg-[#7c86ff] rounded-[1px] block shadow-[0_1px_3px_rgba(0,0,0,0.35)]" />
            </span>
            <span className="phone-editor-handle bl absolute size-6 grid place-items-center bg-transparent pointer-events-auto touch-none bottom-[-12px] left-[-12px]">
              <span className="size-2 bg-[#7c86ff] rounded-[1px] block shadow-[0_1px_3px_rgba(0,0,0,0.35)]" />
            </span>
            <span className="phone-editor-handle br absolute size-6 grid place-items-center bg-transparent pointer-events-auto touch-none bottom-[-12px] right-[-12px]">
              <span className="size-2 bg-[#7c86ff] rounded-[1px] block shadow-[0_1px_3px_rgba(0,0,0,0.35)]" />
            </span>
          </div>
        </>
      )}
    </button>
  );
});
