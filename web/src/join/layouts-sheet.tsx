import {
  ChevronLeftIcon,
  Circle,
  CircleCheck,
  Pencil,
  SquarePen,
  Trash2,
  Upload,
} from 'lucide-react';
import { useState } from 'react';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { MountOptions } from './settings-island';

interface LayoutsSheetProps {
  opts: MountOptions;
  onBack: () => void;
}

const rowClass = (selected: boolean) =>
  `flex items-center gap-1 rounded-lg border px-2 py-1.5 ${
    selected
      ? 'border-primary/40 bg-primary/10'
      : 'border-white/10 bg-white/[0.04]'
  }`;

export function LayoutsSheet({ opts, onBack }: LayoutsSheetProps) {
  const personalLayouts = opts.personalLayouts ?? [];
  const hostLayouts = opts.layouts;
  const selectedId = opts.selectedLayout;
  const publishState = opts.publishState ?? null;
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const deleteTarget = personalLayouts.find((pl) => pl.id === deleteId) ?? null;

  const selectBtn = (id: string, name: string) => {
    const isSelected = id === selectedId;
    return (
      <button
        type="button"
        onClick={() => opts.onSelectLayout(id)}
        aria-pressed={isSelected}
        className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
      >
        {isSelected ? (
          <CircleCheck className="size-3.5 shrink-0 text-primary" />
        ) : (
          <Circle className="size-3.5 shrink-0 text-muted-foreground/40" />
        )}
        <span className="min-w-0 flex-1 truncate text-sm font-medium leading-tight">
          {name}
        </span>
      </button>
    );
  };

  const hostRow = (id: string, name: string) => (
    <div key={id} className={rowClass(id === selectedId)}>
      {selectBtn(id, name)}
      <Button
        variant="ghost"
        size="sm"
        className="h-6 shrink-0 gap-1 px-1.5 text-xs"
        onClick={(e) => {
          e.stopPropagation();
          opts.onEditPersonal?.(id);
        }}
      >
        <Pencil className="size-3 shrink-0" />
        Edit
      </Button>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onBack}
          aria-label="Back to settings"
        >
          <ChevronLeftIcon className="size-4" />
        </Button>
        <h3 className="text-sm font-semibold">Layout</h3>
        <span className="text-xs text-muted-foreground tabular-nums">
          {personalLayouts.length + hostLayouts.length}
        </span>
      </div>

      {publishState && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs">
          <p className="font-medium">
            Publishing &apos;{publishState.name}&apos;. Waiting for host
            approval... {publishState.remaining}s
          </p>
          <div className="mt-2 flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => opts.onCancelPublish?.()}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {personalLayouts.length > 0 && (
        <section className="space-y-1.5">
          <h4 className="px-1 text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
            My edits
          </h4>
          {personalLayouts.map((pl) => {
            const isRenaming = renameId === pl.id;
            return (
              <div key={pl.id} className={rowClass(pl.id === selectedId)}>
                {isRenaming ? (
                  <div className="flex min-w-0 flex-1 items-center gap-1">
                    <Input
                      className="h-7 flex-1 text-xs"
                      autoFocus
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          opts.onRenamePersonal?.(pl.id, renameValue);
                          setRenameId(null);
                        }
                        if (e.key === 'Escape') setRenameId(null);
                      }}
                      placeholder="Layout name"
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 shrink-0 px-2 text-xs"
                      onClick={() => {
                        opts.onRenamePersonal?.(pl.id, renameValue);
                        setRenameId(null);
                      }}
                    >
                      Ok
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 shrink-0 px-2 text-xs"
                      onClick={() => setRenameId(null)}
                    >
                      ✕
                    </Button>
                  </div>
                ) : (
                  <>
                    {selectBtn(pl.id, pl.name)}
                    <div className="flex shrink-0 items-center">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 gap-1 px-1.5 text-xs"
                        onClick={() => opts.onEditPersonal?.(pl.id)}
                      >
                        <Pencil className="size-3 shrink-0" />
                        Edit
                      </Button>
                      <span className="h-3 w-px shrink-0 bg-white/40" />
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 gap-1 px-1.5 text-xs"
                        onClick={() => {
                          setRenameId(pl.id);
                          setRenameValue(pl.name);
                        }}
                      >
                        <SquarePen className="size-3 shrink-0" />
                        Rename
                      </Button>
                      <span className="h-3 w-px shrink-0 bg-white/40" />
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 gap-1 px-1.5 text-xs"
                        onClick={() => opts.onPublishPersonal?.(pl.id)}
                        disabled={!!publishState}
                      >
                        <Upload className="size-3 shrink-0" />
                        Publish
                      </Button>
                      <span className="h-3 w-px shrink-0 bg-white/40" />
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="size-6 shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
                        aria-label={`Delete ${pl.name}`}
                        onClick={() => setDeleteId(pl.id)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </section>
      )}

      <section className="space-y-1.5">
        <h4 className="px-1 text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
          Host layouts
        </h4>
        {hostLayouts.length === 0 ? (
          <p className="rounded-lg border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
            No host layouts available.
          </p>
        ) : (
          hostLayouts.map((l) => hostRow(l.id, l.name))
        )}
      </section>

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(o) => {
          if (!o) setDeleteId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogTitle>Delete layout?</AlertDialogTitle>
          <AlertDialogDescription>
            Delete &quot;{deleteTarget?.name}&quot;? This cannot be undone.
          </AlertDialogDescription>
          <div className="flex justify-end gap-2 pt-2">
            <AlertDialogCancel
              render={
                <Button type="button" variant="outline">
                  Cancel
                </Button>
              }
            />
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                if (deleteTarget) opts.onDeletePersonal?.(deleteTarget.id);
                setDeleteId(null);
              }}
            >
              Delete
            </Button>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
