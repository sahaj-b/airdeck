import { ChevronDown, ChevronUp, PanelLeftClose } from 'lucide-react';
import { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuItem,
} from '@/components/ui/sidebar';
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
  onSelectControl: (id: string) => void;
  onAddControl: (sectionId: string) => void;
  onMoveControl: (controlId: string, direction: 'up' | 'down') => void;
  onCollapse?: () => void;
}

export function SectionsPanel({
  document,
  selectedControlId,
  onSelectControl,
  onAddControl,
  onMoveControl,
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
  return (
    <div className="editor-panel flex min-h-0 w-full flex-col gap-4 p-0 overflow-y-auto">
      <SidebarGroup className="p-2">
        <div className="flex items-center justify-between">
          <SidebarGroupLabel className="text-white/60">
            Sections
          </SidebarGroupLabel>
          {onCollapse && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8 shrink-0 text-white/60 hover:text-white"
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
        <SidebarGroupContent className="flex flex-col gap-3">
          {document.sections.map((section) => (
            <div
              key={section.id}
              className="rounded-lg border border-white/10 bg-white/[0.02]"
            >
              <div className="flex items-center justify-between rounded-t-lg bg-white/5 px-3 py-2">
                <span className="text-sm font-medium capitalize text-white/90">
                  {section.id}
                </span>
                <span className="rounded bg-black/30 px-1.5 py-0.5 font-mono text-[10px] text-white/50">
                  w {section.relativeWidth.toFixed(2)}
                </span>
              </div>
              <SidebarMenu className="gap-0 divide-y divide-white/5 px-0 py-0">
                {section.controls.length === 0 && (
                  <li className="px-3 py-2 text-xs text-white/30">
                    No controls
                  </li>
                )}
                {section.controls.map((control, index) => (
                  <ControlRow
                    key={control.id}
                    document={document}
                    control={control}
                    index={index}
                    count={section.controls.length}
                    selected={control.id === selectedControlId}
                    isPeer={selectedPeerIds.has(control.id)}
                    onSelect={() => onSelectControl(control.id)}
                    onMove={(direction) => onMoveControl(control.id, direction)}
                  />
                ))}
              </SidebarMenu>
              <div className="border-t border-white/10 p-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full border-white/10 bg-white/5 text-xs hover:bg-white/10"
                  onClick={() => onAddControl(section.id)}
                >
                  + Add control
                </Button>
              </div>
            </div>
          ))}
        </SidebarGroupContent>
      </SidebarGroup>
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
  onSelect,
  onMove,
}: {
  document: LayoutDocument;
  control: Control;
  index: number;
  count: number;
  selected: boolean;
  isPeer: boolean;
  onSelect: () => void;
  onMove: (direction: 'up' | 'down') => void;
}) {
  const isHitfill = control.type === 'hitfill';
  const parentHint = (() => {
    if (!isHitfill || !control.parentId) return null;
    const parent = document.sections
      .flatMap((s) => s.controls)
      .find((c) => c.id === control.parentId);
    const binding = parent?.binding ?? parent?.type ?? '';
    return `${control.parentId}${binding ? ` (${binding})` : ''}`;
  })();
  return (
    <SidebarMenuItem
      className={cn(
        'editor-control-row group relative flex items-center gap-1 px-1 py-0.5',
        isPeer && !selected && 'editor-sidebar-peer',
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          'flex h-7 min-w-0 flex-1 items-center gap-1 overflow-hidden truncate rounded-md px-2 text-left text-xs font-normal transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
          selected && 'bg-white/10 text-white hover:bg-white/15',
          isPeer &&
            !selected &&
            'bg-yellow-500/10 text-yellow-100 hover:bg-yellow-500/15 hover:text-yellow-50',
        )}
      >
        <span
          className={cn(
            'min-w-0 flex-1 truncate text-left',
            isHitfill && 'italic opacity-60',
          )}
        >
          {isHitfill ? (
            <>
              <span className="opacity-80">hitfill</span>
              {parentHint && (
                <span className="ml-1 text-[10px] opacity-50">
                  → {parentHint}
                </span>
              )}
            </>
          ) : (
            control.label || control.id
          )}
        </span>
      </button>
      <div className="absolute inset-y-0 right-1 flex items-center gap-1">
        <div className="hidden items-center gap-0 rounded-md bg-transparent px-0.5 py-0.5 group-hover:flex group-focus-within:flex">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="size-6"
                  disabled={index === 0}
                  onClick={(event) => {
                    event.stopPropagation();
                    onMove('up');
                  }}
                >
                  <ChevronUp className="size-3" />
                </Button>
              }
            />
            <TooltipContent side="top">Move up</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="size-6"
                  disabled={index === count - 1}
                  onClick={(event) => {
                    event.stopPropagation();
                    onMove('down');
                  }}
                >
                  <ChevronDown className="size-3" />
                </Button>
              }
            />
            <TooltipContent side="top">Move down</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </SidebarMenuItem>
  );
}
