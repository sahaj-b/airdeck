import { useCallback, useMemo } from 'react';
import {
  createAdminLayout,
  deleteAdminLayout,
  getAdminLayout,
  getAdminState,
  setAllPlayerLayouts,
  updateAdminLayout,
} from '@/dashboard/api';
import type { Document as LayoutDocument } from '@/shared/generated/layout';
import { validateLayoutDetailed } from '@/shared/layout';
import {
  addHitfill,
  cloneDocument,
  deleteControl,
  duplicateControl,
  findControl,
  isDefaultLocked,
  moveControl,
  slugifyId,
} from '@/shared/layout-editor';
import type { AddControlResult } from '../components/add-control-dialog';
import { useEditorStore } from '../store/editor-store';

export function useEditorActions() {
  const draft = useEditorStore((s) => s.draft);
  const layouts = useEditorStore((s) => s.layouts);
  const config = useEditorStore((s) => s.config);
  const dirty = useEditorStore((s) => s.dirty);

  const errors = useMemo(
    () => (draft ? validateLayoutDetailed(draft).errors : []),
    [draft],
  );

  const currentBuiltin = useMemo(() => {
    if (!draft) return false;
    const layout = layouts.find((l) => l.id === draft.id);
    return layout?.builtin ?? false;
  }, [draft, layouts]);

  const readOnly = currentBuiltin;
  const currentDefault = draft?.id === config?.defaultLayout;

  const defaultForkName = useCallback((base: string): string => {
    const layoutsNow = useEditorStore.getState().layouts;
    let name = `${base} copy`;
    let id = slugifyId(name);
    let i = 2;
    while (layoutsNow.some((l) => l.id === id)) {
      name = `${base} copy ${i}`;
      id = slugifyId(name);
      i += 1;
    }
    return name;
  }, []);

  const requestFork = useCallback((): void => {
    const st = useEditorStore.getState();
    if (!st.draft) return;
    const builtin = st.layouts.find((l) => l.id === st.draft?.id)?.builtin;
    if (!builtin) return;
    const baseName = st.draft.name ?? 'Layout';
    st.setForkName(defaultForkName(baseName));
    st.setForkError(null);
    st.setForkOpen(true);
  }, [defaultForkName]);

  const applyCommit = useCallback(
    (
      next: LayoutDocument,
      opts?: { live?: boolean },
    ): LayoutDocument | null => {
      const builtin = useEditorStore
        .getState()
        .layouts.find(
          (l) => l.id === useEditorStore.getState().draft?.id,
        )?.builtin;
      if (builtin) return null;
      return useEditorStore.getState().applyCommit(next, opts);
    },
    [],
  );

  const mutate = useCallback(
    (
      transform: (doc: LayoutDocument) => LayoutDocument,
    ): LayoutDocument | null => {
      const cur = useEditorStore.getState().draft;
      if (!cur) return null;
      return applyCommit(transform(cur));
    },
    [applyCommit],
  );

  const handleDraftChange = useCallback(
    (next: LayoutDocument, commit: boolean): void => {
      applyCommit(next, { live: !commit });
    },
    [applyCommit],
  );

  const handleSelectLayout = useCallback(async (id: string): Promise<void> => {
    try {
      const doc = await getAdminLayout(id);
      const cloned = cloneDocument(doc as LayoutDocument);
      useEditorStore.getState().resetDocument(cloned);
      useEditorStore.getState().setError(null);
      const url = new URL(window.location.href);
      url.searchParams.set('layout', id);
      window.history.replaceState(null, '', url);
    } catch {
      useEditorStore.getState().setError('Failed to load layout.');
    }
  }, []);

  const handleOpenPicked = useCallback(
    async (id: string): Promise<void> => {
      useEditorStore.getState().setPickerOpen(false);
      await handleSelectLayout(id);
    },
    [handleSelectLayout],
  );

  const handlePickerCancel = useCallback((): void => {
    useEditorStore.getState().setPickerOpen(false);
  }, []);

  const handleNewLayout = useCallback((): void => {
    useEditorStore.getState().setNewLayoutDialogOpen(true);
  }, []);

  const handleRename = useCallback(async (name: string): Promise<void> => {
    const cur = useEditorStore.getState().draft;
    const builtin = useEditorStore
      .getState()
      .layouts.find((l) => l.id === cur?.id)?.builtin;
    if (!cur || builtin) return;
    const next = cloneDocument(cur);
    next.name = name;
    await updateAdminLayout(next.id, next);
    useEditorStore.getState().setDraft(next);
    useEditorStore.getState().setPersisted(cloneDocument(next));
    useEditorStore.getState().historyPush(next);
    useEditorStore.getState().setDirty(false);
    const state = await getAdminState();
    useEditorStore.getState().setLayouts(state.layouts);
  }, []);

  const handleDelete = useCallback(async (): Promise<void> => {
    const cur = useEditorStore.getState().draft;
    const builtin = useEditorStore
      .getState()
      .layouts.find((l) => l.id === cur?.id)?.builtin;
    if (!cur || builtin) return;
    await deleteAdminLayout(cur.id);
    const state = await getAdminState();
    useEditorStore.getState().setLayouts(state.layouts);
    const cfg = useEditorStore.getState().config;
    const fallbackId =
      cfg?.defaultLayout &&
      state.layouts.find((l) => l.id === cfg.defaultLayout)
        ? cfg.defaultLayout
        : state.layouts[0]?.id;
    if (fallbackId) await handleSelectLayout(fallbackId);
  }, [handleSelectLayout]);

  const handleSave = useCallback(async (): Promise<void> => {
    const st = useEditorStore.getState();
    const builtin = st.layouts.find((l) => l.id === st.draft?.id)?.builtin;
    if (!st.draft || !st.persisted || builtin) return;
    const liveErrors = st.draft ? validateLayoutDetailed(st.draft).errors : [];
    if (liveErrors.length > 0) return;
    const isNew = !st.layouts.some((l) => l.id === st.draft?.id);
    try {
      if (isNew) {
        await createAdminLayout(st.draft);
      } else {
        await updateAdminLayout(st.draft.id, st.draft);
      }
      useEditorStore.getState().setPersisted(cloneDocument(st.draft));
      useEditorStore.getState().historyPush(st.draft);
      useEditorStore.getState().setDirty(false);
      const state = await getAdminState();
      useEditorStore.getState().setLayouts(state.layouts);
      useEditorStore.getState().setError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Save failed.';
      useEditorStore.getState().setError(message);
    }
  }, []);

  const handleDiscard = useCallback((): void => {
    const st = useEditorStore.getState();
    if (!st.persisted) return;
    if (st.dirty) {
      useEditorStore.getState().setDiscardOpen(true);
      return;
    }
    useEditorStore.getState().resetDocument(cloneDocument(st.persisted));
  }, []);

  const confirmDiscard = useCallback((): void => {
    const st = useEditorStore.getState();
    if (!st.persisted) return;
    useEditorStore.getState().resetDocument(cloneDocument(st.persisted));
    useEditorStore.getState().setDiscardOpen(false);
  }, []);

  const handleUndo = useCallback((): void => {
    useEditorStore.getState().historyUndo();
  }, []);

  const handleRedo = useCallback((): void => {
    useEditorStore.getState().historyRedo();
  }, []);

  const handleBack = useCallback((): void => {
    if (useEditorStore.getState().dirty) {
      useEditorStore.getState().setBackOpen(true);
      return;
    }
    window.location.href = '/dashboard';
  }, []);

  const confirmBack = useCallback((): void => {
    window.location.href = '/dashboard';
  }, []);

  const handleDuplicateControl = useCallback(
    (controlId: string): void => {
      const next = mutate((doc) => duplicateControl(doc, controlId));
      if (!next) return;
      const found = findControl(next, controlId);
      const section = found?.section;
      const idx = section?.controls.findIndex((c) => c.id === controlId) ?? -1;
      const newControl = section?.controls[idx + 1];
      if (newControl) {
        useEditorStore.getState().setSelectedControlId(newControl.id);
        useEditorStore.getState().setSelectedSectionId(null);
      }
    },
    [mutate],
  );

  const handleDeleteControl = useCallback(
    (controlId: string): void => {
      const st = useEditorStore.getState();
      const next = mutate((doc) => deleteControl(doc, controlId));
      if (!next) return;
      if (st.selectedControlId === controlId)
        useEditorStore.getState().setSelectedControlId(null);
      const stillExists = next.sections.some((s) =>
        s.controls.some((c) => c.id === st.selectedControlId),
      );
      if (!stillExists) useEditorStore.getState().setSelectedControlId(null);
    },
    [mutate],
  );

  const handleAddHitfill = useCallback(
    (parentId: string): void => {
      const next = mutate((doc) => addHitfill(doc, parentId) ?? doc);
      if (!next) return;
      const found = findControl(next, parentId);
      const section = found?.section;
      const idx = section?.controls.findIndex((c) => c.id === parentId) ?? -1;
      const newControl = section?.controls[idx + 1];
      if (newControl) {
        useEditorStore.getState().setSelectedControlId(newControl.id);
        useEditorStore.getState().setSelectedSectionId(null);
      }
    },
    [mutate],
  );

  const handleMoveControl = useCallback(
    (controlId: string, direction: 'up' | 'down'): void => {
      mutate((doc) => {
        const found = findControl(doc, controlId);
        if (!found) return doc;
        const fromIndex = found.section.controls.findIndex(
          (c) => c.id === controlId,
        );
        const toIndex = direction === 'up' ? fromIndex - 1 : fromIndex + 1;
        if (toIndex < 0 || toIndex >= found.section.controls.length) return doc;
        return moveControl(doc, found.section.id, fromIndex, toIndex);
      });
    },
    [mutate],
  );

  const handleReorderControl = useCallback(
    (sectionId: string, fromIndex: number, toIndex: number): void => {
      mutate((doc) => moveControl(doc, sectionId, fromIndex, toIndex));
    },
    [mutate],
  );

  const handleAddControl = useCallback(
    (result: AddControlResult): void => {
      const next = mutate((doc) => {
        const cloned = cloneDocument(doc);
        const section = cloned.sections.find((s) => s.id === result.sectionId);
        if (!section) return cloned;
        section.controls.push(result.control);
        return cloned;
      });
      if (!next) return;
      useEditorStore.getState().setSelectedControlId(result.control.id);
      useEditorStore.getState().setSelectedSectionId(null);
      useEditorStore.getState().setAddDialogSection(null);
    },
    [mutate],
  );

  const handleToggleLock = useCallback((id: string): void => {
    const cur = useEditorStore.getState().draft;
    if (!cur) return;
    const entry = findControl(cur, id);
    const fallback = entry ? isDefaultLocked(entry.control) : false;
    useEditorStore.getState().toggleLock(id, fallback);
  }, []);

  const createAndSelectLayout = useCallback(
    async (name: string, baseId: string | null): Promise<void> => {
      const id = slugifyId(name);
      let doc: LayoutDocument;
      if (baseId) {
        const base = await getAdminLayout(baseId);
        doc = cloneDocument(base as LayoutDocument);
        doc.id = id;
        doc.name = name.trim();
      } else {
        doc = {
          id,
          name: name.trim(),
          schemaVersion: 1,
          defaultOrientation: 'landscape',
          sections: [
            { id: 'left', relativeWidth: 0.86, controls: [] },
            { id: 'center', relativeWidth: 0.5, controls: [] },
            { id: 'right', relativeWidth: 0.94, controls: [] },
          ],
          assets: [],
        };
      }
      await createAdminLayout(doc);
      const state = await getAdminState();
      useEditorStore.getState().setLayouts(state.layouts);
      await handleSelectLayout(id);
    },
    [handleSelectLayout],
  );

  const handleForkConfirm = useCallback(async (): Promise<void> => {
    const cur = useEditorStore.getState().draft;
    const name = useEditorStore.getState().forkName;
    if (!cur || !name.trim()) return;
    useEditorStore.getState().setForkBusy(true);
    useEditorStore.getState().setForkError(null);
    try {
      await createAndSelectLayout(name, cur.id);
      useEditorStore.getState().setForkOpen(false);
    } catch (err) {
      useEditorStore
        .getState()
        .setForkError(
          err instanceof Error ? err.message : 'Failed to duplicate layout.',
        );
    } finally {
      useEditorStore.getState().setForkBusy(false);
    }
  }, [createAndSelectLayout]);

  const handleCreateNew = useCallback(
    async (name: string, baseId: string | null): Promise<void> => {
      if (!name.trim()) return;
      useEditorStore.getState().setNewLayoutError(null);
      try {
        await createAndSelectLayout(name, baseId);
        useEditorStore.getState().setNewLayoutDialogOpen(false);
        useEditorStore.getState().setNewLayoutName('');
      } catch (err) {
        useEditorStore
          .getState()
          .setNewLayoutError(
            err instanceof Error ? err.message : 'Creation failed.',
          );
      }
    },
    [createAndSelectLayout],
  );

  const handleApplyToAll = useCallback(async (): Promise<void> => {
    const cur = useEditorStore.getState().draft;
    const stDirty = useEditorStore.getState().dirty;
    if (!cur || stDirty) return;
    const liveErrors = cur ? validateLayoutDetailed(cur).errors : [];
    if (liveErrors.length > 0) return;
    try {
      await setAllPlayerLayouts(cur.id);
      useEditorStore.getState().setError(null);
    } catch (err) {
      useEditorStore
        .getState()
        .setError(err instanceof Error ? err.message : 'Apply to all failed.');
    }
  }, []);

  return {
    errors,
    currentBuiltin,
    readOnly,
    currentDefault,
    dirty,
    handleDraftChange,
    handleSelectLayout,
    handleOpenPicked,
    handlePickerCancel,
    handleNewLayout,
    handleRename,
    handleDelete,
    handleSave,
    handleDiscard,
    confirmDiscard,
    handleUndo,
    handleRedo,
    handleBack,
    confirmBack,
    handleDuplicateControl,
    handleDeleteControl,
    handleAddHitfill,
    handleMoveControl,
    handleReorderControl,
    handleAddControl,
    handleToggleLock,
    requestFork,
    handleForkConfirm,
    handleCreateNew,
    handleApplyToAll,
    createAndSelectLayout,
  };
}
