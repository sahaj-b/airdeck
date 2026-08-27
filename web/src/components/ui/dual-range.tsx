import { Slider as SliderPrimitive } from '@base-ui/react/slider';
import { cn } from '@/lib/utils';

interface DualRangeProps {
  deadzone: number;
  maxAngle: number;
  onDeadzoneChange: (v: number) => void;
  onMaxChange: (v: number) => void;
  maxLimit?: number;
  disabled?: boolean;
  live?: number;
  className?: string;
}

export function DualRange({
  deadzone,
  maxAngle,
  onDeadzoneChange,
  onMaxChange,
  maxLimit = 60,
  disabled = false,
  live,
  className,
}: DualRangeProps) {
  const dzVal = Math.round(deadzone * maxLimit);
  const maxVal = Math.round(maxAngle);
  const liveAbs = Math.max(0, Math.min(1, Math.abs(live ?? 0)));
  const livePos = dzVal + liveAbs * Math.max(0, maxVal - dzVal);
  const liveLeftPct = (dzVal / maxLimit) * 100;
  const liveWidthPct = ((livePos - dzVal) / maxLimit) * 100;

  const handleChange = (value: number[]) => {
    let [dz, mx] = value as [number, number];
    if (typeof dz !== 'number' || typeof mx !== 'number') return;
    // prevent crossing: deadzone thumb must stay at least 1 step below max thumb
    if (dz >= mx) {
      // clamp to the thumb that moved last; Base UI already reports ordered values,
      // so we bias to the smaller gap.
      if (dz !== dzVal) dz = Math.min(dz, mx - 1);
      else mx = Math.max(mx, dz + 1);
    }
    onDeadzoneChange(Math.max(0, Math.min(0.5, dz / maxLimit)));
    onMaxChange(Math.max(1, Math.min(maxLimit, mx)));
  };

  return (
    <SliderPrimitive.Root
      value={[dzVal, maxVal]}
      min={0}
      max={maxLimit}
      step={1}
      minStepsBetweenValues={1}
      disabled={disabled}
      onValueChange={handleChange}
      className={cn('data-horizontal:w-full', className)}
      data-slot="dual-range"
    >
      <SliderPrimitive.Control
        data-base-ui-swipe-ignore
        className="relative flex w-full touch-none items-center select-none data-disabled:opacity-50"
      >
        <SliderPrimitive.Track
          data-slot="slider-track"
          className="relative grow overflow-hidden rounded-full bg-muted select-none data-horizontal:h-1 data-horizontal:w-full"
        >
          <SliderPrimitive.Indicator
            data-slot="slider-range"
            className="bg-primary/30 select-none data-horizontal:h-full"
          />
          {live != null && !disabled && (
            <div
              data-slot="live-fill"
              className="absolute top-0 h-full bg-primary transition-none pointer-events-none"
              style={{ left: `${liveLeftPct}%`, width: `${liveWidthPct}%` }}
            />
          )}
          {live != null && !disabled && liveAbs > 0 && (
            <div
              data-slot="live-dot"
              className="absolute top-1/2 size-2 -translate-y-1/2 -translate-x-1/2 rounded-full bg-primary border border-white shadow-sm pointer-events-none transition-none"
              style={{ left: `${(livePos / maxLimit) * 100}%` }}
            />
          )}
        </SliderPrimitive.Track>
        <SliderPrimitive.Thumb
          data-slot="slider-thumb"
          aria-label="Deadzone"
          className="relative block size-3 shrink-0 cursor-pointer rounded-full border border-ring bg-white ring-ring/50 transition-[color,box-shadow] select-none after:absolute after:-inset-2 hover:ring-3 focus-visible:ring-3 focus-visible:outline-hidden active:ring-3"
        />
        <SliderPrimitive.Thumb
          data-slot="slider-thumb"
          aria-label="Max angle"
          className="relative block size-3 shrink-0 cursor-pointer rounded-full border border-ring bg-white ring-ring/50 transition-[color,box-shadow] select-none after:absolute after:-inset-2 hover:ring-3 focus-visible:ring-3 focus-visible:outline-hidden active:ring-3"
        />
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  );
}
