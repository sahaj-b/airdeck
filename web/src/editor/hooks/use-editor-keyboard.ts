import { useEffect } from 'react';
import { useEditorStore } from '@/editor/store/editor-store';
import { isEditableTarget } from '@/hooks/dom';
import { deleteControl } from '@/shared/layout-editor';

export function useEditorKeyboard(): void {
  useEffect(() => {
    const handle = (event: KeyboardEvent): void => {
      if (isEditableTarget(event.target)) return;
      const isMod = event.ctrlKey || event.metaKey;
      if (isMod && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) {
          useEditorStore.getState().historyRedo();
        } else {
          useEditorStore.getState().historyUndo();
        }
        return;
      }
      if (isMod && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        useEditorStore.getState().historyRedo();
        return;
      }
      if (event.key === 'Delete') {
        const store = useEditorStore.getState();
        const selectedId = store.selectedControlId;
        if (!selectedId || !store.draft) return;
        const builtin = store.layouts.find(
          (l) => l.id === store.draft?.id,
        )?.builtin;
        if (builtin) return;
        const next = deleteControl(store.draft, selectedId);
        if (next !== store.draft) {
          store.applyCommit(next);
          store.setSelectedControlId(null);
        }
      }
      if (event.key === 'Escape') {
        const state = useEditorStore.getState();
        if (state.selectedControlId || state.selectedSectionId) {
          state.setSelectedControlId(null);
          state.setSelectedSectionId(null);
        }
      }
    };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, []);
}
