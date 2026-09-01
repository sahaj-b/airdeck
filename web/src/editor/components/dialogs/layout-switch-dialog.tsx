import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { useEditorStore } from '@/editor/store/editor-store';

export function LayoutSwitchConfirmDialog({
  onConfirm,
  onCancel,
}: {
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const open = useEditorStore((s) => s.layoutSwitchOpen);
  return (
    <AlertDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onCancel();
      }}
    >
      <AlertDialogContent>
        <AlertDialogTitle>Switch layout?</AlertDialogTitle>
        <AlertDialogDescription>
          You have unsaved changes. Switching layouts will discard them.
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
            Switch
          </Button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
