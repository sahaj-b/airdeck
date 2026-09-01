import { create } from 'zustand';
import type { AdminLayoutSummary } from '@/shared/contracts';
import type { Document as LayoutDocument } from '@/shared/generated/layout';
import {
  cloneDocument,
  isDirty as isDirtyHelper,
  type SectionId,
} from '@/shared/layout-editor';

interface HistoryState {
  stack: LayoutDocument[];
  index: number;
  cap: number;
}

export interface EditorStoreState {
  layouts: AdminLayoutSummary[];
  config: { defaultLayout: string } | null;

  draft: LayoutDocument | null;
  persisted: LayoutDocument | null;
  dirty: boolean;

  selectedControlId: string | null;
  selectedSectionId: SectionId | null;
  hoveredControlId: string | null;
  hoveredSectionId: SectionId | null;

  locks: Record<string, boolean>;

  addDialogSection: SectionId | null;
  pickerOpen: boolean;
  forkOpen: boolean;
  forkName: string;
  forkBusy: boolean;
  forkError: string | null;
  newLayoutDialogOpen: boolean;
  newLayoutName: string;
  newLayoutBase: string;
  newLayoutError: string | null;
  discardOpen: boolean;
  backOpen: boolean;
  layoutSwitchOpen: boolean;
  pendingLayoutId: string | null;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  error: string | null;
  initError: string | null;
  isInitializing: boolean;

  history: HistoryState;

  // server / document
  setLayouts: (layouts: AdminLayoutSummary[]) => void;
  setConfig: (config: { defaultLayout: string } | null) => void;
  setDraft: (doc: LayoutDocument | null) => void;
  setPersisted: (doc: LayoutDocument | null) => void;
  setError: (error: string | null) => void;
  setInitError: (error: string | null) => void;
  setIsInitializing: (value: boolean) => void;

  // selection
  setSelectedControlId: (id: string | null) => void;
  setSelectedSectionId: (id: SectionId | null) => void;
  setHoveredControlId: (id: string | null) => void;
  setHoveredSectionId: (id: SectionId | null) => void;
  clearSelection: () => void;

  // locks
  toggleLock: (id: string, fallback: boolean) => void;
  setLocks: (locks: Record<string, boolean>) => void;

  // ui dialogs / panels
  setAddDialogSection: (section: SectionId | null) => void;
  setPickerOpen: (open: boolean) => void;
  setForkOpen: (open: boolean) => void;
  setForkName: (name: string) => void;
  setForkBusy: (busy: boolean) => void;
  setForkError: (error: string | null) => void;
  setNewLayoutDialogOpen: (open: boolean) => void;
  setNewLayoutName: (name: string) => void;
  setNewLayoutBase: (base: string) => void;
  setNewLayoutError: (error: string | null) => void;
  setDiscardOpen: (open: boolean) => void;
  setBackOpen: (open: boolean) => void;
  setLayoutSwitchOpen: (open: boolean) => void;
  setPendingLayoutId: (id: string | null) => void;
  setLeftCollapsed: (collapsed: boolean) => void;
  setRightCollapsed: (collapsed: boolean) => void;

  // dirty
  setDirty: (dirty: boolean) => void;
  recomputeDirty: () => void;
  markDirtyOptimistic: () => void;

  // history
  historyReset: (doc: LayoutDocument) => void;
  historyPush: (doc: LayoutDocument) => void;
  historyUndo: () => LayoutDocument | null;
  historyRedo: () => LayoutDocument | null;
  canUndo: () => boolean;
  canRedo: () => boolean;

  // commit helpers
  applyCommit: (
    next: LayoutDocument,
    opts?: { live?: boolean },
  ) => LayoutDocument | null;

  resetDocument: (doc: LayoutDocument) => void;
}

function readCollapsed(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function writeCollapsed(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? '1' : '0');
  } catch {}
}

function cloneHistoryDoc(doc: LayoutDocument): LayoutDocument {
  return cloneDocument(doc);
}

export const useEditorStore = create<EditorStoreState>()((set, get) => ({
  layouts: [],
  config: null,
  draft: null,
  persisted: null,
  dirty: false,
  selectedControlId: null,
  selectedSectionId: null,
  hoveredControlId: null,
  hoveredSectionId: null,
  locks: {},
  addDialogSection: null,
  pickerOpen: false,
  forkOpen: false,
  forkName: '',
  forkBusy: false,
  forkError: null,
  newLayoutDialogOpen: false,
  newLayoutName: '',
  newLayoutBase: 'blank',
  newLayoutError: null,
  discardOpen: false,
  backOpen: false,
  layoutSwitchOpen: false,
  pendingLayoutId: null,
  leftCollapsed: readCollapsed('airdeck.editor.leftCollapsed'),
  rightCollapsed: readCollapsed('airdeck.editor.rightCollapsed'),
  error: null,
  initError: null,
  isInitializing: true,
  history: { stack: [], index: -1, cap: 50 },

  setLayouts: (layouts) => set({ layouts }),
  setConfig: (config) => set({ config }),
  setDraft: (draft) => set({ draft }),
  setPersisted: (persisted) => set({ persisted }),
  setError: (error) => set({ error }),
  setInitError: (initError) => set({ initError }),
  setIsInitializing: (isInitializing) => set({ isInitializing }),

  setSelectedControlId: (selectedControlId) => set({ selectedControlId }),
  setSelectedSectionId: (selectedSectionId) => set({ selectedSectionId }),
  setHoveredControlId: (hoveredControlId) => set({ hoveredControlId }),
  setHoveredSectionId: (hoveredSectionId) => set({ hoveredSectionId }),
  clearSelection: () =>
    set({ selectedControlId: null, selectedSectionId: null }),

  toggleLock: (id, fallback) =>
    set((state) => {
      const effective = state.locks[id] ?? fallback;
      return { locks: { ...state.locks, [id]: !effective } };
    }),
  setLocks: (locks) => set({ locks }),

  setAddDialogSection: (addDialogSection) => set({ addDialogSection }),
  setPickerOpen: (pickerOpen) => set({ pickerOpen }),
  setForkOpen: (forkOpen) => set({ forkOpen }),
  setForkName: (forkName) => set({ forkName }),
  setForkBusy: (forkBusy) => set({ forkBusy }),
  setForkError: (forkError) => set({ forkError }),
  setNewLayoutDialogOpen: (newLayoutDialogOpen) => set({ newLayoutDialogOpen }),
  setNewLayoutName: (newLayoutName) => set({ newLayoutName }),
  setNewLayoutBase: (newLayoutBase) => set({ newLayoutBase }),
  setNewLayoutError: (newLayoutError) => set({ newLayoutError }),
  setDiscardOpen: (discardOpen) => set({ discardOpen }),
  setBackOpen: (backOpen) => set({ backOpen }),
  setLayoutSwitchOpen: (layoutSwitchOpen) => set({ layoutSwitchOpen }),
  setPendingLayoutId: (pendingLayoutId) => set({ pendingLayoutId }),
  setLeftCollapsed: (leftCollapsed) => {
    writeCollapsed('airdeck.editor.leftCollapsed', leftCollapsed);
    set({ leftCollapsed });
  },
  setRightCollapsed: (rightCollapsed) => {
    writeCollapsed('airdeck.editor.rightCollapsed', rightCollapsed);
    set({ rightCollapsed });
  },

  setDirty: (dirty) => set({ dirty }),
  recomputeDirty: () => {
    const { draft, persisted } = get();
    if (!draft || !persisted) {
      set({ dirty: false });
      return;
    }
    set({ dirty: isDirtyHelper(draft, persisted) });
  },
  markDirtyOptimistic: () => {
    const { persisted } = get();
    if (persisted) set({ dirty: true });
  },

  historyReset: (doc) =>
    set({
      history: { stack: [cloneHistoryDoc(doc)], index: 0, cap: 50 },
    }),

  historyPush: (doc) =>
    set((state) => {
      const cloned = cloneHistoryDoc(doc);
      const current = state.history.stack[state.history.index];
      if (current && JSON.stringify(current) === JSON.stringify(cloned)) {
        return state;
      }
      const nextStack = state.history.stack.slice(0, state.history.index + 1);
      nextStack.push(cloned);
      if (nextStack.length > state.history.cap) nextStack.shift();
      return {
        history: {
          stack: nextStack,
          index: nextStack.length - 1,
          cap: state.history.cap,
        },
      };
    }),

  historyUndo: () => {
    const { history } = get();
    if (history.index <= 0) return null;
    const nextIndex = history.index - 1;
    const prev = cloneHistoryDoc(history.stack[nextIndex]);
    set({ history: { ...history, index: nextIndex } });
    // also update draft/dirty synchronously
    const { persisted } = get();
    set({
      draft: prev,
      dirty: persisted ? isDirtyHelper(prev, persisted) : false,
    });
    return prev;
  },

  historyRedo: () => {
    const { history } = get();
    if (history.index >= history.stack.length - 1) return null;
    const nextIndex = history.index + 1;
    const next = cloneHistoryDoc(history.stack[nextIndex]);
    set({ history: { ...history, index: nextIndex } });
    const { persisted } = get();
    set({
      draft: next,
      dirty: persisted ? isDirtyHelper(next, persisted) : false,
    });
    return next;
  },

  canUndo: () => get().history.index > 0,
  canRedo: () => get().history.index < get().history.stack.length - 1,

  applyCommit: (next, opts) => {
    const { draft, persisted, history } = get();
    // readOnly check is handled by caller via selector, but keep guard via layouts lookup
    // caller should check builtin flag; we still require draft exists
    if (!draft) return null;
    if (opts?.live) {
      set({ draft: cloneHistoryDoc(next), dirty: !!persisted });
      return next;
    }
    // commit: push to history and recompute dirty
    const cloned = cloneHistoryDoc(next);
    const current = history.stack[history.index];
    let nextHistory = history;
    if (!current || JSON.stringify(current) !== JSON.stringify(cloned)) {
      const nextStack = history.stack.slice(0, history.index + 1);
      nextStack.push(cloned);
      if (nextStack.length > history.cap) nextStack.shift();
      nextHistory = {
        stack: nextStack,
        index: nextStack.length - 1,
        cap: history.cap,
      };
    }
    set({
      draft: cloned,
      history: nextHistory,
      dirty: persisted ? isDirtyHelper(cloned, persisted) : false,
    });
    return cloned;
  },

  resetDocument: (doc) => {
    const cloned = cloneHistoryDoc(doc);
    const persistedClone = cloneHistoryDoc(doc);
    set({
      draft: cloned,
      persisted: persistedClone,
      dirty: false,
      history: { stack: [cloneHistoryDoc(doc)], index: 0, cap: 50 },
      selectedControlId: null,
      selectedSectionId: null,
      locks: {},
      error: null,
      initError: null,
      isInitializing: false,
    });
  },
}));

// Selectors for derived state - keep outside store to avoid recompute in store
export function useEditorCanUndo(): boolean {
  return useEditorStore((s) => s.history.index > 0);
}
export function useEditorCanRedo(): boolean {
  return useEditorStore((s) => s.history.index < s.history.stack.length - 1);
}
export function useEditorIsDirty(): boolean {
  return useEditorStore((s) => s.dirty);
}
export function useEditorReadOnly(): boolean {
  return useEditorStore((s) => {
    if (!s.draft) return false;
    const layout = s.layouts.find((l) => l.id === s.draft?.id);
    return layout?.builtin ?? false;
  });
}
