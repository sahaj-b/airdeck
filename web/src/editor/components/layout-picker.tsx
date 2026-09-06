import { useMemo, useState } from 'react';
import {
  LayoutMiniPreview,
  LayoutMiniSkeleton,
} from '@/components/layout-mini-preview';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { useLayoutDocs } from '@/components/use-layout-docs';
import { cn } from '@/lib/utils';
import type { AdminLayoutSummary } from '@/shared/contracts';

export interface LayoutPickerProps {
  layouts: AdminLayoutSummary[];
  defaultId: string;
  onOpen: (id: string) => void;
  onCancel: () => void;
}

export function LayoutPicker({
  layouts,
  defaultId,
  onOpen,
  onCancel,
}: LayoutPickerProps) {
  const [selectedId, setSelectedId] = useState(defaultId);
  const selected = layouts.find((l) => l.id === selectedId);
  const layoutIds = useMemo(() => layouts.map((l) => l.id), [layouts]);
  const layoutDocs = useLayoutDocs(layoutIds);

  return (
    <Dialog open onOpenChange={() => onCancel()}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogTitle>Edit layout</DialogTitle>
        <DialogDescription>
          Pick a layout to edit. Built-in layouts are read-only.
        </DialogDescription>
        <div className="grid max-h-[50vh] grid-cols-1 gap-2 overflow-y-auto py-2 sm:grid-cols-2">
          {layouts.map((layout) => {
            const doc = layoutDocs.get(layout.id);
            const isSelected = layout.id === selectedId;
            return (
              <button
                key={layout.id}
                type="button"
                onClick={() => setSelectedId(layout.id)}
                className={cn(
                  'relative min-w-0 cursor-pointer overflow-hidden rounded-lg border p-2 text-left transition-colors outline-none focus:outline-none focus-visible:outline-none',
                  isSelected
                    ? 'border-primary bg-accent text-accent-foreground ring-1 ring-primary/40'
                    : 'border-border hover:bg-accent',
                )}
                aria-pressed={isSelected}
              >
                {doc ? <LayoutMiniPreview doc={doc} /> : <LayoutMiniSkeleton />}
                <span className="flex items-center gap-1.5 px-0.5 pt-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {layout.name}
                  </span>
                  {layout.id === defaultId && (
                    <span className="shrink-0 rounded bg-primary px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-primary-foreground uppercase">
                      Default
                    </span>
                  )}
                  {layout.builtin && (
                    <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
                      Built-in
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
        {selected?.builtin && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-700 dark:text-amber-300">
            Built-in layout · Read-only. Duplicate to edit.
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <DialogClose
            render={
              <Button type="button" variant="outline">
                Cancel
              </Button>
            }
          />
          <Button
            type="button"
            disabled={!selectedId}
            onClick={() => onOpen(selectedId)}
          >
            Open layout
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
