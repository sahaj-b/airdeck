import { ChevronLeftIcon, Circle, CircleCheck } from 'lucide-react';
import { useStore } from 'zustand';
import { Button } from '@/components/ui/button';
import { SKINS } from '@/skins';
import { setSkin } from '@/skins/loader';
import type { MountOptions } from './settings-island';

interface SkinsSheetProps {
  opts: MountOptions;
  onBack: () => void;
}

export function SkinsSheet({ opts, onBack }: SkinsSheetProps) {
  const store = opts.store;
  const skin = useStore(store, (s) => s.skin);
  const setStoreSkin = useStore(store, (s) => s.setSkin);

  const handlePick = (id: string) => {
    if (id === skin) return;
    setStoreSkin(id);
    setSkin(id);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onBack}
          aria-label="Back to settings"
        >
          <ChevronLeftIcon className="size-4" />
        </Button>
        <h3 className="text-sm font-semibold">Skins</h3>
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">
          {SKINS.length}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {SKINS.map((s) => {
          const isSelected = s.id === skin;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => handlePick(s.id)}
              aria-pressed={isSelected}
              className={`flex items-center gap-2.5 rounded-xl border p-2.5 text-left transition-colors active:scale-[0.98] ${
                isSelected
                  ? 'border-primary/40 bg-primary/10'
                  : 'border-white/10 bg-white/[0.04] hover:bg-accent/40'
              }`}
            >
              <span
                aria-hidden="true"
                className="grid size-8 shrink-0 place-items-center rounded-full border border-white/20 bg-black/40 text-xs font-bold uppercase"
              >
                {s.name.slice(0, 1)}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                {s.name}
              </span>
              {isSelected ? (
                <CircleCheck className="size-4 shrink-0 text-primary" />
              ) : (
                <Circle className="size-4 shrink-0 text-muted-foreground/30" />
              )}
            </button>
          );
        })}
      </div>

      <p className="text-xs leading-relaxed text-muted-foreground">
        Skins only change how the controller looks. Layout and input stay the
        same.
      </p>
    </div>
  );
}
