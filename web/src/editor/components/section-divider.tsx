import interact from 'interactjs';
import { useEffect, useRef } from 'react';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type { Document as LayoutDocument } from '@/shared/generated/layout';
import {
  clampSectionDivider,
  getSectionControlMin,
} from '@/shared/layout-editor';

export function SectionDivider({
  side,
  document,
  viewport,
  scale,
  x,
  onDraftChange,
  onSelectSection,
  onSelectControl,
}: {
  side: 'left' | 'right';
  document: LayoutDocument;
  viewport: { width: number; height: number };
  scale: number;
  x: number;
  onDraftChange: (next: LayoutDocument, commit: boolean) => void;
  onSelectSection: (id: string | null) => void;
  onSelectControl: (id: string | null) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const startRef = useRef(0);
  const accRef = useRef(0);
  const startScaleRef = useRef(scale);
  const documentRef = useRef(document);
  const viewportRef = useRef(viewport);
  const scaleRef = useRef(scale);
  const onDraftChangeRef = useRef(onDraftChange);
  const onSelectSectionRef = useRef(onSelectSection);
  const onSelectControlRef = useRef(onSelectControl);
  documentRef.current = document;
  viewportRef.current = viewport;
  scaleRef.current = scale;
  onDraftChangeRef.current = onDraftChange;
  onSelectSectionRef.current = onSelectSection;
  onSelectControlRef.current = onSelectControl;

  const sideSection = document.sections[side === 'left' ? 0 : 2];
  const controlMin = getSectionControlMin(sideSection);
  const currentWidth = sideSection.relativeWidth;
  const isBlockedByControls = currentWidth <= controlMin + 0.001;

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
          onSelectSectionRef.current(side);
          onSelectControlRef.current(null);
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
          const clampedDelta =
            side === 'left'
              ? clamped - startRef.current
              : startRef.current - clamped;
          const clampedAcc =
            clampedDelta * startScaleRef.current * Math.max(1, vp.height);
          if (Math.abs(clamped - proposed) > 1e-9) {
            accRef.current = clampedAcc;
          }
          const next = structuredClone(
            documentRef.current,
          ) as typeof documentRef.current;
          const sec = next.sections.find((s) => s.id === side);
          if (sec) sec.relativeWidth = clamped;
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

  let tooltipText: string;
  if (isBlockedByControls) {
    const maxAbsX = Math.max(
      ...sideSection.controls.map((c) => Math.abs(c.geometry.position.x)),
    );
    const limiting = sideSection.controls.filter(
      (c) => Math.abs(c.geometry.position.x) >= maxAbsX - 0.005,
    );
    const name = limiting[0]?.label || limiting[0]?.id || 'control';
    tooltipText = `Can't shrink, ${name} is in the way`;
  } else {
    tooltipText = `Drag to resize ${side === 'left' ? 'Left' : 'Right'} section`;
  }

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <div
            ref={ref}
            className="editor-section-divider"
            style={{ left: x }}
          />
        }
      />
      <TooltipContent side="top">{tooltipText}</TooltipContent>
    </Tooltip>
  );
}
