import { create } from 'zustand';
import type { Document as LayoutDocument } from '@/shared/generated/layout';
import {
  cloneDocument,
  findControl,
  isDefaultLocked,
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

function cloneHistoryDoc(doc: LayoutDocument): LayoutDocument {
  return cloneDocument(doc);
}

interface HistoryState {
  stack: LayoutDocument[];
  index: number;
  cap: number;
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
      set({ history: { ...history, index: nextIndex }, draft: prev });
      return prev;
    },

    historyRedo: () => {
      const { history } = get();
      if (history.index >= history.stack.length - 1) return null;
      const nextIndex = history.index + 1;
      const next = cloneHistoryDoc(history.stack[nextIndex]);
      set({ history: { ...history, index: nextIndex }, draft: next });
      return next;
    },

    canUndo: () => get().history.index > 0,
    canRedo: () => get().history.index < get().history.stack.length - 1,

    applyCommit: (next, opts) => {
      const { draft, history } = get();
      if (!draft) return null;
      if (opts?.live) {
        set({ draft: cloneHistoryDoc(next) });
        return next;
      }
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
      set({ draft: cloned, history: nextHistory });
      return cloned;
    },

    resetDocument: (doc) => {
      const cloned = cloneHistoryDoc(doc);
      set({
        draft: cloned,
        originalId: doc.id,
        name: doc.name,
        nameError: null,
        selectedId: null,
        locks: {},
        history: { stack: [cloneHistoryDoc(doc)], index: 0, cap: 50 },
        showOnboarding: readShowOnboarding(),
      });
    },

    setDraftLive: (doc) => {
      set({ draft: cloneHistoryDoc(doc) });
    },

    commitDraft: (doc) => {
      const cloned = cloneHistoryDoc(doc);
      const { history } = get();
      const current = history.stack[history.index];
      if (current && JSON.stringify(current) === JSON.stringify(cloned)) {
        set({ draft: cloned });
        return;
      }
      const nextStack = history.stack.slice(0, history.index + 1);
      nextStack.push(cloned);
      if (nextStack.length > history.cap) nextStack.shift();
      set({
        draft: cloned,
        history: {
          stack: nextStack,
          index: nextStack.length - 1,
          cap: history.cap,
        },
      });
    },
  }),
);

export function usePhoneCanUndo(): boolean {
  return usePhoneEditorStore((s) => s.history.index > 0);
}

export function usePhoneCanRedo(): boolean {
  return usePhoneEditorStore(
    (s) => s.history.index < s.history.stack.length - 1,
  );
}

export function getLockForControl(
  locks: Record<string, boolean>,
  controlId: string,
  doc: LayoutDocument | null,
): boolean {
  if (controlId in locks) return locks[controlId];
  if (!doc) return true;
  const found = findControl(doc, controlId);
  if (!found) return true;
  return isDefaultLocked(found.control as never);
}
