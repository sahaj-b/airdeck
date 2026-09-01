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
import { useEditorStore } from '@/editor/store/editor-store';
import { slugifyId } from '@/shared/layout-editor';

export function ForkDialog({
  draftName,
  onConfirm,
}: {
  draftName: string;
  onConfirm: () => void;
}) {
  const open = useEditorStore((s) => s.forkOpen);
  const forkName = useEditorStore((s) => s.forkName);
  const forkBusy = useEditorStore((s) => s.forkBusy);
  const forkError = useEditorStore((s) => s.forkError);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => useEditorStore.getState().setForkOpen(o)}
    >
      <DialogContent>
        <DialogTitle>Duplicate built-in layout</DialogTitle>
        <DialogDescription>
          {draftName} is built-in and can&apos;t be edited. Make a copy to save
          your changes.
        </DialogDescription>
        {forkError && (
          <p className="rounded border border-destructive/20 bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
            {forkError}
          </p>
        )}
        <div className="space-y-2 py-2">
          <div>
            <Label htmlFor="fork-name">Name</Label>
            <Input
              id="fork-name"
              value={forkName}
              onChange={(event) =>
                useEditorStore.getState().setForkName(event.target.value)
              }
              onKeyDown={(event) => {
                if (event.key === 'Enter') void onConfirm();
              }}
            />
          </div>
          <p className="text-[11px] text-muted-foreground">
            ID: <span className="font-mono">{slugifyId(forkName)}</span>
          </p>
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
            disabled={!forkName.trim() || forkBusy}
            onClick={() => void onConfirm()}
          >
            Duplicate &amp; edit
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
