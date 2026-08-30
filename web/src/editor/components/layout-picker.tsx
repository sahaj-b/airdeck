import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
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

  return (
    <Dialog open onOpenChange={() => onCancel()}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogTitle>Edit layout</DialogTitle>
        <DialogDescription>
          Pick a layout to edit. Built-in layouts are read-only.
        </DialogDescription>
        <div className="max-h-[50vh] space-y-1.5 overflow-y-auto py-2">
          {layouts.map((layout) => (
            <button
              key={layout.id}
              type="button"
              onClick={() => setSelectedId(layout.id)}
              className={cn(
                'flex w-full items-center justify-between gap-3 rounded-md border px-3 py-2 text-left text-sm transition-colors cursor-pointer outline-none focus:outline-none focus-visible:outline-none',
                selectedId === layout.id
                  ? 'border-primary bg-accent text-accent-foreground'
                  : 'border-border hover:bg-accent',
              )}
              aria-pressed={selectedId === layout.id}
            >
              <span className="min-w-0 flex-1 truncate">{layout.name}</span>
              {layout.builtin && (
                <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Built-in
                </span>
              )}
            </button>
          ))}
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
