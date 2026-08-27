import { useEffect, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Drawer, DrawerContent } from '@/components/ui/drawer';
import type { FeedbackController } from '@/controller/feedback';
import type { GyroController, GyroStatus } from '@/controller/gyro/controller';
import { GyroSheet } from './gyro-sheet';
import { InlineSettingsPanel } from './inline-settings-panel';
import type { settingsStore } from './settings-store';

type Store = typeof settingsStore;

export interface MountOptions {
  store: Store;
  feedback: FeedbackController;
  capabilityNotes: string;
  layouts: { id: string; name: string }[];
  selectedLayout: string;
  onSelectLayout: (id: string) => void;
  connectionText: string;
  pingText: string;
  onClose?: () => void;
  gyro?: GyroController;
  gyroStatus?: GyroStatus;
  gyroLiveX?: number;
  gyroLiveY?: number;
}

export interface SettingsIsland {
  root: Root;
  container: HTMLElement;
  update: (opts: Partial<MountOptions>) => void;
  unmount: () => void;
  setOpen: (open: boolean) => void;
  isDestroyed: () => boolean;
}

function IslandRoot({
  opts,
  open,
  onOpenChange,
}: {
  opts: MountOptions;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [view, setView] = useState<'main' | 'gyro'>('main');
  const gyroStatus = opts.gyroStatus ?? 'idle';
  const liveX = opts.gyroLiveX ?? 0;
  const liveY = opts.gyroLiveY ?? 0;
  const scrollRef = useRef<HTMLDivElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset scroll on view switch
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0, behavior: 'auto' });
  }, [view]);

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      modal={true}
      swipeDirection="right"
    >
      <DrawerContent
        className="flex flex-col max-w-full"
        aria-describedby={undefined}
      >
        {view === 'main' ? (
          <div
            ref={scrollRef}
            className="flex-1 overflow-y-auto overflow-x-hidden px-4 pb-6 pt-4 min-w-0"
          >
            <InlineSettingsPanel
              opts={opts}
              onOpenGyro={() => setView('gyro')}
              onClose={() => onOpenChange(false)}
            />
          </div>
        ) : (
          <div
            ref={scrollRef}
            className="flex-1 overflow-y-auto overflow-x-hidden px-4 pb-6 pt-4 space-y-5 min-w-0"
          >
            <GyroSheet
              store={opts.store}
              gyro={opts.gyro}
              gyroStatus={gyroStatus}
              liveX={liveX}
              liveY={liveY}
              onBack={() => setView('main')}
            />
          </div>
        )}
      </DrawerContent>
    </Drawer>
  );
}

export function mountSettingsIsland(
  hostEl: HTMLElement,
  opts: MountOptions,
): SettingsIsland {
  document.documentElement.classList.add('dark');
  hostEl.classList.add('dark');

  const container = document.createElement('div');
  container.classList.add('dark');
  hostEl.append(container);
  const root = createRoot(container);

  let currentOpts = opts;
  let open = true;
  let destroyed = false;
  let closeTimer: number | undefined;

  function cleanup() {
    if (destroyed) return;
    destroyed = true;
    if (closeTimer !== undefined) window.clearTimeout(closeTimer);
    try {
      root.unmount();
    } catch {}
    container.remove();
    currentOpts.onClose?.();
  }

  function scheduleCleanup() {
    if (closeTimer !== undefined) window.clearTimeout(closeTimer);
    closeTimer = window.setTimeout(cleanup, 300);
  }

  function render() {
    if (destroyed) return;
    root.render(
      <IslandRoot
        opts={currentOpts}
        open={open}
        onOpenChange={(next) => {
          if (next === open) return;
          open = next;
          if (!next) {
            render();
            scheduleCleanup();
          } else {
            if (closeTimer !== undefined) {
              window.clearTimeout(closeTimer);
              closeTimer = undefined;
            }
            render();
          }
        }}
      />,
    );
  }

  render();

  return {
    root,
    container,
    update: (next) => {
      if (destroyed) return;
      currentOpts = { ...currentOpts, ...next };
      render();
    },
    unmount: () => {
      if (destroyed) return;
      if (!open) {
        scheduleCleanup();
        return;
      }
      open = false;
      render();
      scheduleCleanup();
    },
    setOpen: (next) => {
      if (destroyed) return;
      if (closeTimer !== undefined) {
        window.clearTimeout(closeTimer);
        closeTimer = undefined;
      }
      open = next;
      render();
    },
    isDestroyed: () => destroyed,
  };
}
