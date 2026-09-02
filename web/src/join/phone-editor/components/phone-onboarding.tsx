import {
  Copy,
  LockOpen,
  Plus,
  Redo2,
  Square,
  Trash2,
  Undo2,
} from 'lucide-react';
import type { ReactNode } from 'react';
import {
  PinchGestureIcon,
  ThreeFingerTapIcon,
  TwoFingerTapIcon,
} from './phone-icons';

interface OnboardingProps {
  onDismiss: () => void;
}

export function PhoneOnboarding({ onDismiss }: OnboardingProps) {
  const onboardingLegend: { key: string; icon: ReactNode; label: string }[] = [
    {
      key: 'delete',
      icon: (
        <span className="grid size-6 shrink-0 place-items-center rounded border border-white/15 bg-red-500/90 text-white">
          <Trash2 size={12} strokeWidth={2} />
        </span>
      ),
      label: 'Delete control',
    },
    {
      key: 'lock',
      icon: (
        <span className="grid size-6 shrink-0 place-items-center rounded border border-white/15 bg-white/10 text-white">
          <LockOpen size={12} strokeWidth={2} />
        </span>
      ),
      label: 'Lock/Unlock aspect ratio',
    },
    {
      key: 'duplicate',
      icon: (
        <span className="grid size-6 shrink-0 place-items-center rounded border border-white/15 bg-white/10 text-white">
          <Copy size={12} strokeWidth={2} />
        </span>
      ),
      label: 'Duplicate control',
    },
    {
      key: 'hitzone',
      icon: (
        <span className="grid size-6 shrink-0 place-items-center rounded border border-white/15 bg-white/10 text-white">
          <span className="relative flex size-[14px] items-center justify-center overflow-hidden rounded-[3px] border border-dashed border-yellow-400 bg-violet-500/10">
            <span
              className="absolute inset-0 opacity-30"
              style={{
                backgroundImage:
                  'repeating-linear-gradient(135deg, rgb(139 92 246 / 0.5) 0 1px, transparent 1px 7px), repeating-linear-gradient(45deg, rgb(139 92 246 / 0.5) 0 1px, transparent 1px 7px)',
              }}
            />
            <Plus size={8} className="relative text-white" strokeWidth={2.5} />
          </span>
        </span>
      ),
      label: 'Add hitzone (extend touch area)',
    },
    {
      key: 'shape',
      icon: (
        <span className="grid size-6 shrink-0 place-items-center rounded border border-white/15 bg-white/10 text-white">
          <Square size={12} strokeWidth={2} />
        </span>
      ),
      label: 'Toggle shape',
    },
    {
      key: 'undo',
      icon: (
        <span className="grid size-6 shrink-0 place-items-center rounded border border-white/20 bg-transparent text-white">
          <Undo2 size={12} strokeWidth={2} />
        </span>
      ),
      label: 'Undo',
    },
    {
      key: 'redo',
      icon: (
        <span className="grid size-6 shrink-0 place-items-center rounded border border-white/20 bg-transparent text-white">
          <Redo2 size={12} strokeWidth={2} />
        </span>
      ),
      label: 'Redo',
    },
    {
      key: 'save',
      icon: (
        <span className="grid h-[22px] w-[44px] shrink-0 place-items-center rounded-md border border-white/20 bg-white text-[11px] font-semibold text-black">
          Save
        </span>
      ),
      label: 'Save layout',
    },
  ];

  return (
    <div
      className="absolute inset-0 z-30 flex items-center justify-center bg-black/70 p-2 backdrop-blur-[2px]"
      data-phone-onboarding
      role="dialog"
      aria-label="Editor guide"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) onDismiss();
      }}
    >
      <div className="flex max-h-[92dvh] w-[98vw] max-w-[600px] flex-col overflow-hidden rounded-2xl border border-white/10 bg-black/85 backdrop-blur-xl shadow-[0_20px_60px_rgba(0,0,0,0.6)]">
        <div className="flex-1 overflow-y-auto p-3">
          <div className="grid gap-3">
            <div className="grid grid-flow-col grid-cols-3 grid-rows-3 gap-x-3 gap-y-1.5">
              {onboardingLegend.map((item) => (
                <div key={item.key} className="flex items-center gap-2 py-1">
                  {item.icon}
                  <span className="min-w-0 text-[12px] leading-none text-white">
                    <span className="text-white/40">:</span> {item.label}
                  </span>
                </div>
              ))}
            </div>

            <div className="rounded-xl border border-white/10 bg-white/[0.07] px-3 py-2.5 text-center text-[12px] font-medium leading-4 text-white">
              Touch and drag controls to select / move. Drag corners to resize.
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div className="flex flex-col items-center gap-2 px-1 py-2">
                <PinchGestureIcon className="size-[64px] text-white sm:size-[72px]" />
                <p className="text-center text-[11px] font-medium leading-tight text-white/80">
                  Pinch to <b className="text-white">Resize</b> control
                </p>
              </div>
              <div className="flex flex-col items-center gap-2 px-1 py-2">
                <TwoFingerTapIcon className="size-[64px] text-white sm:size-[72px]" />
                <p className="text-center text-[11px] font-medium leading-tight text-white/80">
                  2 finger tap to <b className="text-white">Undo</b>
                </p>
              </div>
              <div className="flex flex-col items-center gap-2 px-1 py-2">
                <ThreeFingerTapIcon className="size-[64px] text-white sm:size-[72px]" />
                <p className="text-center text-[11px] font-medium leading-tight text-white/80">
                  3 finger tap to <b className="text-white">Redo</b>
                </p>
              </div>
            </div>
          </div>
        </div>
        <div className="shrink-0 border-t border-white/10 p-3 pt-2.5">
          <button
            type="button"
            className="h-10 w-full rounded-full bg-white text-[14px] font-semibold text-black transition hover:bg-white/90 active:scale-[0.99]"
            onClick={onDismiss}
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
