import { useMemo, useState } from 'react';
import { BindingLabel } from '@/components/ui/binding-label';
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
import type {
  Control,
  Document as LayoutDocument,
} from '@/shared/generated/layout';
import { getAllowedBindings, nextControlId } from '@/shared/layout-editor';

export type ControlType = Control['type'];

export interface AddControlResult {
  sectionId: string;
  control: Control;
}

interface AddControlDialogProps {
  open: boolean;
  document: LayoutDocument;
  sectionId: string;
  onOpenChange: (open: boolean) => void;
  onAdd: (result: AddControlResult) => void;
}

const DEFAULT_SIZE: Record<ControlType, { width: number; height: number }> = {
  button: { width: 0.28, height: 0.28 },
  dpad: { width: 0.5, height: 0.5 },
  joystick: { width: 0.44, height: 0.44 },
  trigger: { width: 0.3, height: 0.18 },
  label: { width: 0.34, height: 0.1 },
  image: { width: 0.34, height: 0.34 },
  hitfill: { width: 0.08, height: 0.08 },
};

export function AddControlDialog({
  open,
  document,
  sectionId,
  onOpenChange,
  onAdd,
}: AddControlDialogProps) {
  const section = document.sections.find((s) => s.id === sectionId);
  const [type, setType] = useState<ControlType>('button');
  const [binding, setBinding] = useState<string>('south');
  const [label, setLabel] = useState('Button');
  const [shape, setShape] = useState<'round' | 'rect'>('round');
  const [parentId, setParentId] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  const allowed = useMemo(() => getAllowedBindings(type), [type]);
  const eligibleParents = useMemo(() => {
    if (!section) return [];
    return section.controls.filter((c) => c.type !== 'hitfill');
  }, [section]);

  const createControl = (): Control | null => {
    if (!section) return null;
    if (type === 'hitfill') {
      if (!parentId) {
        setError('Parent is required for hitfill.');
        return null;
      }
      const size = DEFAULT_SIZE.hitfill;
      const parent = section.controls.find((c) => c.id === parentId);
      const pos = parent
        ? {
            x: parent.geometry.position.x + 0.04,
            y: parent.geometry.position.y + 0.04,
          }
        : { x: 0, y: 0 };
      const control: Control = {
        id: nextControlId(document),
        type: 'hitfill',
        geometry: { position: pos, size },
        label: '',
        parentId,
        shape: 'rect',
      };
      return control;
    }
    const size = DEFAULT_SIZE[type] ?? { width: 0.28, height: 0.28 };
    const control: Control = {
      id: nextControlId(document),
      type,
      geometry: { position: { x: 0, y: 0 }, size },
      label: label.trim() || defaultLabel(type),
      shape,
    };
    if (type === 'dpad') {
      control.bindings = {
        up: 'dpadUp',
        down: 'dpadDown',
        left: 'dpadLeft',
        right: 'dpadRight',
      };
    } else if (type === 'button') {
      control.binding = binding as Control['binding'];
    } else if (type === 'joystick') {
      control.binding = binding === 'rightStick' ? 'rightStick' : 'leftStick';
    } else if (type === 'trigger') {
      control.binding =
        binding === 'rightTrigger' ? 'rightTrigger' : 'leftTrigger';
    }
    return control;
  };

  const handleSubmit = (): void => {
    if (!section) return;
    setError(null);
    if (type === 'hitfill' && !parentId) {
      setError('Select a parent control for the hitfill.');
      return;
    }
    const control = createControl();
    if (!control) return;
    onAdd({ sectionId, control });
    // reset hitfill parent selection for next open
    setParentId('');
    setError(null);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogTitle>Add control</DialogTitle>
        <DialogDescription>
          New controls land at the center of the {section?.id ?? ''} section.
        </DialogDescription>
        <div className="grid gap-4 py-2">
          <div className="grid gap-1.5">
            <Label htmlFor="add-type">Type</Label>
            <Select
              value={type}
              onValueChange={(value) => {
                const next = value as ControlType;
                setType(next);
                setLabel(defaultLabel(next));
                const first = getAllowedBindings(next)[0];
                if (first) setBinding(first);
                if (next === 'label') setShape('rect');
                if (next === 'hitfill') {
                  setParentId(eligibleParents[0]?.id ?? '');
                  setError(null);
                } else {
                  setError(null);
                }
              }}
            >
              <SelectTrigger id="add-type" className="capitalize">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(
                  [
                    'button',
                    'dpad',
                    'joystick',
                    'trigger',
                    'label',
                    'image',
                    'hitfill',
                  ] as const
                ).map((option) => (
                  <SelectItem key={option} value={option}>
                    {option.charAt(0).toUpperCase() + option.slice(1)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {type === 'hitfill' ? (
            <>
              <div className="grid gap-1.5">
                <Label htmlFor="add-parent">Parent (required)</Label>
                <Select
                  value={parentId}
                  onValueChange={(value) => {
                    if (value) {
                      setParentId(value);
                      setError(null);
                    }
                  }}
                >
                  <SelectTrigger id="add-parent">
                    <SelectValue placeholder="Select parent" />
                  </SelectTrigger>
                  <SelectContent>
                    {eligibleParents.length === 0 && (
                      <SelectItem value="__none" disabled>
                        No eligible parents in this section
                      </SelectItem>
                    )}
                    {eligibleParents.map((parent) => (
                      <SelectItem key={parent.id} value={parent.id}>
                        {parent.id}{' '}
                        {parent.binding
                          ? `(${parent.binding})`
                          : `(${parent.type})`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] leading-tight text-muted-foreground">
                  Hitfill is not shown during play. It extends the hit area of
                  its parent. Binding is derived automatically.
                </p>
              </div>
              {error && <p className="text-xs text-destructive">{error}</p>}
            </>
          ) : (
            <>
              <div className="grid gap-1.5">
                <Label htmlFor="add-label">Label</Label>
                <Input
                  id="add-label"
                  value={label}
                  onChange={(event) => setLabel(event.target.value)}
                />
              </div>

              {type === 'button' ||
              type === 'joystick' ||
              type === 'trigger' ? (
                <div className="grid gap-1.5">
                  <Label htmlFor="add-binding">Binding</Label>
                  <Select
                    value={binding}
                    onValueChange={(value) => {
                      if (value) setBinding(value);
                    }}
                  >
                    <SelectTrigger id="add-binding" className="capitalize">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="min-w-[240px]">
                      {allowed.map((command) => (
                        <SelectItem key={command} value={command}>
                          <BindingLabel command={command} />
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : type === 'dpad' ? (
                <p className="text-xs text-muted-foreground">
                  A D-pad always maps to the four fixed directions.
                </p>
              ) : null}

              <div className="grid gap-1.5">
                <Label htmlFor="add-shape">Shape</Label>
                <Select
                  value={shape}
                  onValueChange={(value) => {
                    if (value) setShape(value as 'round' | 'rect');
                  }}
                >
                  <SelectTrigger id="add-shape" className="capitalize">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="round">Round</SelectItem>
                    <SelectItem value="rect">Rect</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </>
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
            onClick={handleSubmit}
            disabled={type === 'hitfill' && !parentId}
          >
            Add control
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function defaultLabel(type: ControlType): string {
  switch (type) {
    case 'dpad':
      return 'D-pad';
    case 'joystick':
      return 'Joystick';
    case 'trigger':
      return 'Trigger';
    case 'label':
      return 'Label';
    case 'image':
      return 'Image';
    case 'hitfill':
      return '';
    default:
      return 'Button';
  }
}
