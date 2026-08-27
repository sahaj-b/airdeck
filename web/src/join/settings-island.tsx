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
}

export interface SettingsIsland {
  root: Root;
  container: HTMLElement;
  update: (opts: Partial<MountOptions>) => void;
  unmount: () => void;
}

export function mountSettingsIsland(
  hostEl: HTMLElement,
  opts: MountOptions,
): SettingsIsland {
  const container = document.createElement('div');
  hostEl.append(container);
  const root = createRoot(container);

  let currentOpts = opts;
  let open = true;

  function render() {
    root.render(
      <SettingsPanel
        store={currentOpts.store}
        feedback={currentOpts.feedback}
        capabilityNotes={currentOpts.capabilityNotes}
        open={open}
        onOpenChange={(next) => {
          open = next;
          if (!next) {
            // unmount after drawer close animation
            setTimeout(() => {
              root.unmount();
              container.remove();
            }, 300);
          } else {
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
      currentOpts = { ...currentOpts, ...next };
      render();
    },
    unmount: () => {
      open = false;
      render();
      setTimeout(() => {
        try {
          root.unmount();
        } catch {
          // already unmounted
        }
        container.remove();
      }, 300);
    },
  };
}
