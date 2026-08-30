import { useState } from 'react';
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
import type { AdminLayoutSummary } from '@/shared/contracts';

export interface LayoutHeaderProps {
  layouts: AdminLayoutSummary[];
  currentId: string;
  currentName: string;
  isBuiltin: boolean;
  isDefault: boolean;
  dirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  hasErrors: boolean;
  onSelectLayout: (id: string) => void;
  onNewLayout: () => void;
  onRename: (name: string) => Promise<void>;
  onDelete: () => Promise<void>;
  onReload: () => Promise<void>;
  onUndo: () => void;
  onRedo: () => void;
  onDiscard: () => void;
  onSave: () => Promise<void>;
  onBack: () => void;
}

export function LayoutHeader(props: LayoutHeaderProps) {
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState(props.currentName);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const persistenceDisabled = props.isBuiltin;
  const persistenceNote = props.isBuiltin
    ? 'Built-in layouts are read-only. Use New layout to clone one.'
    : props.isDefault
      ? 'This is the default layout. You can edit it, but not delete it.'
      : null;

  const handleRename = async (): Promise<void> => {
    const name = renameValue.trim();
    if (!name || name === props.currentName) {
      setRenameOpen(false);
      return;
    }
    setBusy(true);
    try {
      await props.onRename(name);
      setRenameOpen(false);
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (): Promise<void> => {
    setBusy(true);
    try {
      await props.onDelete();
      setDeleteOpen(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <header className="flex flex-wrap items-center gap-3 border-b border-white/10 pb-3">
      <button
        type="button"
        className="text-sm text-white/70 transition-colors hover:text-white"
        onClick={props.onBack}
      >
        ← Dashboard
      </button>

      <div className="ml-2 flex min-w-0 items-center gap-2">
        <Select
          value={props.currentId}
          onValueChange={(value) => {
            if (value) props.onSelectLayout(value);
          }}
        >
          {' '}
          <SelectTrigger className="w-[220px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {props.layouts.map((layout) => (
              <SelectItem key={layout.id} value={layout.id}>
                {layout.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {props.isBuiltin && (
          <span className="rounded bg-white/10 px-2 py-1 text-[10px] tracking-wide text-white/50 uppercase">
            Built-in
          </span>
        )}
      </div>

      <div className="ml-auto flex items-center gap-2">
        {props.dirty && (
          <span className="text-xs text-amber-400" title="Unsaved changes">
            ● Unsaved changes
          </span>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={props.onNewLayout}
        >
          New
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={persistenceDisabled}
          onClick={() => {
            setRenameValue(props.currentName);
            setRenameOpen(true);
          }}
          title={
            persistenceDisabled
              ? 'Built-in layouts cannot be renamed'
              : 'Rename this layout'
          }
        >
          Rename
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={persistenceDisabled || props.isDefault}
          onClick={() => setDeleteOpen(true)}
          title={persistenceNote ?? 'Delete this layout'}
        >
          Delete
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void props.onReload()}
          title="Rescan the layouts folder"
        >
          Reload
        </Button>

        <div className="mx-1 h-5 w-px bg-white/10" />

        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!props.canUndo}
          onClick={props.onUndo}
          title="Undo (Ctrl+Z)"
        >
          Undo
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!props.canRedo}
          onClick={props.onRedo}
          title="Redo (Ctrl+Shift+Z)"
        >
          Redo
        </Button>

        <div className="mx-1 h-5 w-px bg-white/10" />

        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!props.dirty}
          onClick={props.onDiscard}
          title="Discard unsaved changes"
        >
          Discard
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={!props.dirty || props.hasErrors || persistenceDisabled}
          onClick={() => void props.onSave()}
          title={
            props.hasErrors
              ? 'Fix validation errors before saving'
              : persistenceDisabled
                ? 'Built-in layouts are read-only'
                : 'Save this layout'
          }
        >
          Save
        </Button>
      </div>

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent>
          <DialogTitle>Rename layout</DialogTitle>
          <DialogDescription>
            The id stays the same; only the display name changes.
          </DialogDescription>
          <div className="grid gap-1.5 py-2">
            <Label htmlFor="rename-input">Name</Label>
            <Input
              id="rename-input"
              value={renameValue}
              onChange={(event) => setRenameValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void handleRename();
              }}
            />
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
              disabled={busy || !renameValue.trim()}
              onClick={() => void handleRename()}
            >
              Rename
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogTitle>Delete layout?</AlertDialogTitle>
          <AlertDialogDescription>
            Delete &quot;{props.currentName}&quot;? Players using it will fall
            back to the default layout. This cannot be undone.
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
              disabled={busy}
              onClick={() => void handleDelete()}
            >
              Delete
            </Button>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </header>
  );
}
