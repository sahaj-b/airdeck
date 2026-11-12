import { Copy, Plus } from 'lucide-react';
import { useMemo } from 'react';
import { LayoutMiniPreview } from '@/components/layout-mini-preview';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useLayoutDocs } from '@/components/use-layout-docs';
import { useEditorStore } from '@/editor/store/editor-store';
import { cn } from '@/lib/utils';
import { slugifyId } from '@/shared/layout-editor';

export function NewLayoutDialog({
  onCreate,
}: {
  onCreate: (name: string, baseId: string | null) => void;
}) {
  const open = useEditorStore((s) => s.newLayoutDialogOpen);
  const name = useEditorStore((s) => s.newLayoutName);
  const base = useEditorStore((s) => s.newLayoutBase);
  const busy = useEditorStore((s) => s.newLayoutBusy);
  const error = useEditorStore((s) => s.newLayoutError);
  const layouts = useEditorStore((s) => s.layouts);

  const baseLayout = layouts.find((layout) => layout.id === base);
  const duplicate = base !== 'blank';
  const baseIds = useMemo(() => (duplicate ? [base] : []), [base, duplicate]);
  const baseDocs = useLayoutDocs(baseIds);
  const baseDoc = baseDocs.get(base);

  const newId = slugifyId(name);
  const idTaken =
    !!name.trim() && layouts.some((layout) => layout.id === newId);
  const canCreate = !!name.trim() && !busy && !idTaken;

  const submit = (): void => {
    if (!canCreate) return;
    onCreate(name, duplicate ? base : null);
  };

  const handleOpenChange = (next: boolean): void => {
    const store = useEditorStore.getState();
    store.setNewLayoutDialogOpen(next);
    if (next) return;
    store.setNewLayoutError(null);
    if (store.newLayoutReturnToPicker) {
      store.setNewLayoutReturnToPicker(false);
      store.setPickerOpen(true);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogTitle>
          {duplicate ? 'Duplicate layout' : 'New layout'}
        </DialogTitle>
        <DialogDescription>
          {duplicate
            ? `Make an editable copy of "${baseLayout?.name ?? base}".`
            : 'Start with a blank canvas, or duplicate an existing layout.'}
        </DialogDescription>
        {error && (
          <p className="mt-2 rounded border border-destructive/20 bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
            {error}
          </p>
        )}
        <div className="space-y-3 py-3">
          <div className="space-y-1.5">
            <Label htmlFor="new-layout-name">Name</Label>
            <Input
              id="new-layout-name"
              value={name}
              onChange={(event) =>
                useEditorStore.getState().setNewLayoutName(event.target.value)
              }
              onKeyDown={(event) => {
                if (event.key === 'Enter') submit();
              }}
              placeholder="My layout"
            />
            {name.trim() && (
              <p
                className={cn(
                  'text-[11px]',
                  idTaken ? 'text-destructive' : 'text-muted-foreground',
                )}
              >
                ID: <span className="font-mono">{newId || '—'}</span>
                {idTaken && ' · already in use'}
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-layout-base">Start from</Label>
            <Select
              value={base}
              onValueChange={(value) => {
                if (value) useEditorStore.getState().setNewLayoutBase(value);
              }}
            >
              <SelectTrigger id="new-layout-base" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="blank">Blank layout</SelectItem>
                {layouts.map((layout) => (
                  <SelectItem key={layout.id} value={layout.id}>
                    {layout.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {duplicate && baseDoc && (
            <div className="space-y-1.5">
              <span className="text-[11px] text-muted-foreground">Preview</span>
              <LayoutMiniPreview doc={baseDoc} />
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <DialogClose
            render={
              <Button type="button" variant="outline">
                Cancel
              </Button>
            }
          />
          <Button
            type="button"
            disabled={!canCreate}
            className="gap-1.5"
            onClick={submit}
          >
            {duplicate ? (
              <Copy className="size-3.5" />
            ) : (
              <Plus className="size-3.5" />
            )}
            {busy
              ? duplicate
                ? 'Duplicating…'
                : 'Creating…'
              : duplicate
                ? 'Duplicate & edit'
                : 'Create layout'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
