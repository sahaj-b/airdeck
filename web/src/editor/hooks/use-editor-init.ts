import { useEffect } from 'react';
import { getAdminLayout, getAdminState } from '@/dashboard/api';
import type { Document as LayoutDocument } from '@/shared/generated/layout';
import { cloneDocument } from '@/shared/layout-editor';
import { useEditorStore } from '../store/editor-store';

export function useEditorInit(): void {
  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      try {
        const state = await getAdminState();
        if (cancelled) return;
        useEditorStore.getState().setLayouts(state.layouts);
        useEditorStore.getState().setConfig(state.config);
        const params = new URLSearchParams(window.location.search);
        const paramId = params.get('layout');
        const targetId =
          paramId || state.config.defaultLayout || state.layouts[0]?.id;
        if (targetId) {
          try {
            const doc = await getAdminLayout(targetId);
            if (cancelled) return;
            const cloned = cloneDocument(doc as LayoutDocument);
            useEditorStore.getState().resetDocument(cloned);
            if (!paramId) useEditorStore.getState().setPickerOpen(true);
          } catch {
            if (!cancelled && paramId)
              useEditorStore.getState().setPickerOpen(true);
          }
        } else if (!paramId) {
          useEditorStore.getState().setPickerOpen(true);
        }
      } catch {
        // leave empty state for local dev without host
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);
}
