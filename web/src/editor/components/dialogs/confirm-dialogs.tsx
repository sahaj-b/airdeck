import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { useEditorStore } from '@/editor/store/editor-store';

export function DiscardConfirmDialog({ onConfirm }: { onConfirm: () => void }) {
  const open = useEditorStore((s) => s.discardOpen);
  return (
    <AlertDialog
      open={open}
      onOpenChange={(o) => useEditorStore.getState().setDiscardOpen(o)}
    >
      <AlertDialogContent>
        <AlertDialogTitle>Discard changes?</AlertDialogTitle>
        <AlertDialogDescription>
          Discard unsaved changes? This cannot be undone.
        </AlertDialogDescription>
        <div className="flex justify-end gap-2 pt-2">
          <AlertDialogCancel
            render={
              <Button type="button" variant="outline">
                Cancel
              </Button>
            }
          />
          <Button type="button" variant="destructive" onClick={onConfirm}>
            Discard
          </Button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function BackConfirmDialog({ onConfirm }: { onConfirm: () => void }) {
  const open = useEditorStore((s) => s.backOpen);
  return (
    <AlertDialog
      open={open}
      onOpenChange={(o) => useEditorStore.getState().setBackOpen(o)}
    >
      <AlertDialogContent>
        <AlertDialogTitle>Leave editor?</AlertDialogTitle>
        <AlertDialogDescription>
          You have unsaved changes. Leave without saving?
        </AlertDialogDescription>
        <div className="flex justify-end gap-2 pt-2">
          <AlertDialogCancel
            render={
              <Button type="button" variant="outline">
                Stay
              </Button>
            }
          />
          <Button type="button" variant="destructive" onClick={onConfirm}>
            Leave
          </Button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
