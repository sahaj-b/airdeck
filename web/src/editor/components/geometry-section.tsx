import {
  Check,
  ClipboardPaste,
  Copy,
  Lock,
  RotateCw,
  Square,
  Unlock,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useIsShiftHeld } from '@/hooks/use-interact-geometry';
import type { Control } from '@/shared/generated/layout';
import { isAspectLockForced } from '@/shared/layout-editor';
import { useEditorStore } from '../store/editor-store';
import { formatNumber, NumberField } from './number-field';

export function GeometrySection({
  control,
  updateGeometry,
  fieldErrors,
  locked,
  onToggleLock,
}: {
  control: Control;
  updateGeometry: (mutate: (geometry: Control['geometry']) => void) => void;
  fieldErrors: Map<string, string>;
  locked: boolean;
  onToggleLock: (id: string) => void;
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

  const handleResetToSquare = () =>
    updateGeometry((geometry) => {
      const avg = (geometry.size.width + geometry.size.height) / 2;
      const clamped = Math.min(Math.max(avg, 0.01), 2);
      geometry.size.width = clamped;
      geometry.size.height = clamped;
    });

  const handleRotate90 = () =>
    updateGeometry((geometry) => {
      const { width, height } = geometry.size;
      geometry.size.width = height;
      geometry.size.height = width;
    });

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
    updateGeometry((geometry) => {
      geometry.size.width = sizeClipboard.width;
      geometry.size.height = sizeClipboard.height;
    });
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
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 w-7 p-0"
                  onClick={handleRotate90}
                  aria-label="Rotate 90 degrees"
                >
                  <RotateCw className="size-3.5" />
                </Button>
              }
            />
            <TooltipContent side="top">Rotate 90°</TooltipContent>
          </Tooltip>
        </div>
      </div>

      <div className="rounded-lg border bg-[color-mix(in_oklch,var(--muted)_30%,var(--card))] p-2.5">
        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label="X"
            value={control.geometry.position.x}
            min={-2}
            max={2}
            error={fieldErrors.get('x')}
            onChange={(v) =>
              updateGeometry((geometry) => {
                geometry.position.x = v;
              })
            }
          />
          <NumberField
            label="Y"
            value={control.geometry.position.y}
            min={-2}
            max={2}
            error={fieldErrors.get('y')}
            onChange={(v) =>
              updateGeometry((geometry) => {
                geometry.position.y = v;
              })
            }
          />
          <NumberField
            label="W"
            value={control.geometry.size.width}
            min={0.01}
            max={2}
            error={fieldErrors.get('width')}
            onChange={(v) =>
              updateGeometry((geometry) => {
                if (displayLocked) {
                  const ratio =
                    control.geometry.size.width / control.geometry.size.height;
                  geometry.size.height = v / ratio;
                }
                geometry.size.width = v;
              })
            }
          />
          <NumberField
            label="H"
            value={control.geometry.size.height}
            min={0.01}
            max={2}
            error={fieldErrors.get('height')}
            onChange={(v) =>
              updateGeometry((geometry) => {
                if (displayLocked) {
                  const ratio =
                    control.geometry.size.width / control.geometry.size.height;
                  geometry.size.width = v * ratio;
                }
                geometry.size.height = v;
              })
            }
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
