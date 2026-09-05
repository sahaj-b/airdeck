import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Control } from '@/shared/generated/layout';
import type { Command } from '@/shared/generated/protocol';
import { getBindingLabel } from '@/shared/layout-editor';
import { PsCircle, PsCross, PsSquare, PsTriangle } from './playstation-icons';

const PS_ICON_MAP: Record<
  string,
  React.ComponentType<{ size?: number; className?: string }>
> = {
  Cross: PsCross,
  Circle: PsCircle,
  Square: PsSquare,
  Triangle: PsTriangle,
};

const DPAD_ICON_MAP: Record<
  string,
  React.ComponentType<{ size?: number; className?: string }>
> = {
  'D-pad Up': ChevronUp,
  'D-pad Down': ChevronDown,
  'D-pad Left': ChevronLeft,
  'D-pad Right': ChevronRight,
  dpadUp: ChevronUp,
  dpadDown: ChevronDown,
  dpadLeft: ChevronLeft,
  dpadRight: ChevronRight,
};

const NO_BRACKET = new Set([
  'guide',
  'start',
  'back',
  'Guide',
  'Start',
  'Back',
]);

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function BindingLabel({
  command,
  controlType,
}: {
  command: Command;
  controlType?: Control['type'];
}) {
  if (NO_BRACKET.has(command)) {
    return <span>{capitalize(command)}</span>;
  }
  const raw = getBindingLabel(command, controlType);
  // raw is like "South (A | Cross)" or "DpadUp (D-pad Up)" etc
  // D-pad: use chevron inside bracket instead of text
  const dpadMatch = raw.match(/^(.*) \((D-pad.*)\)$/);
  if (dpadMatch) {
    const [, cmd, dir] = dpadMatch;
    const Chevron = DPAD_ICON_MAP[dir] ?? DPAD_ICON_MAP[cmd];
    if (Chevron) {
      return (
        <span>
          <span>{capitalize(cmd)}</span>
          <span className="text-muted-foreground/60"> (</span>
          <Chevron
            size={11}
            className="inline-block shrink-0 align-middle text-muted-foreground/60"
          />
          <span className="text-muted-foreground/60">)</span>
        </span>
      );
    }
  }
  // For the 4 face buttons, replace PlayStation name with SVG
  const match = raw.match(/^(.*) \((.*) \| (.*)\)$/);
  if (!match) {
    const single = raw.match(/^(.*) \((.*)\)$/);
    if (single) {
      const [, singleCmd, inside] = single;
      return (
        <span>
          <span>{capitalize(singleCmd)}</span>
          <span className="text-muted-foreground/60"> ({inside})</span>
        </span>
      );
    }
    return <span>{raw}</span>;
  }
  const [, cmd, xbox, ps] = match;
  const PsIcon = PS_ICON_MAP[ps];
  if (!PsIcon) {
    return (
      <span>
        <span>{capitalize(cmd)}</span>
        <span className="text-muted-foreground/60">
          {' '}
          ({xbox} | {ps})
        </span>
      </span>
    );
  }
  const nudgeUp = ps === 'Cross' || ps === 'Square' || ps === 'Triangle';
  return (
    <span>
      <span>{capitalize(cmd)}</span>
      <span className="text-muted-foreground/60"> ({xbox} | </span>
      <PsIcon
        size={6}
        className={cn(
          'inline-block shrink-0 align-middle -ml-[1.5px] text-muted-foreground/60',
          nudgeUp && '-translate-y-[0.5px]',
        )}
      />
      <span className="text-muted-foreground/60">)</span>
      <span className="sr-only">{ps}</span>
    </span>
  );
}
