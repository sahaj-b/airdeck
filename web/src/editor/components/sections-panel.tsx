import { Copy, GripVertical, PanelLeftClose, Trash2 } from 'lucide-react';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type {
  Control,
  Document as LayoutDocument,
} from '@/shared/generated/layout';
import { getHitfillsOf } from '@/shared/layout-editor';

export interface SectionsPanelProps {
  document: LayoutDocument;
  selectedControlId: string | null;
  selectedSectionId?: string | null;
  hoveredControlId?: string | null;
  onSelectControl: (id: string) => void;
  onSelectSection?: (id: string) => void;
  onHoverSection?: (id: string | null) => void;
  onAddControl: (sectionId: string) => void;
  onMoveControl: (controlId: string, direction: 'up' | 'down') => void;
  onDuplicateControl?: (id: string) => void;
  onDeleteControl?: (id: string) => void;
  onReorderControl?: (
    sectionId: string,
    fromIndex: number,
    toIndex: number,
  ) => void;
  onHoverControl?: (id: string | null) => void;
  onCollapse?: () => void;
}

type DragState = {
  sectionId: string;
  fromIndex: number;
  draggedId: string;
  overIndex: number | null;
};

export function SectionsPanel({
  document,
  selectedControlId,
  selectedSectionId,
  hoveredControlId,
  onSelectControl,
  onSelectSection,
  onHoverSection,
  onAddControl,
  onMoveControl,
  onDuplicateControl,
  onDeleteControl,
  onReorderControl,
  onHoverControl,
  onCollapse,
}: SectionsPanelProps) {
  const selectedPeerIds = useMemo(() => {
    if (!selectedControlId) return new Set<string>();
    const found = document.sections
      .flatMap((section) => section.controls)
      .find((control) => control.id === selectedControlId);
    if (!found || found.type === 'hitfill') return new Set<string>();
    const hitfills = getHitfillsOf(document, selectedControlId);
    return new Set<string>(hitfills);
  }, [document, selectedControlId]);

  const hoveredPeerIds = useMemo(() => {
    if (!hoveredControlId) return new Set<string>();
    const found = document.sections
      .flatMap((section) => section.controls)
      .find((control) => control.id === hoveredControlId);
    if (!found) return new Set<string>();
    if (found.type === 'hitfill') return new Set<string>();
    const hitfills = getHitfillsOf(document, hoveredControlId);
    return new Set<string>(hitfills);
  }, [document, hoveredControlId]);

  return (
    <div className="flex min-h-0 w-full flex-col gap-4 p-0 overflow-y-auto bg-transparent">
      <div className="p-2 flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div className="text-xs font-medium text-muted-foreground px-2">
            Sections
          </div>
          {onCollapse && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8 shrink-0 text-muted-foreground hover:text-foreground"
                    onClick={onCollapse}
                    aria-label="Collapse sections"
                  >
                    <PanelLeftClose className="size-4" />
                  </Button>
                }
              />
              <TooltipContent side="right">Collapse sections</TooltipContent>
            </Tooltip>
          )}
        </div>
        <div className="flex flex-col gap-3">
          {document.sections.map((section) => (
            <SectionCard
              key={section.id}
              section={section}
              document={document}
              selectedControlId={selectedControlId}
              selectedSectionId={selectedSectionId ?? null}
              selectedPeerIds={selectedPeerIds}
              hoveredControlId={hoveredControlId ?? null}
              hoveredPeerIds={hoveredPeerIds}
              onSelectControl={onSelectControl}
              onSelectSection={onSelectSection}
              onHoverSection={onHoverSection}
              onMoveControl={onMoveControl}
              onDuplicateControl={onDuplicateControl}
              onDeleteControl={onDeleteControl}
              onReorderControl={onReorderControl}
              onAddControl={onAddControl}
              onHoverControl={onHoverControl}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

const SectionCard = memo(function SectionCard({
  section,
  document,
  selectedControlId,
  selectedSectionId,
  selectedPeerIds,
  hoveredControlId,
  hoveredPeerIds,
  onSelectControl,
  onSelectSection,
  onHoverSection,
  onMoveControl,
  onDuplicateControl,
  onDeleteControl,
  onReorderControl,
  onAddControl,
  onHoverControl,
}: {
  section: LayoutDocument['sections'][number];
  document: LayoutDocument;
  selectedControlId: string | null;
  selectedSectionId: string | null;
  selectedPeerIds: Set<string>;
  hoveredControlId: string | null;
  hoveredPeerIds: Set<string>;
  onSelectControl: (id: string) => void;
  onSelectSection?: (id: string) => void;
  onHoverSection?: (id: string | null) => void;
  onMoveControl: (controlId: string, direction: 'up' | 'down') => void;
  onDuplicateControl?: (id: string) => void;
  onDeleteControl?: (id: string) => void;
  onReorderControl?: (
    sectionId: string,
    fromIndex: number,
    toIndex: number,
  ) => void;
  onAddControl: (sectionId: string) => void;
  onHoverControl?: (id: string | null) => void;
}) {
  const [dragState, setDragState] = useState<DragState | null>(null);
  const dragStateRef = useRef<DragState | null>(null);
  dragStateRef.current = dragState;
  const listRef = useRef<HTMLUListElement>(null);
  const displayControls = useMemo(
    () => [...section.controls].slice().reverse(),
    [section.controls],
  );

  const onReorderRef = useRef(onReorderControl);
  onReorderRef.current = onReorderControl;
  const displayControlsRef = useRef(displayControls);
  displayControlsRef.current = displayControls;
  const sectionRef = useRef(section);
  sectionRef.current = section;

  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally run only when drag starts/ends
  useEffect(() => {
    const state = dragStateRef.current;
    if (!state) return;
    const handleMove = (event: PointerEvent): void => {
      const cur = dragStateRef.current;
      if (!cur || !listRef.current) return;
      const rows = Array.from(
        listRef.current.querySelectorAll<HTMLLIElement>('[data-control-row]'),
      );
      if (rows.length === 0) return;
      const y = event.clientY;
      let overIndex: number | null = null;
      for (let i = 0; i < rows.length; i++) {
        const rect = rows[i].getBoundingClientRect();
        if (y >= rect.top && y <= rect.bottom) {
          const mid = rect.top + rect.height / 2;
          overIndex = y < mid ? i : i + 1;
          break;
        }
      }
      if (overIndex === null) {
        const firstRect = rows[0].getBoundingClientRect();
        const lastRect = rows[rows.length - 1].getBoundingClientRect();
        if (y < firstRect.top) overIndex = 0;
        else if (y > lastRect.bottom) overIndex = rows.length;
      }
      if (overIndex !== null) {
        overIndex = Math.max(0, Math.min(overIndex, rows.length));
        setDragState((prev) => (prev ? { ...prev, overIndex } : prev));
      }
    };
    const handleUp = (): void => {
      const cur = dragStateRef.current;
      if (!cur || cur.overIndex === null) {
        setDragState(null);
        return;
      }
      const sec = sectionRef.current;
      const n = sec.controls.length;
      const fromActual = cur.fromIndex;
      const fromDisplay = n - 1 - fromActual;
      let toDisplay = cur.overIndex;
      if (toDisplay > fromDisplay) toDisplay -= 1;
      const displayWithout = displayControlsRef.current.filter(
        (c) => c.id !== cur.draggedId,
      );
      const dragged = sec.controls.find((c) => c.id === cur.draggedId);
      if (!dragged) {
        setDragState(null);
        return;
      }
      const newDisplay = [...displayWithout];
      newDisplay.splice(toDisplay, 0, dragged);
      const newActual = [...newDisplay].slice().reverse();
      const toActual = newActual.findIndex((c) => c.id === cur.draggedId);
      if (toActual !== fromActual && onReorderRef.current) {
        onReorderRef.current(sec.id, fromActual, toActual);
      }
      setDragState(null);
    };
    const handleKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setDragState(null);
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('keydown', handleKey);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('keydown', handleKey);
    };
  }, [dragState !== null]);

  const count = section.controls.length;
  const isSectionSelected =
    selectedSectionId === section.id && !selectedControlId;

  const parentHintMap = useMemo(() => {
    const map = new Map<string, string>();
    const byId = new Map<string, Control>();
    for (const s of document.sections) {
      for (const c of s.controls) byId.set(c.id, c as Control);
    }
    for (const c of section.controls) {
      if (c.type === 'hitfill' && c.parentId) {
        const parent = byId.get(c.parentId);
        if (!parent) {
          map.set(c.id, c.parentId);
          continue;
        }
        const binding = parent.binding;
        const parentIdCap =
          parent.id.charAt(0).toUpperCase() + parent.id.slice(1);
        if (!binding) map.set(c.id, parentIdCap);
        else {
          const bindingCap = binding.charAt(0).toUpperCase() + binding.slice(1);
          if (parent.id.toLowerCase() === binding.toLowerCase())
            map.set(c.id, parentIdCap);
          else map.set(c.id, `${parentIdCap} (${bindingCap})`);
        }
      }
    }
    return map;
  }, [document, section.controls]);

  return (
    <div
      className={cn(
        'rounded-[10px] border bg-card overflow-hidden',
        isSectionSelected && 'border-border',
      )}
    >
      <button
        type="button"
        className={cn(
          'flex w-full items-center justify-between gap-2 px-3 py-2 text-left cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
          'bg-[color-mix(in_oklch,var(--card)_84%,white_6%)] border-b border-border hover:bg-accent',
          isSectionSelected && 'bg-accent',
        )}
        onClick={() => onSelectSection?.(section.id)}
        onMouseEnter={() => onHoverSection?.(section.id)}
        onMouseLeave={() => onHoverSection?.(null)}
        onFocus={() => onHoverSection?.(section.id)}
        onBlur={() => onHoverSection?.(null)}
        aria-pressed={isSectionSelected}
        aria-label={`Select section ${section.id}`}
      >
        <span className="text-[13px] font-medium capitalize text-foreground">
          {section.id}
        </span>
        <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
          w {section.relativeWidth.toFixed(2)}
        </span>
      </button>

      <div className="relative">
        <ul
          ref={listRef}
          className="relative flex w-full min-w-0 flex-col gap-0 list-none m-0 p-0 bg-[color-mix(in_oklch,var(--card)_68%,var(--background)_32%)]"
          data-section={section.id}
        >
          {section.controls.length === 0 && (
            <li className="px-3 py-6 text-center text-xs text-muted-foreground">
              No controls
            </li>
          )}

          {dragState && dragState.overIndex === 0 && (
            <div
              className="editor-control-row__drop-indicator editor-control-row__drop-indicator--top"
              style={{ top: 0 }}
            />
          )}

          {displayControls.map((control, displayIndex) => {
            const actualIndex = section.controls.findIndex(
              (candidate) => candidate.id === control.id,
            );
            const isDragging = dragState?.draggedId === control.id;
            const showLineAfter =
              dragState !== null &&
              dragState.sectionId === section.id &&
              dragState.overIndex === displayIndex + 1;

            return (
              <ControlRow
                key={control.id}
                control={control}
                index={displayIndex}
                count={count}
                selected={control.id === selectedControlId}
                isPeer={selectedPeerIds.has(control.id)}
                isHovered={control.id === hoveredControlId}
                isHoveredPeer={hoveredPeerIds.has(control.id)}
                isDragging={isDragging}
                dragActive={dragState !== null}
                showLineAfter={showLineAfter}
                parentHint={parentHintMap.get(control.id) ?? null}
                onSelect={() => onSelectControl(control.id)}
                onMove={(direction) =>
                  onMoveControl(control.id, direction === 'up' ? 'down' : 'up')
                }
                onDuplicate={() => onDuplicateControl?.(control.id)}
                onDelete={() => onDeleteControl?.(control.id)}
                onHover={onHoverControl}
                onDragStart={(e) => {
                  (e.currentTarget as HTMLElement).setPointerCapture(
                    e.pointerId,
                  );
                  setDragState({
                    sectionId: section.id,
                    fromIndex: actualIndex,
                    draggedId: control.id,
                    overIndex: null,
                  });
                }}
              />
            );
          })}

          {dragState &&
            dragState.sectionId === section.id &&
            dragState.overIndex === count && (
              <div
                className="editor-control-row__drop-indicator editor-control-row__drop-indicator--bottom"
                style={{ bottom: 0 }}
              />
            )}
        </ul>
      </div>

      <div className="border-t border-border p-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full text-xs"
          onClick={() => onAddControl(section.id)}
        >
          + Add control
        </Button>
      </div>
    </div>
  );
});

const ControlRow = memo(function ControlRow({
  control,
  index,
  count,
  selected,
  isPeer,
  isHovered,
  isHoveredPeer,
  isDragging,
  dragActive,
  showLineAfter,
  parentHint,
  onSelect,
  onMove,
  onDuplicate,
  onDelete,
  onHover,
  onDragStart,
}: {
  control: Control;
  index: number;
  count: number;
  selected: boolean;
  isPeer: boolean;
  isHovered: boolean;
  isHoveredPeer: boolean;
  isDragging: boolean;
  dragActive: boolean;
  showLineAfter: boolean;
  parentHint: string | null;
  onSelect: () => void;
  onMove: (direction: 'up' | 'down') => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onHover?: (id: string | null) => void;
  onDragStart: (e: React.PointerEvent) => void;
}) {
  const isHitfill = control.type === 'hitfill';

  return (
    <li
      data-control-row
      data-index={index}
      className={cn(
        'group relative flex items-center gap-1 px-1 border-b border-[color-mix(in_oklch,var(--border)_60%,transparent)] bg-[color-mix(in_oklch,var(--card)_68%,var(--background)_32%)] last:border-b-0',
        isDragging && 'opacity-50',
      )}
      onMouseEnter={() => onHover?.(control.id)}
      onMouseLeave={() => onHover?.(null)}
      onFocus={() => onHover?.(control.id)}
      onBlur={() => onHover?.(null)}
    >
      {dragActive && showLineAfter && (
        <div className="editor-control-row__drop-indicator editor-control-row__drop-indicator--bottom" />
      )}

      <button
        type="button"
        className="flex items-center justify-center size-4 shrink-0 rounded text-muted-foreground opacity-0 group-hover:opacity-70 hover:opacity-100 hover:bg-muted cursor-grab active:cursor-grabbing touch-none transition-opacity duration-120"
        aria-label={`Drag to reorder ${control.label || control.id}`}
        onPointerDown={onDragStart}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp' && index > 0) {
            e.preventDefault();
            onMove('up');
          }
          if (e.key === 'ArrowDown' && index < count - 1) {
            e.preventDefault();
            onMove('down');
          }
        }}
      >
        <GripVertical className="size-3" />
      </button>

      <button
        type="button"
        onClick={onSelect}
        className={cn(
          'flex h-8 min-w-0 flex-1 items-center gap-1 overflow-hidden text-ellipsis whitespace-nowrap rounded-md px-2 text-left text-[13px] font-normal cursor-pointer transition-colors',
          selected
            ? 'bg-accent text-accent-foreground font-medium border border-border'
            : isPeer && !selected
              ? 'bg-[rgb(250_204_21/0.12)] text-foreground hover:bg-[rgb(250_204_21/0.18)]'
              : isHoveredPeer && !selected && !isPeer
                ? 'bg-[rgb(250_204_21/0.18)] text-foreground border border-[rgb(250_204_21/0.35)]'
                : isHovered && !selected && !isPeer && !isHoveredPeer
                  ? 'bg-accent text-accent-foreground'
                  : 'bg-transparent text-foreground hover:bg-accent hover:text-accent-foreground',
        )}
      >
        <span className="min-w-0 flex-1 flex items-center overflow-hidden text-left">
          {isHitfill ? (
            <>
              <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
                Hitfill
              </span>
              {parentHint && (
                <span className="ml-1 shrink-0 text-[11px] leading-none text-muted-foreground">
                  → {parentHint}
                </span>
              )}
            </>
          ) : (
            <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
              {control.label || control.id}
            </span>
          )}
        </span>
      </button>

      <div className="absolute right-1 top-1/2 -translate-y-1/2 hidden group-hover:flex group-focus-within:flex items-center gap-0.5 bg-transparent p-0">
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="size-6"
                onClick={(event) => {
                  event.stopPropagation();
                  onDuplicate();
                }}
                aria-label="Duplicate"
              >
                <Copy className="size-3" />
              </Button>
            }
          />
          <TooltipContent side="top">Duplicate</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="size-6 text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={(event) => {
                  event.stopPropagation();
                  onDelete();
                }}
                aria-label="Delete"
              >
                <Trash2 className="size-3" />
              </Button>
            }
          />
          <TooltipContent side="top">Delete</TooltipContent>
        </Tooltip>
      </div>
    </li>
  );
});
