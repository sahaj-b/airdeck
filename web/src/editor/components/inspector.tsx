import {
  Check,
  ClipboardPaste,
  Copy,
  Lock,
  PanelRightClose,
  Square,
  Trash2,
  Unlock,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { BindingLabel } from '@/components/ui/binding-label';
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
  isAspectLockForced,
  resolveAspectLock,
} from '@/shared/layout-editor';
import { useIsShiftHeld } from '../hooks/use-is-shift-held';
import { useEditorStore } from '../store/editor-store';

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
  onAddHitzone?: (parentId: string) => void;
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
  onAddHitzone,
}: InspectorProps) {
  const selectedSection = selectedSectionId
    ? document.sections.find((s) => s.id === selectedSectionId)
    : null;
  const selectedControl = selectedControlId
    ? findControl(document, selectedControlId)
    : null;
  const control = selectedControl?.control ?? null;
  const section = selectedControl?.section ?? selectedSection ?? null;

  // biome-ignore lint/correctness/useExhaustiveDependencies: selectedControl derived from selectedControlId/document; depend on IDs to avoid object identity churn
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
  }, [errors, selectedControlId, selectedSectionId]);

  // Top-level summary without raw path dump
  const relevantErrors = useMemo(() => {
    if (selectedControlId || selectedSectionId) return [];
    return errors.slice(0, 3);
  }, [errors, selectedControlId, selectedSectionId]);

  return (
    <section className="flex min-h-0 w-full flex-col gap-3 bg-transparent p-2 overflow-y-auto overscroll-contain">
      <div className="flex items-center gap-2 pb-1">
        {onCollapse && (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8 shrink-0 text-muted-foreground hover:text-foreground"
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
        {selectedControlId ? (
          <h2 className="flex-1 flex min-w-0 items-baseline gap-1.5 text-left text-xs font-semibold tracking-wide text-muted-foreground">
            <span className="shrink-0 uppercase">CONTROL:</span>
            <span className="min-w-0 flex-1 truncate font-medium normal-case tracking-normal text-foreground">
              {control?.label || control?.id || ''}
            </span>
          </h2>
        ) : selectedSectionId ? (
          <h2 className="flex-1 flex min-w-0 items-baseline gap-1.5 text-left text-xs font-semibold tracking-wide text-muted-foreground">
            <span className="shrink-0 uppercase">SECTION:</span>
            <span className="min-w-0 flex-1 truncate font-medium normal-case tracking-normal text-foreground">
              {selectedSectionId}
            </span>
          </h2>
        ) : (
          <h2 className="flex-1 text-left text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Document
          </h2>
        )}
        {control && onDuplicateControl && onDeleteControl && (
          <div className="flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="size-7 text-muted-foreground hover:text-foreground"
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
                    className="size-7 text-destructive hover:bg-destructive/10 hover:text-destructive"
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

      {relevantErrors.length > 0 && (
        <div className="space-y-1 rounded-md border border-destructive/20 bg-destructive/10 px-2.5 py-2">
          {relevantErrors.map((error) => (
            <p
              key={error.path + error.message}
              className="text-[11px] leading-tight text-destructive"
            >
              {error.message}
            </p>
          ))}
          {errors.length > 3 && (
            <p className="text-[11px] text-destructive/60">
              +{errors.length - 3} more
            </p>
          )}
        </div>
      )}

      <div className="space-y-5">
        {!control && !section && (
          <DocumentMeta document={document} onDraftChange={onDraftChange} />
        )}

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
            section={section}
            document={document}
            fieldErrors={fieldErrors}
            locks={locks}
            onToggleLock={onToggleLock}
            onDraftChange={onDraftChange}
            onAddHitzone={onAddHitzone}
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
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <Label
          htmlFor="doc-name"
          className="w-12 shrink-0 text-xs font-medium text-muted-foreground"
        >
          Name
        </Label>
        <Input
          id="doc-name"
          className="flex-1 h-8"
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
      <div className="space-y-1.5 rounded-lg border border-border bg-card px-3 py-2">
        <InfoRow label="ID" value={document.id} />
        <InfoRow label="Schema" value={`v${document.schemaVersion}`} />
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className="truncate font-mono text-[11px] text-muted-foreground">
        {value}
      </span>
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
  const isCenter = section.id === 'center';
  const controlMin =
    section.controls.length === 0
      ? 0.1
      : Math.max(
          0.1,
          Math.max(
            ...section.controls.map((c) => Math.abs(c.geometry.position.x)),
          ) *
            2 +
            1e-6,
        );
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

  if (isCenter) {
    const leftW = document.sections[0].relativeWidth;
    const rightW = document.sections[2].relativeWidth;
    return (
      <div className="space-y-3">
        <h3 className="text-xs font-semibold text-foreground">
          Section · center (auto)
        </h3>
        <div className="rounded-lg border bg-[color-mix(in_oklch,var(--muted)_30%,var(--card))] p-2.5 space-y-3">
          <div className="flex items-center justify-between gap-2 rounded bg-muted/50 px-2.5 py-2">
            <span className="text-xs font-medium text-muted-foreground">
              Width
            </span>
            <span className="font-mono text-xs text-foreground">auto</span>
          </div>
          <p className="text-[11px] leading-snug text-muted-foreground">
            Fills remaining viewport:{' '}
            <span className="font-mono">
              viewportWidth − {leftW.toFixed(2)} − {rightW.toFixed(2)}
            </span>
          </p>
          <NumberField
            label="Min width"
            labelWidth="w-20"
            value={section.relativeMinWidth ?? 0}
            min={controlMin}
            max={4}
            step={0.01}
            note={`min for controls ${controlMin.toFixed(2)} · 0 = no minimum`}
            error={fieldErrors.get('relativeMinWidth')}
            onChange={updateMinWidth}
          />
          {section.relativeMinWidth !== undefined &&
            section.relativeMinWidth < controlMin - 1e-9 && (
              <p className="text-[11px] leading-tight text-amber-600 dark:text-amber-400">
                Min {section.relativeMinWidth.toFixed(2)} is below control
                requirement {controlMin.toFixed(2)} — controls may clip on
                narrow viewports.
              </p>
            )}
        </div>
        <p className="text-[11px] leading-[1.4] text-muted-foreground">
          Center width is derived from the viewport and side widths. Set only
          its minimum.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold text-foreground">Section</h3>
      <div className="rounded-lg border bg-[color-mix(in_oklch,var(--muted)_30%,var(--card))] p-2.5 space-y-3">
        <NumberField
          label="Width"
          labelWidth="w-20"
          value={section.relativeWidth}
          min={Number(controlMin.toFixed(2))}
          max={4}
          step={0.01}
          error={fieldErrors.get('relativeWidth')}
          onChange={updateWidth}
        />
        {section.relativeWidth < controlMin - 1e-9 && (
          <p className="text-[11px] leading-tight text-destructive">
            Width {section.relativeWidth.toFixed(2)} is below control limit{' '}
            {controlMin.toFixed(2)} — controls would be outside. Move the
            furthest controls inward to shrink further.
          </p>
        )}
      </div>
      <p className="text-[11px] leading-[1.4] text-muted-foreground">
        Width in viewport-height units. Divider drag stops at the minimum needed
        to keep controls inside.
      </p>
    </div>
  );
}

function ControlFields({
  control,
  section,
  document,
  fieldErrors,
  locks,
  onToggleLock,
  onDraftChange,
  onAddHitzone,
}: {
  control: Control;
  section: Section;
  document: LayoutDocument;
  fieldErrors: Map<string, string>;
  locks: Record<string, boolean>;
  onToggleLock: (id: string) => void;
  onDraftChange: (next: LayoutDocument, commit: boolean) => void;
  onAddHitzone?: (parentId: string) => void;
}) {
  const locked = resolveAspectLock(control, locks);
  const allowed = getAllowedBindings(control.type);
  const isDpad = control.type === 'dpad';
  const isHitzone = control.type === 'hitzone';

  const update = (fields: Partial<Control>) => {
    const next = structuredClone(document);
    const found = findControl(next, control.id);
    if (!found) return;
    Object.assign(found.control, fields);
    onDraftChange(next, true);
  };

  if (isHitzone) {
    const parent = document.sections
      .flatMap((s) => s.controls)
      .find((c) => c.id === control.parentId);
    const binding = parent?.binding ?? '—';
    const parentIdCap = control.parentId
      ? control.parentId.charAt(0).toUpperCase() + control.parentId.slice(1)
      : '—';
    const bindingCap =
      binding !== '—'
        ? binding.charAt(0).toUpperCase() + binding.slice(1)
        : '—';
    const isSame =
      binding !== '—' && parent?.id?.toLowerCase() === binding.toLowerCase();
    const sameSection = document.sections.find(
      (candidate) => candidate.id === section.id,
    );
    const parentCandidates =
      sameSection?.controls.filter(
        (candidate) => candidate.type !== 'hitzone',
      ) ?? [];
    return (
      <div className="space-y-3">
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-foreground">
            Hitzone → {parentIdCap}
            {binding !== '—' && !isSame ? ` (${bindingCap})` : ''}
          </h3>
          <InfoRow label="Type" value="Hitzone" />
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2.5">
            <p className="text-xs font-medium leading-none tracking-wide text-amber-700 dark:text-amber-300">
              Invisible hit area, extends parent touch zone
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Label className="w-14 shrink-0 text-xs font-medium text-muted-foreground">
              Parent
            </Label>
            <Select
              value={control.parentId ?? ''}
              onValueChange={(value) => {
                if (value) update({ parentId: value } as Partial<Control>);
              }}
            >
              <SelectTrigger className="flex-1 h-8">
                <SelectValue placeholder="Select parent" />
              </SelectTrigger>
              <SelectContent>
                {parentCandidates.map((candidate) => (
                  <SelectItem key={candidate.id} value={candidate.id}>
                    <span className="flex items-center gap-1.5">
                      <span className="font-mono text-xs">{candidate.id}</span>
                      <span className="text-muted-foreground text-xs">
                        {candidate.label ? `${candidate.label}` : ''}
                        {candidate.label && candidate.binding ? ' · ' : ''}
                        {candidate.binding ? `${candidate.binding}` : ''}
                      </span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {fieldErrors.get('parentId') && (
            <p className="ml-17 text-[11px] text-destructive">
              {fieldErrors.get('parentId')}
            </p>
          )}
        </div>

        <div className="flex items-center gap-3">
          <Label className="w-14 shrink-0 text-xs font-medium text-muted-foreground">
            Shape
          </Label>
          <Select
            value={control.shape ?? 'rect'}
            onValueChange={(value) => {
              if (value) update({ shape: value as 'round' | 'rect' });
            }}
          >
            <SelectTrigger className="flex-1 h-8">
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
        {fieldErrors.get('shape') && (
          <p className="ml-17 text-[11px] text-destructive">
            {fieldErrors.get('shape')}
          </p>
        )}

        <GeometrySection
          control={control}
          document={document}
          fieldErrors={fieldErrors}
          locked={locked}
          onToggleLock={onToggleLock}
          onDraftChange={onDraftChange}
        />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-baseline gap-1 min-w-0">
        <h3 className="text-sm font-semibold leading-none tracking-tight text-foreground truncate">
          {control.label || control.id}
        </h3>
        <span className="shrink-0 text-[10px] leading-none text-muted-foreground">
          ·
        </span>
        <span className="shrink-0 truncate font-mono text-[11px] leading-none text-muted-foreground">
          {control.type}
        </span>
        <span className="shrink-0 text-[10px] leading-none text-muted-foreground">
          ·
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] leading-none text-muted-foreground">
          {control.id}
        </span>
      </div>

      <div className="space-y-1">
        <div className="flex items-center gap-3">
          <Label
            htmlFor={`label-${control.id}`}
            className="w-14 shrink-0 text-xs font-medium text-muted-foreground"
          >
            Label
          </Label>
          <Input
            id={`label-${control.id}`}
            className="flex-1 h-8"
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
        {fieldErrors.get('label') && (
          <p className="ml-17 text-[11px] text-destructive">
            {fieldErrors.get('label')}
          </p>
        )}
      </div>

      {(control.type === 'button' || control.type === 'trigger') && (
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <Label
              htmlFor={`sublabel-${control.id}`}
              className="w-14 shrink-0 text-xs font-medium text-muted-foreground"
            >
              Sublabel
            </Label>
            <Input
              id={`sublabel-${control.id}`}
              className="flex-1 h-8"
              placeholder="e.g. Dash"
              maxLength={20}
              value={control.subLabel ?? ''}
              onChange={(event) => {
                const next = structuredClone(document);
                const found = findControl(next, control.id);
                if (found) found.control.subLabel = event.target.value;
                onDraftChange(next, false);
              }}
              onBlur={(event) => {
                const next = structuredClone(document);
                const found = findControl(next, control.id);
                if (found) {
                  const raw = (event.target as HTMLInputElement).value;
                  const ctl = found.control;
                  if (raw.trim() === '') delete ctl.subLabel;
                  else ctl.subLabel = raw;
                  onDraftChange(next, true);
                }
              }}
            />
          </div>
          {fieldErrors.get('subLabel') && (
            <p className="ml-17 text-[11px] text-destructive">
              {fieldErrors.get('subLabel')}
            </p>
          )}
        </div>
      )}

      {allowed.length > 0 && !isDpad && (
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <Label className="w-14 shrink-0 text-xs font-medium text-muted-foreground">
              Binding
            </Label>
            <Select
              value={control.binding ?? ''}
              onValueChange={(value) => {
                if (value) update({ binding: value as Control['binding'] });
              }}
            >
              <SelectTrigger className="flex-1 h-8 capitalize">
                <SelectValue placeholder="Select binding" />
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
          {fieldErrors.get('binding') && (
            <p className="ml-17 text-[11px] text-destructive">
              {fieldErrors.get('binding')}
            </p>
          )}
        </div>
      )}

      {!isDpad && (
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <Label className="w-14 shrink-0 text-xs font-medium text-muted-foreground">
              Shape
            </Label>
            <Select
              value={control.shape ?? 'round'}
              onValueChange={(value) => {
                if (value) update({ shape: value as 'round' | 'rect' });
              }}
            >
              <SelectTrigger className="flex-1 h-8">
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
      )}
      {(() => {
        const canUseHitShape =
          control.type !== 'dpad' &&
          control.type !== 'hitzone' &&
          control.type !== 'label';
        const canToggleHitShape = canUseHitShape && control.shape === 'round';
        const canAddHitzone =
          !!onAddHitzone &&
          control.type !== 'hitzone' &&
          control.type !== 'label';
        if (!canUseHitShape && !canAddHitzone) return null;
        const hitRect =
          (control as unknown as { hitShape?: string }).hitShape === 'rect';
        const toggleHitShape = () => {
          const next = structuredClone(document);
          const found = findControl(next, control.id);
          if (!found) return;
          if (hitRect) {
            delete (found.control as unknown as Record<string, unknown>)
              .hitShape;
          } else {
            (found.control as unknown as Record<string, unknown>).hitShape =
              'rect';
          }
          onDraftChange(next, true);
        };
        return (
          <div className="space-y-2 pt-3">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-xs font-semibold tracking-wide text-foreground uppercase">
                Touch Area
              </h4>
              <span className="text-[10px] font-mono text-muted-foreground/55">
                hitShape · hitzone
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {/* Shape Fit toggle — precise vs forgiving */}
              <Tooltip>
                <TooltipTrigger
                  closeOnClick={false}
                  render={
                    <button
                      type="button"
                      disabled={!canToggleHitShape}
                      aria-pressed={hitRect}
                      aria-label={
                        hitRect
                          ? 'Hit area: rectangle, corners active'
                          : 'Hit area: ellipse only, corners dead'
                      }
                      onClick={toggleHitShape}
                      className={[
                        'group relative flex aspect-[1/0.95] flex-col items-center justify-between overflow-hidden rounded-[14px] border p-2.5 text-center transition-all duration-150 ease-out',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
                        hitRect
                          ? 'border-foreground/15 bg-muted shadow-none'
                          : 'border-border bg-card hover:border-muted-foreground/30 hover:bg-card',
                        !canToggleHitShape
                          ? 'opacity-40 cursor-not-allowed hover:bg-card hover:border-border'
                          : 'cursor-pointer active:scale-[0.98]',
                      ].join(' ')}
                    >
                      <div className="flex flex-1 items-center justify-center py-1">
                        {hitRect ? <ForgivingHitIcon /> : <PreciseHitIcon />}
                      </div>
                      <div className="w-full">
                        <p className="text-xs font-semibold leading-none tracking-tight text-foreground">
                          {hitRect ? 'Touch on Rectangle' : 'Touch on Ellipse'}
                        </p>
                      </div>
                    </button>
                  }
                />
                <TooltipContent
                  side="top"
                  className="max-w-[220px] text-center leading-snug"
                >
                  {canToggleHitShape
                    ? hitRect
                      ? 'Full bounding box rectangle is the touch zone'
                      : 'Shape is the touch zone, corners are dead zones'
                    : !canUseHitShape
                      ? 'This control doesnt support this toggle'
                      : 'This control is only available for Round shape'}
                </TooltipContent>
              </Tooltip>

              {/* Add Hitzone — create invisible extender */}
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      disabled={!canAddHitzone}
                      onClick={() => canAddHitzone && onAddHitzone(control.id)}
                      aria-label="Add hitzone — extend touch beyond shape"
                      className={[
                        'group relative flex aspect-[1/0.95] flex-col items-center justify-between overflow-hidden rounded-[14px] border-2 p-2.5 text-center transition-all duration-150 ease-out',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
                        canAddHitzone
                          ? 'border-dashed border-[color-mix(in_oklch,var(--muted-foreground)_26%,var(--border))] bg-card hover:border-solid hover:border-[var(--editor-accent)] hover:bg-card cursor-pointer active:scale-[0.98]'
                          : 'border-dashed border-muted bg-muted/20 opacity-40 cursor-not-allowed',
                      ].join(' ')}
                    >
                      <div className="flex flex-1 items-center justify-center py-1">
                        <HitzoneAddIcon />
                      </div>
                      <div className="w-full">
                        <p className="flex items-center justify-center gap-1 text-xs font-semibold leading-none tracking-tight text-foreground">
                          Add Hitzone
                          <span className="grid size-3 place-items-center rounded-full bg-[var(--editor-accent)] text-[9px] leading-none text-white shadow-sm transition-transform group-hover:scale-110">
                            +
                          </span>
                        </p>
                      </div>
                    </button>
                  }
                />
                <TooltipContent
                  side="top"
                  className="max-w-[220px] text-center leading-snug"
                >
                  {canAddHitzone
                    ? 'Create an invisible touch area for this control'
                    : 'This control cant have hitzones'}
                </TooltipContent>
              </Tooltip>
            </div>
            {fieldErrors.get('hitShape') && (
              <p className="text-[11px] text-destructive">
                {fieldErrors.get('hitShape')}
              </p>
            )}
          </div>
        );
      })()}

      <GeometrySection
        control={control}
        document={document}
        fieldErrors={fieldErrors}
        locked={locked}
        onToggleLock={onToggleLock}
        onDraftChange={onDraftChange}
      />
    </div>
  );
}

function GeometrySection({
  control,
  document,
  fieldErrors,
  locked,
  onToggleLock,
  onDraftChange,
}: {
  control: Control;
  document: LayoutDocument;
  fieldErrors: Map<string, string>;
  locked: boolean;
  onToggleLock: (id: string) => void;
  onDraftChange: (next: LayoutDocument, commit: boolean) => void;
}) {
  const shiftHeld = useIsShiftHeld();
  const forced = isAspectLockForced(control);
  const displayLocked = locked || shiftHeld;
  const sizeClipboard = useEditorStore((s) => s.sizeClipboard);
  const setSizeClipboard = useEditorStore((s) => s.setSizeClipboard);
  const [copied, setCopied] = useState(false);
  const copiedTimeoutRef = useRef<number | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: control.id re-runs copy feedback on selection change; the effect only writes stable setState
  useEffect(() => {
    setCopied(false);
  }, [control.id]);

  useEffect(() => {
    return () => {
      if (copiedTimeoutRef.current)
        window.clearTimeout(copiedTimeoutRef.current);
    };
  }, []);

  const handleResetToSquare = () => {
    const next = structuredClone(document);
    const found = findControl(next, control.id);
    if (!found) return;
    const { size } = found.control.geometry;
    const avg = (size.width + size.height) / 2;
    const clamped = Math.min(Math.max(avg, 0.01), 2);
    found.control.geometry.size.width = clamped;
    found.control.geometry.size.height = clamped;
    onDraftChange(next, true);
  };

  const handleCopySize = () => {
    const w = control.geometry.size.width;
    const h = control.geometry.size.height;
    setSizeClipboard({ width: w, height: h });
    setCopied(true);
    if (copiedTimeoutRef.current) window.clearTimeout(copiedTimeoutRef.current);
    copiedTimeoutRef.current = window.setTimeout(() => setCopied(false), 1200);
    const text = `${formatNumber(w)}×${formatNumber(h)}`;
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
  };

  const handlePasteSize = () => {
    if (!sizeClipboard) return;
    const next = structuredClone(document);
    const found = findControl(next, control.id);
    if (!found) return;
    found.control.geometry.size.width = sizeClipboard.width;
    found.control.geometry.size.height = sizeClipboard.height;
    onDraftChange(next, true);
  };

  const hasClipboard = !!sizeClipboard;
  const isSameSize =
    hasClipboard &&
    Math.abs(sizeClipboard.width - control.geometry.size.width) < 1e-4 &&
    Math.abs(sizeClipboard.height - control.geometry.size.height) < 1e-4;
  const pasteDisabled = !hasClipboard || isSameSize;

  return (
    <div className="space-y-3 border-t border-border/60 pt-5">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-xs font-semibold tracking-wide text-foreground uppercase">
          Geometry
        </h4>
        <div className="flex items-center gap-1.5">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant={displayLocked ? 'secondary' : 'outline'}
                  size="sm"
                  disabled={forced}
                  className={`h-7 gap-1.5 px-2.5 text-xs font-medium ${displayLocked ? 'bg-primary text-primary-foreground hover:bg-primary/90' : ''} ${forced ? 'opacity-70' : ''}`}
                  onClick={() => onToggleLock(control.id)}
                >
                  {displayLocked ? (
                    <>
                      <Lock className="size-3" />
                      {forced || !shiftHeld || locked ? 'Locked' : 'Locked (⇧)'}
                    </>
                  ) : (
                    <>
                      <Unlock className="size-3" />
                      Free
                    </>
                  )}
                </Button>
              }
            />
            <TooltipContent side="top">
              {forced
                ? 'Joysticks stay square'
                : !displayLocked
                  ? 'Lock aspect ratio (hold Shift)'
                  : shiftHeld && !locked
                    ? 'Shift held, temporarily locked'
                    : 'Unlock aspect ratio'}
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 w-7 p-0"
                  onClick={handleResetToSquare}
                  aria-label="Reset to Square"
                >
                  <Square className="size-3.5" />
                </Button>
              }
            />
            <TooltipContent side="top">Reset to Square</TooltipContent>
          </Tooltip>
        </div>
      </div>

      <div className="rounded-lg border bg-[color-mix(in_oklch,var(--muted)_30%,var(--card))] p-2.5">
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
                if (displayLocked) {
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
                if (displayLocked) {
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
          <p className="mt-2 text-[11px] leading-tight text-destructive">
            {fieldErrors.get('geometry')}
          </p>
        )}
        <div className="mt-2.5 grid grid-cols-2 gap-1.5 border-t border-border/40 pt-2.5">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 w-full gap-1.5 px-2.5 text-xs font-medium active:scale-[0.98] transition-transform"
                  onClick={handleCopySize}
                  aria-label="Copy size"
                >
                  {copied ? (
                    <Check className="size-3.5 text-emerald-600 dark:text-emerald-400" />
                  ) : (
                    <Copy className="size-3.5" />
                  )}
                  {copied ? 'Copied' : 'Copy size'}
                </Button>
              }
            />
            <TooltipContent side="top">Copy width × height</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 w-full gap-1.5 px-2.5 text-xs font-medium active:scale-[0.98] transition-transform disabled:opacity-40"
                  onClick={handlePasteSize}
                  disabled={pasteDisabled}
                  aria-label="Paste size"
                >
                  <ClipboardPaste className="size-3.5" />
                  Paste
                </Button>
              }
            />
            <TooltipContent side="top">
              {!hasClipboard
                ? 'No size copied'
                : isSameSize
                  ? 'Already same size'
                  : 'Paste copied size'}
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
      <p className="text-[11px] leading-[1.4] text-muted-foreground">
        X and Y are relative to the center of the section, in viewport-height
        fractions. W and H are size in the same units.
      </p>
    </div>
  );
}

function PreciseHitIcon() {
  return (
    <svg
      viewBox="0 0 120 120"
      width="72"
      height="72"
      className="shrink-0"
      aria-hidden="true"
    >
      <defs>
        <pattern
          id="precise-dashHatch"
          width="9"
          height="9"
          patternTransform="rotate(45)"
          patternUnits="userSpaceOnUse"
        >
          <line
            x1="0"
            y1="0"
            x2="0"
            y2="9"
            stroke="var(--editor-accent)"
            strokeWidth="2.6"
            strokeDasharray="3.2,3.2"
            strokeOpacity="1"
          />
        </pattern>
        <clipPath id="precise-circleClip">
          <circle cx="60" cy="60" r="52" />
        </clipPath>
      </defs>
      {/* hatched circle — only ellipse is active, corners dead */}
      <g clipPath="url(#precise-circleClip)">
        <rect
          x="5"
          y="5"
          width="110"
          height="110"
          fill="url(#precise-dashHatch)"
        />
      </g>
      <circle
        cx="60"
        cy="60"
        r="52"
        fill="none"
        stroke="var(--editor-accent)"
        strokeWidth="3"
      />
      {/* bounding box — faint, dead corners */}
      <rect
        x="5"
        y="5"
        width="110"
        height="110"
        fill="none"
        stroke="var(--muted-foreground)"
        strokeOpacity="0.68"
        strokeWidth="1.7"
      />
    </svg>
  );
}

function ForgivingHitIcon() {
  return (
    <svg
      viewBox="0 0 120 120"
      width="72"
      height="72"
      className="shrink-0"
      aria-hidden="true"
    >
      <defs>
        <pattern
          id="forgiving-dashHatch"
          width="9"
          height="9"
          patternTransform="rotate(45)"
          patternUnits="userSpaceOnUse"
        >
          <line
            x1="0"
            y1="0"
            x2="0"
            y2="9"
            stroke="var(--editor-accent)"
            strokeWidth="2.6"
            strokeDasharray="3.2,3.2"
            strokeOpacity="1"
          />
        </pattern>
      </defs>
      {/* hatched square — full box active, corners count */}
      <rect
        x="5"
        y="5"
        width="110"
        height="110"
        fill="url(#forgiving-dashHatch)"
      />
      <rect
        x="5"
        y="5"
        width="110"
        height="110"
        fill="none"
        stroke="var(--editor-accent)"
        strokeWidth="2"
      />
      <circle
        cx="60"
        cy="60"
        r="52"
        fill="none"
        stroke="var(--muted-foreground)"
        strokeOpacity="0.7"
        strokeWidth="1.6"
      />
    </svg>
  );
}

function HitzoneAddIcon() {
  return (
    <svg
      viewBox="0 0 136 84"
      width="84"
      height="52"
      className="shrink-0"
      aria-hidden="true"
    >
      <defs>
        <pattern
          id="hitzone-parent-hatch"
          width="9"
          height="9"
          patternTransform="rotate(45)"
          patternUnits="userSpaceOnUse"
        >
          <line
            x1="0"
            y1="0"
            x2="0"
            y2="9"
            stroke="var(--editor-accent)"
            strokeWidth="2.6"
            strokeDasharray="3.2,3.2"
            strokeOpacity="1"
          />
        </pattern>
        <pattern
          id="hitzone-ghost-hatch"
          width="9"
          height="9"
          patternTransform="rotate(45)"
          patternUnits="userSpaceOnUse"
        >
          <line
            x1="0"
            y1="0"
            x2="0"
            y2="9"
            stroke="var(--muted-foreground)"
            strokeWidth="2.6"
            strokeDasharray="3.2,3.2"
            strokeOpacity="0.9"
          />
        </pattern>
        <clipPath id="hitzone-parent-clip">
          <circle cx="42" cy="42" r="40" />
        </clipPath>
      </defs>
      {/* parent — hatched circle, accent — ~1.7x larger */}
      <g clipPath="url(#hitzone-parent-clip)">
        <rect
          x="2"
          y="2"
          width="80"
          height="80"
          fill="url(#hitzone-parent-hatch)"
        />
      </g>
      <circle
        cx="42"
        cy="42"
        r="40"
        fill="none"
        stroke="var(--editor-accent)"
        strokeWidth="2.4"
      />
      {/* ghost — hatched square (full), yellow dashed */}
      <rect
        x="90"
        y="20"
        width="40"
        height="40"
        fill="url(#hitzone-parent-hatch)"
        stroke="rgb(250 204 21)"
        strokeOpacity="1"
        strokeWidth="1.2"
        strokeDasharray="7 3"
        rx="1"
      />
      <circle
        cx="110"
        cy="40"
        r="17.5"
        fill="none"
        stroke="var(--muted-foreground)"
        strokeOpacity="0.18"
        strokeWidth="1.2"
        strokeDasharray="3 3"
      />
      {/* plus badge */}
      <g transform="translate(123 57)">
        <circle
          r="13"
          fill="var(--editor-accent)"
          stroke="var(--card)"
          strokeWidth="2"
        />
        <path
          d="M -5.2 0 H 5.2 M 0 -5.2 V 5.2"
          stroke="white"
          strokeWidth="2.1"
          strokeLinecap="round"
        />
      </g>
    </svg>
  );
}

function NumberField({
  label,
  labelWidth = 'min-w-6',
  value,
  min,
  max,
  step: _step = 0.01,
  error,
  note,
  onChange,
}: {
  label: string;
  labelWidth?: string;
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
    <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 items-center">
      <Label
        className={`shrink-0 text-[11px] font-medium text-muted-foreground text-center ${labelWidth}`}
      >
        {label}
      </Label>
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
        className={`min-w-0 h-7 font-mono text-xs ${invalid ? 'border-destructive bg-destructive/10 text-destructive focus-visible:border-destructive focus-visible:ring-destructive/20' : ''}`}
      />
      {error && (
        <p className="col-start-2 text-[11px] leading-tight text-destructive">
          {error}
        </p>
      )}
      {note && !error && (
        <p className="col-start-2 text-[11px] leading-tight text-muted-foreground">
          {note}
        </p>
      )}
    </div>
  );
}

function formatNumber(value: number): string {
  return value.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
}
