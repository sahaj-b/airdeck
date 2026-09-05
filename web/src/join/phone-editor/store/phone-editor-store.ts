import { create } from 'zustand';
import type { Document as LayoutDocument } from '@/shared/generated/layout';
import type { HistoryState } from '@/shared/layout-editor';
import {
  cloneDocument,
  historyCanRedo,
  historyCanUndo,
  historyInit,
  historyPush,
  historyRedo,
  historyUndo,
} from '@/shared/layout-editor';

const ONBOARDING_KEY = 'airdeck.phoneEditorOnboarded';

function readShowOnboarding(): boolean {
  try {
    return !localStorage.getItem(ONBOARDING_KEY);
  } catch {
    return false;
  }
}

function writeOnboarded(): void {
  try {
    localStorage.setItem(ONBOARDING_KEY, '1');
  } catch {}
}

export interface PhoneEditorStoreState {
  draft: LayoutDocument | null;
  originalId: string | null;
  name: string;
  nameError: string | null;
  selectedId: string | null;
  locks: Record<string, boolean>;
  showOnboarding: boolean;
  history: HistoryState;

  setDraft: (doc: LayoutDocument | null) => void;
  setOriginalId: (id: string | null) => void;
  setName: (name: string) => void;
  setNameError: (err: string | null) => void;
  setSelectedId: (id: string | null) => void;
  toggleLock: (id: string, fallback: boolean) => void;
  setLocks: (locks: Record<string, boolean>) => void;
  setShowOnboarding: (v: boolean) => void;
  dismissOnboarding: () => void;

  historyReset: (doc: LayoutDocument) => void;
  historyPush: (doc: LayoutDocument) => void;
  historyUndo: () => LayoutDocument | null;
  historyRedo: () => LayoutDocument | null;
  canUndo: () => boolean;
  canRedo: () => boolean;

  applyCommit: (
    next: LayoutDocument,
    opts?: { live?: boolean },
  ) => LayoutDocument | null;

  resetDocument: (doc: LayoutDocument) => void;
  setDraftLive: (doc: LayoutDocument) => void;
  commitDraft: (doc: LayoutDocument) => void;
}

export const usePhoneEditorStore = create<PhoneEditorStoreState>()(
  (set, get) => ({
    draft: null,
    originalId: null,
    name: '',
    nameError: null,
    selectedId: null,
    locks: {},
    showOnboarding: readShowOnboarding(),
    history: { stack: [], index: -1, cap: 50 },

    setDraft: (draft) => set({ draft }),
    setOriginalId: (originalId) => set({ originalId }),
    setName: (name) => set({ name }),
    setNameError: (nameError) => set({ nameError }),
    setSelectedId: (selectedId) => set({ selectedId }),
    toggleLock: (id, fallback) =>
      set((state) => {
        const effective = state.locks[id] ?? fallback;
        return { locks: { ...state.locks, [id]: !effective } };
      }),
    setLocks: (locks) => set({ locks }),
    setShowOnboarding: (showOnboarding) => set({ showOnboarding }),
    dismissOnboarding: () => {
      writeOnboarded();
      set({ showOnboarding: false });
    },

    historyReset: (doc) => set({ history: historyInit(doc) }),

    historyPush: (doc) =>
      set((state) => ({ history: historyPush(state.history, doc) })),

    historyUndo: () => {
      const result = historyUndo(get().history);
      if (!result) return null;
      set({ history: result.state, draft: result.doc });
      return result.doc;
    },

    historyRedo: () => {
      const result = historyRedo(get().history);
      if (!result) return null;
      set({ history: result.state, draft: result.doc });
      return result.doc;
    },

    canUndo: () => historyCanUndo(get().history),
    canRedo: () => historyCanRedo(get().history),

    applyCommit: (next, opts) => {
      const { draft, history } = get();
      if (!draft) return null;
      if (opts?.live) {
        set({ draft: cloneDocument(next) });
        return next;
      }
      const cloned = cloneDocument(next);
      set({ draft: cloned, history: historyPush(history, cloned) });
      return cloned;
    },

    resetDocument: (doc) => {
      set({
        draft: cloneDocument(doc),
        originalId: doc.id,
        name: doc.name,
        nameError: null,
        selectedId: null,
        locks: {},
        history: historyInit(doc),
        showOnboarding: readShowOnboarding(),
      });
    },

    setDraftLive: (doc) => {
      set({ draft: cloneDocument(doc) });
    },

    commitDraft: (doc) => {
      const cloned = cloneDocument(doc);
      set({ draft: cloned, history: historyPush(get().history, cloned) });
    },
  }),
);
