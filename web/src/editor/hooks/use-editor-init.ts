import { useEffect } from 'react';
import { getAdminLayout, getAdminState } from '@/dashboard/api';
import type { Document as LayoutDocument } from '@/shared/generated/layout';
import { validateLayoutDetailed } from '@/shared/layout';
import { cloneDocument } from '@/shared/layout-editor';
import { useEditorStore } from '../store/editor-store';

export function useEditorInit(): void {
  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      const store = useEditorStore.getState();
      store.setIsInitializing(true);
      store.setInitError(null);
      try {
        const state = await getAdminState();
        if (cancelled) return;
        store.setLayouts(state.layouts);
        store.setConfig(state.config);
        const params = new URLSearchParams(window.location.search);
        const paramId = params.get('layout');
        const targetId =
          paramId || state.config.defaultLayout || state.layouts[0]?.id;
        if (targetId) {
          try {
            const doc = await getAdminLayout(targetId);
            if (cancelled) return;
            const validation = validateLayoutDetailed(doc);
            if (!validation.valid) {
              throw new Error(
                validation.errors[0]?.message
                  ? `Layout validation failed: ${validation.errors[0].message}`
                  : 'Layout is invalid.',
              );
            }
            const cloned = cloneDocument(doc as LayoutDocument);
            store.resetDocument(cloned);
            if (!paramId) store.setPickerOpen(true);
            store.setInitError(null);
          } catch (err) {
            if (cancelled) return;
            if (paramId) {
              const msg =
                err instanceof Error ? err.message : 'Failed to load layout.';
              store.setInitError(
                `Layout "${paramId}" could not be loaded: ${msg}`,
              );
            } else {
              // no param, but default/first failed - show picker so user can choose
              store.setPickerOpen(true);
              store.setInitError(null);
            }
          }
        } else if (!paramId) {
          store.setPickerOpen(true);
          store.setInitError(null);
        } else {
          // param present but no target? shouldn't happen
          store.setInitError(`Layout "${paramId}" not found.`);
        }
      } catch (err) {
        if (cancelled) return;
        const msg =
          err instanceof Error ? err.message : 'Failed to load editor.';
        // if already have initError from inner, don't overwrite
        if (!useEditorStore.getState().initError) {
          useEditorStore.getState().setInitError(msg);
        }
      } finally {
        if (!cancelled) store.setIsInitializing(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);
}
