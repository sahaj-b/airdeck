import type { LayoutDocument } from '@/shared/layout';
import { validateLayout } from '@/shared/layout';

const hostDocCache = new Map<string, LayoutDocument>();
const inflight = new Map<string, Promise<LayoutDocument | null>>();

export function getCachedHostLayout(id: string): LayoutDocument | undefined {
  return hostDocCache.get(id);
}

export function fetchHostLayout(id: string): Promise<LayoutDocument | null> {
  const cached = hostDocCache.get(id);
  if (cached) return Promise.resolve(cached);
  const pending = inflight.get(id);
  if (pending) return pending;
  const task = fetch(`/api/layouts/${encodeURIComponent(id)}`)
    .then(async (res) => {
      if (!res.ok) return null;
      const doc: unknown = await res.json().catch(() => null);
      if (validateLayout(doc)) {
        hostDocCache.set(id, doc);
        return doc;
      }
      return null;
    })
    .catch(() => null)
    .finally(() => {
      inflight.delete(id);
    });
  inflight.set(id, task);
  return task;
}

export function prefetchHostLayouts(ids: string[]): void {
  for (const id of ids) {
    if (!id || hostDocCache.has(id) || inflight.has(id)) continue;
    void fetchHostLayout(id);
  }
}

export function invalidateHostLayout(id: string): void {
  hostDocCache.delete(id);
}

export function invalidateAllHostLayouts(): void {
  hostDocCache.clear();
}
