import { useEffect, useMemo, useRef, useState } from 'react';
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
  getLinkedGroup,
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
  detached: Set<string>;
  onToggleDetach: (id: string) => void;
}

export function Inspector({
  document,
  selectedControlId,
  selectedSectionId,
  onDraftChange,
  errors,
  locks,
  onToggleLock,
  detached,
  onToggleDetach,
}: InspectorProps) {
  const selectedSection = selectedSectionId
    ? document.sections.find((s) => s.id === selectedSectionId)
    : null;
  const selectedControl = selectedControlId
    ? findControl(document, selectedControlId)
    : null;
  const control = selectedControl?.control ?? null;
  const section = selectedControl?.section ?? selectedSection ?? null;

  // Scope the error map to the selected item. The document-wide error list is
  // keyed by full path; mapping every leaf name globally would leak another
  // control's or section's error onto the one being inspected.
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
      <h2 className="mb-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {selectedControlId
          ? `Control — ${control?.label ?? control?.id ?? ''}`
          : selectedSectionId
            ? `Section — ${selectedSectionId}`
            : 'Document'}
      </h2>

      {errors.length > 0 && (
        <div className="mb-3 space-y-1 rounded bg-red-900/20 px-2 py-1.5">
          {errors.slice(0, 3).map((error) => (
            <p
              key={error.path + error.message}
              className="text-[11px] leading-tight text-red-400"
            >
              {error.path} — {error.message}
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
        {/* Document meta: always visible */}
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
            detached={detached}
            onToggleDetach={onToggleDetach}
            onDraftChange={onDraftChange}
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
      <label className="block text-xs text-muted-foreground">
        Name
        <input
          className="mt-1 w-full rounded border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-white outline-none focus:border-white/30"
          value={document.name}
          onChange={(event) => {
            const next = structuredClone(document);
            next.name = event.target.value;
            onDraftChange(next, false);
          }}
          onBlur={() => onDraftChange(document, true)}
        />
      </label>
      <div className="space-y-1">
        <InfoRow label="ID" value={document.id} />
        <InfoRow label="Schema" value={`v${document.schemaVersion}`} />
        <InfoRow label="Orientation" value={document.defaultOrientation} />
        <InfoRow label="Assets" value={`${document.assets.length}`} />
      </div>
      {document.assets.length === 0 && (
        <p className="text-[10px] text-muted-foreground/60">
          No assets — add files to layouts folder manually.
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
  detached,
  onToggleDetach,
  onDraftChange,
}: {
  control: Control;
  document: LayoutDocument;
  fieldErrors: Map<string, string>;
  locks: Record<string, boolean>;
  onToggleLock: (id: string) => void;
  detached: Set<string>;
  onToggleDetach: (id: string) => void;
  onDraftChange: (next: LayoutDocument, commit: boolean) => void;
}) {
  const locked = locks[control.id] ?? isDefaultLocked(control);
  const group = getLinkedGroup(document, control.id);
  const isLinked = group.length > 1 && !detached.has(control.id);
  const allowed = getAllowedBindings(control.type);
  const isDpad = control.type === 'dpad';

  const update = (fields: Partial<Control>) => {
    const next = structuredClone(document);
    const found = findControl(next, control.id);
    if (!found) return;
    Object.assign(found.control, fields);
    onDraftChange(next, true);
  };

  return (
    <div className="space-y-3 border-t border-white/10 pt-4">
      <h3 className="text-xs font-medium text-white/80">
        {control.label || control.id}
      </h3>

      {/* Type (read-only) */}
      <InfoRow label="Type" value={control.type} />

      {/* Label */}
      <label className="block text-xs text-muted-foreground">
        Label
        <input
          className="mt-1 w-full rounded border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-white outline-none focus:border-white/30"
          value={control.label}
          onChange={(event) => {
            const next = structuredClone(document);
            const found = findControl(next, control.id);
            if (found) found.control.label = event.target.value;
            onDraftChange(next, false);
          }}
          onBlur={() => onDraftChange(document, true)}
        />
      </label>

      {/* Binding */}
      {allowed.length > 0 && !isDpad && (
        <label className="block text-xs text-muted-foreground">
          Binding
          <select
            className="mt-1 w-full rounded border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-white outline-none focus:border-white/30"
            value={control.binding ?? ''}
            onChange={(event) =>
              update({ binding: event.target.value as Control['binding'] })
            }
          >
            <option value="" disabled>
              Select binding
            </option>
            {allowed.map((command) => (
              <option key={command} value={command}>
                {getBindingLabel(command)}
              </option>
            ))}
          </select>
        </label>
      )}

      {/* Dpad: fixed bindings display */}
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
                {dir}: {control.bindings?.[dir] ?? '—'}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Shape */}
      <label className="block text-xs text-muted-foreground">
        Shape
        <select
          className="mt-1 w-full rounded border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-white outline-none focus:border-white/30"
          value={control.shape ?? 'round'}
          onChange={(event) =>
            update({ shape: event.target.value as 'round' | 'rect' })
          }
        >
          <option value="round">Round</option>
          <option value="rect">Rect</option>
        </select>
      </label>
      {control.shape === 'round' && (
        <p className="text-[10px] leading-tight text-muted-foreground">
          Shape is visual only — touch area is always the bounding rectangle.
        </p>
      )}

      {/* Visible */}
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <input
          type="checkbox"
          className="accent-white"
          checked={control.visible}
          onChange={(event) => update({ visible: event.target.checked })}
        />
        Visible
      </label>

      {/* Hit-only */}
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <input
          type="checkbox"
          className="accent-white"
          checked={control.hitOnly ?? false}
          onChange={(event) => update({ hitOnly: event.target.checked })}
        />
        Hit-only
      </label>
      {control.hitOnly && (
        <p className="text-[10px] leading-tight text-muted-foreground">
          Invisible during play — only touch area exists. Fills gaps between
          face buttons.
        </p>
      )}

      {/* Asset (image type) */}
      {control.type === 'image' && (
        <label className="block text-xs text-muted-foreground">
          Asset
          <select
            className="mt-1 w-full rounded border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-white outline-none focus:border-white/30"
            value={control.asset ?? ''}
            onChange={(event) =>
              update({ asset: event.target.value || undefined })
            }
          >
            <option value="" disabled>
              {document.assets.length === 0
                ? 'No assets available'
                : 'Select asset'}
            </option>
            {document.assets.map((asset) => (
              <option key={asset.id} value={asset.id}>
                {asset.id}
              </option>
            ))}
          </select>
        </label>
      )}

      {/* Geometry with lock */}
      <div className="space-y-2 border-t border-white/10 pt-3">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Geometry</span>
          <button
            type="button"
            className="rounded px-1.5 py-0.5 text-[11px] transition-colors hover:bg-white/10"
            onClick={() => onToggleLock(control.id)}
            title={locked ? 'Unlock aspect ratio' : 'Lock aspect ratio'}
          >
            {locked ? '🔒' : '🔓'}
          </button>
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

      {/* Linked indicator */}
      {group.length > 1 && (
        <div className="flex items-center gap-2 rounded bg-white/5 px-2 py-1.5">
          <span className="text-[11px] text-white/80">
            {group.length} linked ⛓️
          </span>
          <button
            type="button"
            className="ml-auto text-[11px] text-white/50 hover:text-white"
            onClick={() => onToggleDetach(control.id)}
          >
            {isLinked ? 'Detach' : 'Link'}
          </button>
        </div>
      )}
    </div>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  step = 0.01,
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
      <label className="text-[10px] text-muted-foreground">
        {label}
        <input
          className={`mt-0.5 w-full rounded border px-2 py-1 font-mono text-xs outline-none ${
            invalid
              ? 'border-red-500 bg-red-900/20 text-red-300'
              : 'border-white/10 bg-white/5 text-white focus:border-white/30'
          }`}
          value={text}
          step={step}
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
        />
      </label>
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
