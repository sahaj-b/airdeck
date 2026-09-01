import {
  ArrowLeft,
  Copy,
  Pencil,
  Plus,
  Redo2,
  RotateCcw,
  Save,
  Trash2,
  Undo2,
  Users,
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
} from '@/components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
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
  onUndo: () => void;
  onRedo: () => void;
  onDiscard: () => void;
  onSave: () => Promise<void>;
  onBack: () => void;
  onDuplicate: () => void;
  onApplyToAll?: () => void;
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
    <header className="editor-header flex flex-wrap items-center gap-2 border-b border-border pb-3">
      {/* Group 1: Back | Layout Select */}
      <div className="editor-header__group">
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                className="inline-flex size-8 items-center justify-center rounded-md border border-border bg-card text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground hover:cursor-pointer"
                onClick={props.onBack}
                aria-label="Back to dashboard"
              >
                <ArrowLeft className="size-4" />
              </button>
            }
          />
          <TooltipContent side="bottom">Back to dashboard</TooltipContent>
        </Tooltip>

        <div className="editor-header__divider" />

        <Select
          value={props.currentId}
          onValueChange={(value) => {
            if (value) props.onSelectLayout(value);
          }}
        >
          <SelectTrigger className="w-[200px] bg-card">
            <span className="flex-1 truncate text-left text-sm">
              {props.layouts.find((layout) => layout.id === props.currentId)
                ?.name ?? props.currentId}
            </span>
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
          <span className="rounded-md border border-border bg-muted px-2 py-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
            Built-in
          </span>
        )}
      </div>

      {/* Group 2: New Rename Delete */}
      <div className="editor-header__group">
        <div className="editor-header__divider hidden sm:block" />
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="header-btn-compact gap-1.5 bg-card"
                onClick={props.onNewLayout}
              >
                <Plus className="size-3.5" />
                <span className="header-btn-text">New</span>
              </Button>
            }
          />
          <TooltipContent side="bottom">New layout</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="header-btn-compact gap-1.5 bg-card"
                disabled={persistenceDisabled}
                onClick={() => {
                  setRenameValue(props.currentName);
                  setRenameOpen(true);
                }}
              >
                <Pencil className="size-3.5" />
                <span className="header-btn-text">Rename</span>
              </Button>
            }
          />
          <TooltipContent side="bottom">
            {persistenceDisabled
              ? 'Built-in layouts cannot be renamed'
              : 'Rename this layout'}
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="header-btn-compact gap-1.5 bg-card border-destructive/20 text-destructive hover:bg-destructive hover:text-destructive-foreground hover:border-destructive"
                disabled={persistenceDisabled || props.isDefault}
                onClick={() => setDeleteOpen(true)}
              >
                <Trash2 className="size-3.5" />
                <span className="header-btn-text">Delete</span>
              </Button>
            }
          />
          <TooltipContent side="bottom">
            {persistenceNote ?? 'Delete this layout'}
          </TooltipContent>
        </Tooltip>
      </div>

      {/* Group 3: Undo Redo */}
      <div className="editor-header__group">
        <div className="editor-header__divider hidden sm:block" />
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="header-btn-compact gap-1.5"
                disabled={!props.canUndo}
                onClick={props.onUndo}
              >
                <Undo2 className="size-3.5" />
                <span className="header-btn-text">Undo</span>
              </Button>
            }
          />
          <TooltipContent side="bottom">Undo (Ctrl+Z)</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="header-btn-compact gap-1.5"
                disabled={!props.canRedo}
                onClick={props.onRedo}
              >
                <Redo2 className="size-3.5" />
                <span className="header-btn-text">Redo</span>
              </Button>
            }
          />
          <TooltipContent side="bottom">Redo (Ctrl+Shift+Z)</TooltipContent>
        </Tooltip>
      </div>

      {/* Quick apply to all players */}
      {props.onApplyToAll && (
        <div className="editor-header__group">
          <div className="editor-header__divider hidden sm:block" />
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="header-btn-compact gap-1.5 bg-card"
                  disabled={props.dirty || props.hasErrors}
                  onClick={props.onApplyToAll}
                >
                  <Users className="size-3.5" />
                  <span className="header-btn-text">Apply to all</span>
                </Button>
              }
            />
            <TooltipContent side="bottom">
              {props.hasErrors
                ? 'Fix validation errors before applying'
                : props.dirty
                  ? 'Save changes before applying to players'
                  : 'Push this layout to all connected players'}
            </TooltipContent>
          </Tooltip>
        </div>
      )}

      {/* Group 4: Discard Save — primary hierarchy */}
      <div className="ml-auto flex items-center gap-2">
        {props.dirty && (
          <Tooltip>
            <TooltipTrigger>
              <span className="editor-header__unsaved">
                <span className="editor-header__unsaved-dot" aria-hidden />
                <span>Unsaved</span>
              </span>
            </TooltipTrigger>
            <TooltipContent side="bottom">Unsaved changes</TooltipContent>
          </Tooltip>
        )}
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="header-btn-compact gap-1.5"
                disabled={!props.dirty}
                onClick={props.onDiscard}
              >
                <RotateCcw className="size-3.5" />
                <span className="header-btn-text">Discard</span>
              </Button>
            }
          />
          <TooltipContent side="bottom">Discard unsaved changes</TooltipContent>
        </Tooltip>
        {props.isBuiltin ? (
          <Tooltip>
            <TooltipTrigger>
              <span className="inline-flex">
                <Button
                  type="button"
                  variant="default"
                  size="sm"
                  className="header-btn-compact gap-1.5 shadow-sm"
                  onClick={props.onDuplicate}
                >
                  <Copy className="size-3.5" />
                  <span className="header-btn-text">Duplicate to edit</span>
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              Make an editable copy of this built-in layout
            </TooltipContent>
          </Tooltip>
        ) : (
          <Tooltip>
            <TooltipTrigger>
              <span className="inline-flex">
                <Button
                  type="button"
                  variant="default"
                  size="sm"
                  className="header-btn-compact gap-1.5 shadow-sm"
                  disabled={
                    !props.dirty || props.hasErrors || persistenceDisabled
                  }
                  onClick={() => void props.onSave()}
                >
                  <Save className="size-3.5" />
                  <span className="header-btn-text">Save</span>
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {props.hasErrors
                ? 'Fix validation errors before saving'
                : persistenceDisabled
                  ? 'Built-in layouts are read-only — use New layout to clone'
                  : !props.dirty
                    ? 'No changes to save'
                    : 'Save this layout'}
            </TooltipContent>
          </Tooltip>
        )}
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
