import { useEffect, useMemo, useState } from 'react';
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

type AddableControlType = Exclude<ControlType, 'hitzone'>;

const DEFAULT_SIZE: Record<
  AddableControlType,
  { width: number; height: number }
> = {
  button: { width: 0.28, height: 0.28 },
  dpad: { width: 0.5, height: 0.5 },
  joystick: { width: 0.44, height: 0.44 },
  trigger: { width: 0.3, height: 0.18 },
  label: { width: 0.34, height: 0.1 },
};

export function AddControlDialog({
  open,
  document,
  sectionId,
  onOpenChange,
  onAdd,
}: AddControlDialogProps) {
  const [activeSectionId, setActiveSectionId] = useState(sectionId);
  useEffect(() => {
    if (open) setActiveSectionId(sectionId);
  }, [sectionId, open]);
  const section = document.sections.find((s) => s.id === activeSectionId);
  const [type, setType] = useState<AddableControlType>('button');
  const [binding, setBinding] = useState<string>('south');
  const [label, setLabel] = useState('Button');
  const [shape, setShape] = useState<'round' | 'rect'>('round');

  const allowed = useMemo(() => getAllowedBindings(type), [type]);

  const createControl = (): Control | null => {
    if (!section) return null;
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
    const control = createControl();
    if (!control) return;
    onAdd({ sectionId: activeSectionId, control });
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
            <Label htmlFor="add-section">Section</Label>
            <Select
              value={activeSectionId}
              onValueChange={(value) => {
                if (value) setActiveSectionId(value);
              }}
            >
              <SelectTrigger id="add-section" className="capitalize">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {document.sections.map((sec) => (
                  <SelectItem key={sec.id} value={sec.id}>
                    {sec.id.charAt(0).toUpperCase() + sec.id.slice(1)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="add-type">Type</Label>
            <Select
              value={type}
              onValueChange={(value) => {
                const next = value as AddableControlType;
                setType(next);
                setLabel(defaultLabel(next));
                const first = getAllowedBindings(next)[0];
                if (first) setBinding(first);
                if (next === 'label') setShape('rect');
              }}
            >
              <SelectTrigger id="add-type" className="capitalize">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(
                  ['button', 'dpad', 'joystick', 'trigger', 'label'] as const
                ).map((option) => (
                  <SelectItem key={option} value={option}>
                    {option.charAt(0).toUpperCase() + option.slice(1)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="add-label">Label</Label>
            <Input
              id="add-label"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
            />
          </div>

          {type === 'button' || type === 'joystick' || type === 'trigger' ? (
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
              <SelectTrigger id="add-shape">
                <SelectValue>
                  {(value: string | null) =>
                    value === 'round'
                      ? 'Round / Ellipse'
                      : value === 'rect'
                        ? 'Rectangle'
                        : ''
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="round">Round / Ellipse</SelectItem>
                <SelectItem value="rect">Rectangle</SelectItem>
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
          <Button type="button" onClick={handleSubmit}>
            Add control
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function defaultLabel(type: AddableControlType): string {
  switch (type) {
    case 'dpad':
      return 'D-pad';
    case 'joystick':
      return 'Joystick';
    case 'trigger':
      return 'Trigger';
    case 'label':
      return 'Label';
    default:
      return 'Button';
  }
}
