import { useEffect, useMemo, useState } from 'react';
import type { LayoutDocument } from '../shared/layout';
import { fetchHostLayout, getCachedHostLayout } from './layout-docs-cache';

export function useHostLayoutDocs(ids: string[]): Map<string, LayoutDocument> {
  const [version, setVersion] = useState(0);
  const key = ids.join('\0');

  // biome-ignore lint/correctness/useExhaustiveDependencies: key is the dep
  useEffect(() => {
    let cancelled = false;
    const missing = ids.filter((id) => !getCachedHostLayout(id));
    if (missing.length === 0) return;
    void Promise.all(missing.map((id) => fetchHostLayout(id))).then(() => {
      if (!cancelled) setVersion((v) => v + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [key]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: key is the dep
  return useMemo(() => {
    const out = new Map<string, LayoutDocument>();
    for (const id of ids) {
      const doc = getCachedHostLayout(id);
      if (doc) out.set(id, doc);
    }
    return out;
  }, [key, version]);
}
