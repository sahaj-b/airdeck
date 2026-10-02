import { describe, expect, it } from 'vitest';
import { CapabilityManager } from './capabilities';

function fakeManager(overrides: {
  requestFullscreen: () => Promise<void>;
  lock: () => Promise<void>;
}) {
  const order: string[] = [];
  const document = {
    documentElement: {
      requestFullscreen: () => {
        order.push('fullscreen');
        return overrides.requestFullscreen();
      },
    },
    fullscreenElement: null as Element | null,
    hidden: false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    exitFullscreen: () => {
      order.push('exit-fullscreen');
      return Promise.resolve();
    },
  };
  const screen = {
    orientation: {
      lock: () => {
        order.push('lock');
        return overrides.lock();
      },
      unlock: () => {
        order.push('unlock');
      },
    },
  };
  const manager = new CapabilityManager({
    document: document as unknown as Document,
    navigator: {} as Navigator,
    screen: screen as unknown as Screen,
    window: {} as Window,
  });
  return { manager, order, document };
}

describe('CapabilityManager join grants', () => {
  it('locks orientation only after the fullscreen grant resolves', async () => {
    let grantFullscreen!: () => void;
    const gate = new Promise<void>((resolve) => {
      grantFullscreen = resolve;
    });
    const { manager, order } = fakeManager({
      requestFullscreen: () => gate,
      lock: () => Promise.resolve(),
    });
    const pending = manager.requestJoinCapabilities();
    // Flush microtasks: a raced lock() would already have fired.
    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual(['fullscreen']);
    grantFullscreen();
    await pending;
    expect(order).toEqual(['fullscreen', 'lock']);
    manager.destroy();
  });

  it('still attempts orientation when fullscreen is rejected', async () => {
    const { manager, order } = fakeManager({
      requestFullscreen: () => Promise.reject(new Error('denied')),
      lock: () => Promise.resolve(),
    });
    const status = await manager.requestJoinCapabilities();
    expect(order).toEqual(['fullscreen', 'lock']);
    expect(status.fullscreen).toBe(false);
    expect(status.orientation).toBe(true);
    manager.destroy();
  });

  it('releases fullscreen and orientation on the way back out', () => {
    const { manager, order, document } = fakeManager({
      requestFullscreen: () => Promise.resolve(),
      lock: () => Promise.resolve(),
    });
    manager.releaseJoinCapabilities();
    expect(order).toEqual(['unlock']);
    document.fullscreenElement = {} as Element;
    manager.releaseJoinCapabilities();
    expect(order).toEqual(['unlock', 'exit-fullscreen', 'unlock']);
    manager.destroy();
  });
});
