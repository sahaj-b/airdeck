import {
  Copy,
  Lock,
  PanelRightClose,
  Plus,
  Trash2,
  Unlock,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type {
  Control,
  Document as LayoutDocument,
  Section,
} from '@/shared/generated/layout';
import type { ValidationError } from '@/shared/layout';
import {
  findControl,
  getAllowedBindings,
  getBindingLabel,
  isDefaultLocked,
} from '@/shared/layout-editor';

export interface InspectorProps {
  document: LayoutDocument;
  selectedControlId: string | null;
  selectedSectionId: string | null;
  onDraftChange: (next: LayoutDocument, commit: boolean) => void;
  errors: ValidationError[];
  locks: Record<string, boolean>;
  onToggleLock: (id: string) => void;
  onCollapse?: () => void;
  onDuplicateControl?: (id: string) => void;
  onDeleteControl?: (id: string) => void;
  onAddHitfill?: (parentId: string) => void;
}

export function Inspector({
  document,
  selectedControlId,
  selectedSectionId,
  onDraftChange,
  errors,
  locks,
  onToggleLock,
  onCollapse,
  onDuplicateControl,
  onDeleteControl,
  onAddHitfill,
}: InspectorProps) {
  const selectedSection = selectedSectionId
    ? document.sections.find((s) => s.id === selectedSectionId)
    : null;
  const selectedControl = selectedControlId
    ? findControl(document, selectedControlId)
    : null;
  const control = selectedControl?.control ?? null;
  const section = selectedControl?.section ?? selectedSection ?? null;

  const fieldErrors = useMemo(() => {
    const map = new Map<string, string>();
    let prefix: string | null = null;
    if (selectedControl) {
      prefix = `/sections/${selectedControl.section.id}/controls/${selectedControl.control.id}`;
    } else if (selectedSectionId) {
      prefix = `/sections/${selectedSectionId}`;
    }
    if (!prefix) return map;
    for (const error of errors) {
      if (!error.path.startsWith(prefix)) continue;
      const parts = error.path.split('/');
      map.set(parts[parts.length - 1], error.message);
    }
    return map;
  }, [errors, selectedControl, selectedSectionId]);

  return (
    <section className="editor-panel editor-inspector">
      <div className="mb-3 flex items-center gap-2">
        {onCollapse && (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8 shrink-0 text-white/60 hover:text-white"
                  onClick={onCollapse}
                  aria-label="Collapse inspector"
                >
                  <PanelRightClose className="size-4" />
                </Button>
              }
            />
            <TooltipContent side="left">Collapse inspector</TooltipContent>
          </Tooltip>
        )}
        <h2 className="flex-1 text-left text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          {selectedControlId
            ? `Control: ${control?.label ?? control?.id ?? ''}`
            : selectedSectionId
              ? `Section: ${selectedSectionId}`
              : 'Document'}
        </h2>
        {control && onDuplicateControl && onDeleteControl && (
          <div className="flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="size-7 text-white/60 hover:text-white"
                    onClick={() => onDuplicateControl(control.id)}
                    aria-label="Duplicate control"
                  >
                    <Copy className="size-3.5" />
                  </Button>
                }
              />
              <TooltipContent side="top">Duplicate</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="size-7 text-red-400 hover:bg-red-500/10 hover:text-red-300"
                    onClick={() => onDeleteControl(control.id)}
                    aria-label="Delete control"
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                }
              />
              <TooltipContent side="top">Delete control</TooltipContent>
            </Tooltip>
          </div>
        )}
      </div>

      {errors.length > 0 && (
        <div className="mb-3 space-y-1 rounded bg-red-900/20 px-2 py-1.5">
          {errors.slice(0, 3).map((error) => (
            <p
              key={error.path + error.message}
              className="text-[11px] leading-tight text-red-400"
            >
              {error.path}: {error.message}
            </p>
          ))}
          {errors.length > 3 && (
            <p className="text-[11px] text-red-400/60">
              +{errors.length - 3} more errors
            </p>
          )}
        </div>
      )}

      <div className="space-y-4">
        <DocumentMeta document={document} onDraftChange={onDraftChange} />

        {section && !control && (
          <SectionFields
            section={section}
            document={document}
            fieldErrors={fieldErrors}
            onDraftChange={onDraftChange}
          />
        )}

        {control && section && (
          <ControlFields
            control={control}
            document={document}
            fieldErrors={fieldErrors}
            locks={locks}
            onToggleLock={onToggleLock}
            onDraftChange={onDraftChange}
            onAddHitfill={onAddHitfill}
          />
        )}
      </div>
    </section>
  );
}

function DocumentMeta({
  document,
  onDraftChange,
}: {
  document: LayoutDocument;
  onDraftChange: (next: LayoutDocument, commit: boolean) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="space-y-1.5">
        <Label htmlFor="doc-name" className="text-xs">
          Name
        </Label>
        <Input
          id="doc-name"
          value={document.name}
          onChange={(event) => {
            const next = structuredClone(document);
            next.name = event.target.value;
            onDraftChange(next, false);
          }}
          onBlur={(event) => {
            const next = structuredClone(document);
            next.name = (event.target as HTMLInputElement).value;
            onDraftChange(next, true);
          }}
        />
      </div>
      <div className="space-y-1">
        <InfoRow label="ID" value={document.id} />
        <InfoRow label="Schema" value={`v${document.schemaVersion}`} />
        <InfoRow label="Orientation" value={document.defaultOrientation} />
        <InfoRow label="Assets" value={`${document.assets.length}`} />
      </div>
      {document.assets.length === 0 && (
        <p className="text-[10px] text-muted-foreground/60">
          No assets. Add files to layouts folder manually.
        </p>
      )}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <span className="font-mono text-[10px] text-white/60">{value}</span>
    </div>
  );
}

function SectionFields({
  section,
  document,
  fieldErrors,
  onDraftChange,
}: {
  section: Section;
  document: LayoutDocument;
  fieldErrors: Map<string, string>;
  onDraftChange: (next: LayoutDocument, commit: boolean) => void;
}) {
  const updateWidth = (val: number) => {
    const next = structuredClone(document);
    const s = next.sections.find((candidate) => candidate.id === section.id);
    if (s) s.relativeWidth = val;
    onDraftChange(next, true);
  };
  const updateMinWidth = (val: number) => {
    const next = structuredClone(document);
    const s = next.sections.find((candidate) => candidate.id === section.id);
    if (s) {
      if (val > 0) s.relativeMinWidth = val;
      else s.relativeMinWidth = undefined;
    }
    onDraftChange(next, true);
  };

  return (
    <div className="space-y-2 border-t border-white/10 pt-4">
      <h3 className="text-xs font-medium text-white/80">Section</h3>
      <NumberField
        label="Width (relativeWidth)"
        value={section.relativeWidth}
        min={0.1}
        max={4}
        step={0.01}
        error={fieldErrors.get('relativeWidth')}
        onChange={updateWidth}
      />
      <NumberField
        label="Min width (optional)"
        value={section.relativeMinWidth ?? 0}
        min={0}
        max={4}
        step={0.01}
        note="0 = no minimum"
        error={fieldErrors.get('relativeMinWidth')}
        onChange={updateMinWidth}
      />
    </div>
  );
}

function ControlFields({
  control,
  document,
  fieldErrors,
  locks,
  onToggleLock,
  onDraftChange,
  onAddHitfill,
}: {
  control: Control;
  document: LayoutDocument;
  fieldErrors: Map<string, string>;
  locks: Record<string, boolean>;
  onToggleLock: (id: string) => void;
  onDraftChange: (next: LayoutDocument, commit: boolean) => void;
  onAddHitfill?: (parentId: string) => void;
}) {
  const locked = locks[control.id] ?? isDefaultLocked(control);
  const allowed = getAllowedBindings(control.type);
  const isDpad = control.type === 'dpad';
  const isHitfill = control.type === 'hitfill';

  const update = (fields: Partial<Control>) => {
    const next = structuredClone(document);
    const found = findControl(next, control.id);
    if (!found) return;
    Object.assign(found.control, fields);
    onDraftChange(next, true);
  };

  if (isHitfill) {
    const parent = document.sections
      .flatMap((s) => s.controls)
      .find((c) => c.id === control.parentId);
    const binding = parent?.binding ?? '—';
    return (
      <div className="space-y-3 border-t border-white/10 pt-4">
        <h3 className="text-xs font-medium text-white/80">
          hitfill → {control.parentId} {binding !== '—' ? `(${binding})` : ''}
        </h3>
        <InfoRow label="Type" value="hitfill" />
        <div className="rounded bg-white/5 px-2 py-1.5">
          <p className="text-[11px] text-white/70">
            Parent: <span className="font-mono">{control.parentId ?? '—'}</span>{' '}
            {binding !== '—' && (
              <span className="text-white/50">({binding})</span>
            )}
          </p>
          <p className="mt-1 text-[10px] leading-tight text-muted-foreground">
            Binding is derived from parent. Changing the parent’s binding
            automatically updates this hitfill.
          </p>
        </div>
        {fieldErrors.get('parentId') && (
          <p className="text-[11px] text-red-400">
            {fieldErrors.get('parentId')}
          </p>
        )}

        <div className="space-y-2 border-t border-white/10 pt-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-white/80">Geometry</span>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    variant={locked ? 'default' : 'outline'}
                    size="sm"
                    className="h-7 gap-1.5 px-2.5 text-xs font-medium"
                    onClick={() => onToggleLock(control.id)}
                  >
                    {locked ? (
                      <>
                        <Lock className="size-3.5" />
                        Locked
                      </>
                    ) : (
                      <>
                        <Unlock className="size-3.5" />
                        Free
                      </>
                    )}
                  </Button>
                }
              />
              <TooltipContent side="top">
                {locked ? 'Unlock aspect ratio' : 'Lock aspect ratio'}
              </TooltipContent>
            </Tooltip>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <NumberField
              label="X"
              value={control.geometry.position.x}
              step={0.01}
              min={-2}
              max={2}
              error={fieldErrors.get('x')}
              onChange={(v) => {
                const next = structuredClone(document);
                const found = findControl(next, control.id);
                if (found) found.control.geometry.position.x = v;
                onDraftChange(next, true);
              }}
            />
            <NumberField
              label="Y"
              value={control.geometry.position.y}
              step={0.01}
              min={-2}
              max={2}
              error={fieldErrors.get('y')}
              onChange={(v) => {
                const next = structuredClone(document);
                const found = findControl(next, control.id);
                if (found) found.control.geometry.position.y = v;
                onDraftChange(next, true);
              }}
            />
            <NumberField
              label="W"
              value={control.geometry.size.width}
              step={0.01}
              min={0.01}
              max={2}
              error={fieldErrors.get('width')}
              onChange={(v) => {
                const next = structuredClone(document);
                const found = findControl(next, control.id);
                if (found) {
                  if (locked) {
                    const ratio =
                      control.geometry.size.width /
                      control.geometry.size.height;
                    found.control.geometry.size.height = v / ratio;
                  }
                  found.control.geometry.size.width = v;
                }
                onDraftChange(next, true);
              }}
            />
            <NumberField
              label="H"
              value={control.geometry.size.height}
              step={0.01}
              min={0.01}
              max={2}
              error={fieldErrors.get('height')}
              onChange={(v) => {
                const next = structuredClone(document);
                const found = findControl(next, control.id);
                if (found) {
                  if (locked) {
                    const ratio =
                      control.geometry.size.width /
                      control.geometry.size.height;
                    found.control.geometry.size.width = v * ratio;
                  }
                  found.control.geometry.size.height = v;
                }
                onDraftChange(next, true);
              }}
            />
          </div>
          {fieldErrors.get('geometry') && (
            <p className="text-[10px] leading-tight text-red-400">
              {fieldErrors.get('geometry')}
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 border-t border-white/10 pt-4">
      <h3 className="text-xs font-medium text-white/80">
        {control.label || control.id}
      </h3>

      <InfoRow label="Type" value={control.type} />

      <div className="space-y-1.5">
        <Label htmlFor={`label-${control.id}`} className="text-xs">
          Label
        </Label>
        <Input
          id={`label-${control.id}`}
          value={control.label}
          onChange={(event) => {
            const next = structuredClone(document);
            const found = findControl(next, control.id);
            if (found) found.control.label = event.target.value;
            onDraftChange(next, false);
          }}
          onBlur={(event) => {
            const next = structuredClone(document);
            const found = findControl(next, control.id);
            if (found) {
              found.control.label = (event.target as HTMLInputElement).value;
              onDraftChange(next, true);
            }
          }}
        />
      </div>

      {allowed.length > 0 && !isDpad && (
        <div className="space-y-1.5">
          <Label className="text-xs">Binding</Label>
          <Select
            value={control.binding ?? ''}
            onValueChange={(value) => {
              if (value) update({ binding: value as Control['binding'] });
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select binding" />
            </SelectTrigger>
            <SelectContent>
              {allowed.map((command) => (
                <SelectItem key={command} value={command}>
                  {getBindingLabel(command)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {isDpad && (
        <div className="space-y-1">
          <p className="text-[10px] text-muted-foreground">
            D-pad has four fixed directions.
          </p>
          <div className="grid grid-cols-2 gap-1">
            {(['up', 'down', 'left', 'right'] as const).map((dir) => (
              <div
                key={dir}
                className="rounded bg-white/5 px-2 py-1 text-[11px] text-white/60"
              >
                {dir}: {control.bindings?.[dir] ?? '-'}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-1.5">
        <Label className="text-xs">Shape</Label>
        <Select
          value={control.shape ?? 'round'}
          onValueChange={(value) => {
            if (value) update({ shape: value as 'round' | 'rect' });
          }}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="round">Round</SelectItem>
            <SelectItem value="rect">Rect</SelectItem>
          </SelectContent>
        </Select>
        {control.shape === 'round' && (
          <p className="text-[10px] leading-tight text-muted-foreground">
            Shape is visual only. Touch area is always the bounding rectangle.
          </p>
        )}
      </div>

      {onAddHitfill &&
        control.type !== 'hitfill' &&
        control.type !== 'label' &&
        control.type !== 'image' && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full gap-1.5 border-white/10"
            onClick={() => onAddHitfill(control.id)}
          >
            <Plus className="size-3.5" />
            Add hitfill here
          </Button>
        )}

      {control.type === 'image' && (
        <div className="space-y-1.5">
          <Label className="text-xs">Asset</Label>
          <Select
            value={control.asset ?? ''}
            onValueChange={(value) => update({ asset: value || undefined })}
          >
            <SelectTrigger className="w-full">
              <SelectValue
                placeholder={
                  document.assets.length === 0
                    ? 'No assets available'
                    : 'Select asset'
                }
              />
            </SelectTrigger>
            <SelectContent>
              {document.assets.map((asset) => (
                <SelectItem key={asset.id} value={asset.id}>
                  {asset.id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="space-y-2 border-t border-white/10 pt-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-white/80">Geometry</span>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant={locked ? 'default' : 'outline'}
                  size="sm"
                  className="h-7 gap-1.5 px-2.5 text-xs font-medium"
                  onClick={() => onToggleLock(control.id)}
                >
                  {locked ? (
                    <>
                      <Lock className="size-3.5" />
                      Locked
                    </>
                  ) : (
                    <>
                      <Unlock className="size-3.5" />
                      Free
                    </>
                  )}
                </Button>
              }
            />
            <TooltipContent side="top">
              {locked ? 'Unlock aspect ratio' : 'Lock aspect ratio'}
            </TooltipContent>
          </Tooltip>
        </div>
        <p className="text-[10px] leading-tight text-muted-foreground">
          {locked
            ? 'Aspect ratio locked. Resize keeps proportions.'
            : 'Aspect ratio free. Stretch width and height independently.'}
        </p>
        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label="X"
            value={control.geometry.position.x}
            step={0.01}
            min={-2}
            max={2}
            error={fieldErrors.get('x')}
            onChange={(v) => {
              const next = structuredClone(document);
              const found = findControl(next, control.id);
              if (found) found.control.geometry.position.x = v;
              onDraftChange(next, true);
            }}
          />
          <NumberField
            label="Y"
            value={control.geometry.position.y}
            step={0.01}
            min={-2}
            max={2}
            error={fieldErrors.get('y')}
            onChange={(v) => {
              const next = structuredClone(document);
              const found = findControl(next, control.id);
              if (found) found.control.geometry.position.y = v;
              onDraftChange(next, true);
            }}
          />
          <NumberField
            label="W"
            value={control.geometry.size.width}
            step={0.01}
            min={0.01}
            max={2}
            error={fieldErrors.get('width')}
            onChange={(v) => {
              const next = structuredClone(document);
              const found = findControl(next, control.id);
              if (found) {
                if (locked) {
                  const ratio =
                    control.geometry.size.width / control.geometry.size.height;
                  found.control.geometry.size.height = v / ratio;
                }
                found.control.geometry.size.width = v;
              }
              onDraftChange(next, true);
            }}
          />
          <NumberField
            label="H"
            value={control.geometry.size.height}
            step={0.01}
            min={0.01}
            max={2}
            error={fieldErrors.get('height')}
            onChange={(v) => {
              const next = structuredClone(document);
              const found = findControl(next, control.id);
              if (found) {
                if (locked) {
                  const ratio =
                    control.geometry.size.width / control.geometry.size.height;
                  found.control.geometry.size.width = v * ratio;
                }
                found.control.geometry.size.height = v;
              }
              onDraftChange(next, true);
            }}
          />
        </div>
        {fieldErrors.get('geometry') && (
          <p className="text-[10px] leading-tight text-red-400">
            {fieldErrors.get('geometry')}
          </p>
        )}
      </div>
    </div>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  step: _step = 0.01,
  error,
  note,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  error?: string;
  note?: string;
  onChange: (value: number) => void;
}) {
  const [text, setText] = useState(() => formatNumber(value));
  const lastValueRef = useRef(value);

  useEffect(() => {
    if (value !== lastValueRef.current) {
      lastValueRef.current = value;
      setText(formatNumber(value));
    }
  }, [value]);

  const parsed = parseFloat(text);
  const invalid =
    text.trim() === '' ||
    !Number.isFinite(parsed) ||
    (min !== undefined && parsed < min) ||
    (max !== undefined && parsed > max);

  return (
    <div>
      <Label className="text-[10px] text-muted-foreground">{label}</Label>
      <Input
        value={text}
        onChange={(event) => setText(event.target.value)}
        onBlur={() => {
          if (!invalid) {
            lastValueRef.current = parsed;
            onChange(parsed);
          } else {
            setText(formatNumber(lastValueRef.current));
          }
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !invalid) {
            lastValueRef.current = parsed;
            onChange(parsed);
            (event.target as HTMLInputElement).blur();
          }
          if (event.key === 'Escape') {
            setText(formatNumber(lastValueRef.current));
            (event.target as HTMLInputElement).blur();
          }
        }}
        className={`mt-0.5 font-mono text-xs ${
          invalid
            ? 'border-red-500 bg-red-900/20 text-red-300 focus-visible:border-red-500 focus-visible:ring-red-500/20'
            : ''
        }`}
      />
      {error && <p className="mt-0.5 text-[10px] text-red-400">{error}</p>}
      {note && !error && (
        <p className="mt-0.5 text-[10px] text-muted-foreground">{note}</p>
      )}
    </div>
  );
}

function formatNumber(value: number): string {
  return value.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
}
