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
import { useEditorStore } from '@/editor/store/editor-store';

export function NewLayoutDialog({
  onCreate,
}: {
  onCreate: (name: string, baseId: string | null) => void;
}) {
  const open = useEditorStore((s) => s.newLayoutDialogOpen);
  const name = useEditorStore((s) => s.newLayoutName);
  const base = useEditorStore((s) => s.newLayoutBase);
  const error = useEditorStore((s) => s.newLayoutError);
  const layouts = useEditorStore((s) => s.layouts);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => useEditorStore.getState().setNewLayoutDialogOpen(o)}
    >
      <DialogContent>
        <DialogTitle>New layout</DialogTitle>
        <DialogDescription>
          Create a blank layout or clone an existing one.
        </DialogDescription>
        {error && (
          <p className="rounded border border-destructive/20 bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
            {error}
          </p>
        )}
        <div className="space-y-3 py-2">
          <div>
            <Label htmlFor="new-layout-name">Name</Label>
            <Input
              id="new-layout-name"
              value={name}
              onChange={(event) =>
                useEditorStore.getState().setNewLayoutName(event.target.value)
              }
              onKeyDown={(event) => {
                if (event.key === 'Enter')
                  void onCreate(name, base === 'blank' ? null : base);
              }}
            />
          </div>
          <div>
            <Label htmlFor="new-layout-base">Base</Label>
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
                <SelectItem value="blank">Blank</SelectItem>
                {layouts.map((layout) => (
                  <SelectItem key={layout.id} value={layout.id}>
                    {layout.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
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
            disabled={!name.trim()}
            onClick={() => void onCreate(name, base === 'blank' ? null : base)}
          >
            Create
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
