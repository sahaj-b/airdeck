import { createRoot, type Root } from 'react-dom/client';
import type { FeedbackController } from '@/controller/feedback';
import { SettingsPanel } from './settings-panel';
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
}

export interface SettingsIsland {
  root: Root;
  container: HTMLElement;
  update: (opts: Partial<MountOptions>) => void;
  unmount: () => void;
  setOpen: (open: boolean) => void;
  isDestroyed: () => boolean;
}

export function mountSettingsIsland(
  hostEl: HTMLElement,
  opts: MountOptions,
): SettingsIsland {
  // dark mode: Tailwind's @custom-variant dark expects .dark ancestor
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
      <SettingsPanel
        store={currentOpts.store}
        feedback={currentOpts.feedback}
        capabilityNotes={currentOpts.capabilityNotes}
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
        layouts={currentOpts.layouts}
        selectedLayout={currentOpts.selectedLayout}
        onSelectLayout={currentOpts.onSelectLayout}
        connectionText={currentOpts.connectionText}
        pingText={currentOpts.pingText}
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
