import { Copy, GripVertical, PanelLeftClose, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { findControl, getHitfillsOf } from '@/shared/layout-editor';

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
    <div className="editor-panel flex min-h-0 w-full flex-col gap-4 p-0 overflow-y-auto">
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

function SectionCard({
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
  const listRef = useRef<HTMLUListElement>(null);

  const handlePointerMove = useCallback(
    (event: PointerEvent) => {
      if (!dragState || !listRef.current) return;
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
        // Clamp to valid insertion range 0..count
        const count = rows.length;
        overIndex = Math.max(0, Math.min(overIndex, count));
        // Adjust for dragged item still in list visually
        // If dragging forward, insertion index in terms of final array after removal
        // For visual line, we can keep raw insertion index and adjust on drop
        setDragState((prev) => (prev ? { ...prev, overIndex } : prev));
      }
    },
    [dragState],
  );

  const handlePointerUp = useCallback(() => {
    if (!dragState || dragState.overIndex === null) {
      setDragState(null);
      return;
    }
    let toIndex = dragState.overIndex;
    // Convert visual insertion index to final reorder index
    // If inserting after dragged item's original position, shift by -1
    if (toIndex > dragState.fromIndex) toIndex -= 1;
    if (toIndex !== dragState.fromIndex && onReorderControl) {
      onReorderControl(section.id, dragState.fromIndex, toIndex);
    }
    setDragState(null);
  }, [dragState, onReorderControl, section.id]);

  useEffect(() => {
    if (!dragState) return;
    const onMove = (e: PointerEvent) => handlePointerMove(e);
    const onUp = () => handlePointerUp();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDragState(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKey);
    };
  }, [dragState, handlePointerMove, handlePointerUp]);

  const count = section.controls.length;
  const isSectionSelected =
    selectedSectionId === section.id && !selectedControlId;

  return (
    <div
      className={cn(
        'editor-section-card',
        isSectionSelected && 'editor-section-card--selected',
      )}
    >
      <button
        type="button"
        className="editor-section-card__header w-full text-left cursor-pointer hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
        onClick={() => onSelectSection?.(section.id)}
        onMouseEnter={() => onHoverSection?.(section.id)}
        onMouseLeave={() => onHoverSection?.(null)}
        onFocus={() => onHoverSection?.(section.id)}
        onBlur={() => onHoverSection?.(null)}
        aria-pressed={isSectionSelected}
        aria-label={`Select section ${section.id}`}
      >
        <span className="editor-section-card__title">{section.id}</span>
        <span className="editor-section-card__meta">
          w {section.relativeWidth.toFixed(2)}
        </span>
      </button>

      <div className="relative">
        <ul
          ref={listRef}
          className="editor-control-list"
          data-section={section.id}
        >
          {section.controls.length === 0 && (
            <li className="px-3 py-6 text-center text-xs text-muted-foreground">
              No controls
            </li>
          )}

          {/* drop indicator at top if needed */}
          {dragState && dragState.overIndex === 0 && (
            <div
              className="editor-control-row__drop-indicator editor-control-row__drop-indicator--top"
              style={{ top: 0 }}
            />
          )}

          {section.controls.map((control, index) => {
            const isDragging = dragState?.draggedId === control.id;
            const showLineAfter =
              dragState !== null &&
              dragState.sectionId === section.id &&
              dragState.overIndex === index + 1;

            return (
              <ControlRow
                key={control.id}
                document={document}
                control={control}
                index={index}
                count={count}
                selected={control.id === selectedControlId}
                isPeer={selectedPeerIds.has(control.id)}
                isHovered={control.id === hoveredControlId}
                isHoveredPeer={hoveredPeerIds.has(control.id)}
                isDragging={isDragging}
                dragActive={dragState !== null}
                showLineAfter={showLineAfter}
                onSelect={() => onSelectControl(control.id)}
                onMove={(direction) => onMoveControl(control.id, direction)}
                onDuplicate={() => onDuplicateControl?.(control.id)}
                onDelete={() => onDeleteControl?.(control.id)}
                onHover={onHoverControl}
                onDragStart={(e) => {
                  (e.currentTarget as HTMLElement).setPointerCapture(
                    e.pointerId,
                  );
                  setDragState({
                    sectionId: section.id,
                    fromIndex: index,
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
}

function ControlRow({
  document,
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
  onSelect,
  onMove,
  onDuplicate,
  onDelete,
  onHover,
  onDragStart,
}: {
  document: LayoutDocument;
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
  onSelect: () => void;
  onMove: (direction: 'up' | 'down') => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onHover?: (id: string | null) => void;
  onDragStart: (e: React.PointerEvent) => void;
}) {
  const isHitfill = control.type === 'hitfill';
  const parentHint = (() => {
    if (!isHitfill || !control.parentId) return null;
    const parent = document.sections
      .flatMap((s) => s.controls)
      .find((c) => c.id === control.parentId);
    if (!parent) return control.parentId;
    const binding = parent.binding;
    const parentIdCap = parent.id.charAt(0).toUpperCase() + parent.id.slice(1);
    if (!binding) return parentIdCap;
    const bindingCap = binding.charAt(0).toUpperCase() + binding.slice(1);
    if (parent.id.toLowerCase() === binding.toLowerCase()) return parentIdCap;
    return `${parentIdCap} (${bindingCap})`;
  })();

  return (
    <li
      data-control-row
      data-index={index}
      className={cn(
        'editor-control-row group',
        selected && 'editor-control-row--selected',
        isPeer && !selected && 'editor-control-row--peer',
        isHoveredPeer &&
          !selected &&
          !isPeer &&
          'editor-control-row--hover-peer',
        isHovered &&
          !selected &&
          !isPeer &&
          !isHoveredPeer &&
          'editor-control-row--hovered',
        isDragging && 'editor-control-row--dragging',
        isHitfill && 'editor-control-row--hitfill',
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
        className="editor-control-row__drag-handle"
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
        className="editor-control-row__button"
      >
        <span
          className={cn(
            'editor-control-row__label',
            isHitfill && 'editor-control-row__label--hitfill',
          )}
        >
          {isHitfill ? (
            <>
              <span>Hitfill</span>
              {parentHint && (
                <span className="ml-1 text-[11px] text-muted-foreground">
                  → {parentHint}
                </span>
              )}
            </>
          ) : (
            control.label || control.id
          )}
        </span>
      </button>

      <div className="editor-control-row__actions">
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
}
