import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type {
  Control,
  Document as LayoutDocument,
} from '@/shared/generated/layout';
import {
  findControl,
  getLinkedGroup,
  nextControlId,
} from '@/shared/layout-editor';

export interface SectionsPanelProps {
  document: LayoutDocument;
  selectedControlId: string | null;
  onSelectControl: (id: string) => void;
  onAddControl: (sectionId: string) => void;
  onDuplicateControl: (controlId: string) => void;
  onDeleteControl: (controlId: string) => void;
  onMoveControl: (controlId: string, direction: 'up' | 'down') => void;
}

export function SectionsPanel({
  document,
  selectedControlId,
  onSelectControl,
  onAddControl,
  onDuplicateControl,
  onDeleteControl,
  onMoveControl,
}: SectionsPanelProps) {
  return (
    <section className="editor-panel">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Sections
        </h2>
      </div>
      <div className="space-y-4">
        {document.sections.map((section) => (
          <div key={section.id} className="rounded-lg border border-white/10">
            <div className="flex items-center justify-between rounded-t-lg bg-white/5 px-3 py-2">
              <span className="text-sm font-medium text-white/80">
                {section.id}
              </span>
              <span className="font-mono text-[10px] text-white/40">
                w={section.relativeWidth.toFixed(2)}
              </span>
            </div>
            <ul className="divide-y divide-white/5">
              {section.controls.length === 0 && (
                <li className="px-3 py-2 text-xs text-white/30">No controls</li>
              )}
              {section.controls.map((control, index) => (
                <ControlRow
                  key={control.id}
                  control={control}
                  index={index}
                  count={section.controls.length}
                  selected={control.id === selectedControlId}
                  linked={
                    getLinkedGroup(document, control.id).length > 1 &&
                    Boolean(
                      control.binding &&
                        ['south', 'west', 'east', 'north'].includes(
                          control.binding,
                        ),
                    )
                  }
                  onSelect={() => onSelectControl(control.id)}
                  onDuplicate={() => onDuplicateControl(control.id)}
                  onDelete={() => onDeleteControl(control.id)}
                  onMove={(direction) => onMoveControl(control.id, direction)}
                />
              ))}
            </ul>
            <div className="border-t border-white/10 p-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-full"
                onClick={() => onAddControl(section.id)}
              >
                + Add control
              </Button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function ControlRow({
  control,
  index,
  count,
  selected,
  linked,
  onSelect,
  onDuplicate,
  onDelete,
  onMove,
}: {
  control: Control;
  index: number;
  count: number;
  selected: boolean;
  linked: boolean;
  onSelect: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onMove: (direction: 'up' | 'down') => void;
}) {
  return (
    <li
      className={cn(
        'group flex items-center gap-2 px-3 py-1.5',
        control.hitOnly && 'opacity-50',
        selected && 'bg-white/10',
      )}
    >
      <button
        type="button"
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left transition-colors hover:text-white"
        onClick={onSelect}
        title={control.id}
      >
        <span
          className={cn(
            'min-w-0 flex-1 truncate text-xs',
            control.hitOnly && 'italic',
          )}
        >
          {control.hitOnly ? '∅ ' : ''}
          {control.label || control.id}
          {linked && <span className="ml-1 text-white/40">⛓️</span>}
        </span>
      </button>
      <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        <RowButton
          label="↑"
          title="Move up"
          disabled={index === 0}
          onClick={(event) => {
            event.stopPropagation();
            onMove('up');
          }}
        />
        <RowButton
          label="↓"
          title="Move down"
          disabled={index === count - 1}
          onClick={(event) => {
            event.stopPropagation();
            onMove('down');
          }}
        />
        <RowButton
          label="⧉"
          title="Duplicate"
          onClick={(event) => {
            event.stopPropagation();
            onDuplicate();
          }}
        />
        <RowButton
          label="🗑"
          title="Delete"
          onClick={(event) => {
            event.stopPropagation();
            onDelete();
          }}
        />
      </span>
    </li>
  );
}

function RowButton({
  label,
  title,
  disabled,
  onClick,
}: {
  label: string;
  title: string;
  disabled?: boolean;
  onClick: (event: React.MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      className="rounded px-1 py-0.5 text-xs text-white/50 hover:bg-white/10 hover:text-white disabled:pointer-events-none disabled:opacity-30"
      onClick={onClick}
    >
      {label}
    </button>
  );
}

export function duplicateControl(
  document: LayoutDocument,
  controlId: string,
): LayoutDocument {
  const found = findControl(document, controlId);
  if (!found) return document;
  const { control, section } = found;
  const next = structuredClone(document);
  const targetSection = next.sections.find((s) => s.id === section.id);
  if (!targetSection) return document;
  const sourceIndex = targetSection.controls.findIndex(
    (candidate) => candidate.id === controlId,
  );
  if (sourceIndex < 0) return document;
  const copy = structuredClone(control);
  copy.id = nextControlId(next);
  copy.geometry = {
    position: {
      x: control.geometry.position.x + 0.05,
      y: control.geometry.position.y + 0.05,
    },
    size: { ...control.geometry.size },
  };
  targetSection.controls.splice(sourceIndex + 1, 0, copy);
  return next;
}
