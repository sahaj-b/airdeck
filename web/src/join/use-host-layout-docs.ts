import { useLayoutDocs } from '@/components/use-layout-docs';
import type { LayoutDocument } from '@/shared/layout';

export function useHostLayoutDocs(ids: string[]): Map<string, LayoutDocument> {
  return useLayoutDocs(ids);
}
