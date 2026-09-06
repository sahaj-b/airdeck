import {
  ChevronLeftIcon,
  Pencil,
  SquarePen,
  Trash2,
  Upload,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  LayoutMiniPreview,
  LayoutMiniSkeleton,
} from '@/components/layout-mini-preview';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import type { LayoutDocument } from '../shared/layout';
import { loadPersonalLayouts } from './personal-layouts';
import type { MountOptions } from './settings-island';
import { useHostLayoutDocs } from './use-host-layout-docs';

interface LayoutsSheetProps {
  opts: MountOptions;
  onBack: () => void;
}

const cardClass = (selected: boolean) =>
  `min-w-0 overflow-hidden rounded-lg border ${
    selected
      ? 'border-primary/40 bg-primary/10'
      : 'border-white/10 bg-white/[0.04]'
  }`;

const textBtn =
  'h-6 shrink-0 gap-1 px-1.5 text-xs hover:bg-transparent active:bg-accent/60 dark:hover:bg-transparent';

function LayoutPreviewButton({
  name,
  selected,
  doc,
  onSelect,
}: {
  name: string;
  selected: boolean;
  doc: LayoutDocument | undefined;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={`Use ${name}`}
      className="block w-full rounded-md p-1.5 pb-0 text-left active:bg-accent/40"
    >
      {doc ? <LayoutMiniPreview doc={doc} /> : <LayoutMiniSkeleton />}
    </button>
  );
}

function LayoutName({ name }: { name: string }) {
  return (
    <span className="min-w-0 flex-1 truncate text-left text-xs font-medium leading-tight">
      {name}
    </span>
  );
}

function EditLayoutButton({ onEdit }: { onEdit: () => void }) {
  return (
    <Button variant="ghost" size="sm" className={textBtn} onClick={onEdit}>
      <Pencil className="size-3 shrink-0" />
      Edit
    </Button>
  );
}

function HostLayoutCard({
  id,
  name,
  doc,
  selected,
  onSelect,
  onEdit,
}: {
  id: string;
  name: string;
  doc: LayoutDocument | undefined;
  selected: boolean;
  onSelect: (id: string) => void;
  onEdit: ((id: string) => void) | undefined;
}) {
  return (
    <div className={cardClass(selected)}>
      <LayoutPreviewButton
        name={name}
        selected={selected}
        doc={doc}
        onSelect={() => onSelect(id)}
      />
      <div className="flex items-center gap-1 p-1.5">
        <LayoutName name={name} />
        <EditLayoutButton onEdit={() => onEdit?.(id)} />
      </div>
    </div>
  );
}

export function LayoutsSheet({ opts, onBack }: LayoutsSheetProps) {
  const personalLayouts = opts.personalLayouts ?? [];
  const hostLayouts = opts.layouts;
  const selectedId = opts.selectedLayout;
  const publishState = opts.publishState ?? null;
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const deleteTarget = personalLayouts.find((pl) => pl.id === deleteId) ?? null;
  const renameTarget = personalLayouts.find((pl) => pl.id === renameId) ?? null;
  const confirmRename = () => {
    if (renameTarget) opts.onRenamePersonal?.(renameTarget.id, renameValue);
    setRenameId(null);
  };

  const personalKey = personalLayouts.map((p) => p.id).join('\0');
  // biome-ignore lint/correctness/useExhaustiveDependencies: key is the dep
  const personalDocs = useMemo(() => loadPersonalLayouts(), [personalKey]);
  const hostIds = useMemo(() => hostLayouts.map((l) => l.id), [hostLayouts]);
  const hostDocs = useHostLayoutDocs(hostIds);

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
        <Button
          size="sm"
          className="ml-auto h-7 gap-1 px-2 text-xs"
          onClick={() => {
            if (selectedId) opts.onEditPersonal?.(selectedId);
          }}
          disabled={!selectedId}
        >
          <Pencil className="size-3 shrink-0" />
          Edit current layout
        </Button>
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
          <div className="grid grid-cols-2 gap-2">
            {personalLayouts.map((pl) => {
              const isSelected = pl.id === selectedId;
              const doc = personalDocs[pl.id];
              return (
                <div key={pl.id} className={cardClass(isSelected)}>
                  <LayoutPreviewButton
                    name={pl.name}
                    selected={isSelected}
                    doc={doc}
                    onSelect={() => opts.onSelectLayout(pl.id)}
                  />
                  <div className="flex items-center gap-1 p-1.5 pb-0.5">
                    <LayoutName name={pl.name} />
                    <EditLayoutButton
                      onEdit={() => opts.onEditPersonal?.(pl.id)}
                    />
                  </div>
                  <div className="flex items-center gap-0.5 border-t px-1 pb-0.5">
                    <Button
                      variant="ghost"
                      size="sm"
                      className={textBtn}
                      onClick={() => {
                        setRenameId(pl.id);
                        setRenameValue(pl.name);
                      }}
                    >
                      <SquarePen className="size-3 shrink-0" />
                      Rename
                    </Button>
                    <span className="h-3 w-px shrink-0 bg-white/20" />
                    <Button
                      variant="ghost"
                      size="sm"
                      className={textBtn}
                      onClick={() => opts.onPublishPersonal?.(pl.id)}
                      disabled={!!publishState}
                    >
                      <Upload className="size-3 shrink-0" />
                      Publish
                    </Button>
                    <span className="h-3 w-px shrink-0 bg-white/20" />
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="ml-0.5 mb-0.5 size-6 shrink-0 text-destructive hover:bg-transparent hover:text-destructive active:bg-destructive/20 dark:hover:bg-transparent"
                      aria-label={`Delete ${pl.name}`}
                      title="Delete"
                      onClick={() => setDeleteId(pl.id)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
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
          <div className="grid grid-cols-2 gap-2">
            {hostLayouts.map((l) => (
              <HostLayoutCard
                key={l.id}
                id={l.id}
                name={l.name}
                doc={hostDocs.get(l.id)}
                selected={l.id === selectedId}
                onSelect={opts.onSelectLayout}
                onEdit={opts.onEditPersonal}
              />
            ))}
          </div>
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

      <Dialog
        open={renameTarget !== null}
        onOpenChange={(o) => {
          if (!o) setRenameId(null);
        }}
      >
        <DialogContent className="top-0 translate-y-0 rounded-t-none border-t-0 p-4">
          <DialogTitle>Rename layout</DialogTitle>
          <Input
            autoFocus
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') confirmRename();
            }}
            placeholder="Layout name"
          />
          <div className="flex justify-end gap-2 pt-2">
            <DialogClose
              render={
                <Button type="button" variant="outline">
                  Cancel
                </Button>
              }
            />
            <Button type="button" onClick={confirmRename}>
              Rename
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
