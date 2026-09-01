import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@/index.css';
import '../controller/controller.css';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  createAdminLayout,
  deleteAdminLayout,
  getAdminLayout,
  getAdminState,
  setAllPlayerLayouts,
  updateAdminLayout,
} from '@/dashboard/api';
import type { AdminLayoutSummary } from '@/shared/contracts';
import type { Document as LayoutDocument } from '@/shared/generated/layout';
import { validateLayoutDetailed } from '@/shared/layout';
import {
  addHitfill,
  cloneDocument,
  deleteControl,
  duplicateControl,
  findControl,
  isDefaultLocked,
  isDirty,
  LayoutHistory,
  moveControl,
  type SectionId,
  slugifyId,
} from '@/shared/layout-editor';
import { getSkin, initSkin } from '../skins/loader';
import {
  AddControlDialog,
  type AddControlResult,
} from './components/add-control-dialog';
import { Inspector } from './components/inspector';
import { LayoutCanvas } from './components/layout-canvas';
import { LayoutHeader } from './components/layout-header';
import { LayoutPicker } from './components/layout-picker';
import { SectionsPanel } from './components/sections-panel';
import './editor.css';

function EditorApp() {
  useEffect(() => {
    try {
      document.documentElement.setAttribute('data-skin', getSkin());
    } catch {}
    initSkin();
  }, []);

  const [layouts, setLayouts] = useState<AdminLayoutSummary[]>([]);
  const [config, setConfig] = useState<{ defaultLayout: string } | null>(null);
  const [draft, setDraft] = useState<LayoutDocument | null>(null);
  const [persisted, setPersisted] = useState<LayoutDocument | null>(null);
  const [selectedControlId, setSelectedControlId] = useState<string | null>(
    null,
  );
  const [selectedSectionId, setSelectedSectionId] = useState<SectionId | null>(
    null,
  );
  const [hoveredControlId, setHoveredControlId] = useState<string | null>(null);
  const [hoveredSectionId, setHoveredSectionId] = useState<SectionId | null>(
    null,
  );
  const [locks, setLocks] = useState<Record<string, boolean>>({});
  const [addDialogSection, setAddDialogSection] = useState<SectionId | null>(
    null,
  );
  const [newLayoutDialogOpen, setNewLayoutDialogOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [backOpen, setBackOpen] = useState(false);
  const [leftCollapsed, setLeftCollapsed] = useState(() => {
    try {
      return localStorage.getItem('airdeck.editor.leftCollapsed') === '1';
    } catch {
      return false;
    }
  });
  const [rightCollapsed, setRightCollapsed] = useState(() => {
    try {
      return localStorage.getItem('airdeck.editor.rightCollapsed') === '1';
    } catch {
      return false;
    }
  });
  const historyRef = useRef<LayoutHistory>(new LayoutHistory(50));
  const persistedRef = useRef<LayoutDocument | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  // Fork dialog state
  const [forkOpen, setForkOpen] = useState(false);
  const [forkName, setForkName] = useState('');
  const [forkBusy, setForkBusy] = useState(false);
  const [forkError, setForkError] = useState<string | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(
        'airdeck.editor.leftCollapsed',
        leftCollapsed ? '1' : '0',
      );
    } catch {}
  }, [leftCollapsed]);
  useEffect(() => {
    try {
      localStorage.setItem(
        'airdeck.editor.rightCollapsed',
        rightCollapsed ? '1' : '0',
      );
    } catch {}
  }, [rightCollapsed]);

  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    persistedRef.current = persisted;
  }, [persisted]);

  const markDirty = useCallback((next: LayoutDocument | null) => {
    if (!next || !persistedRef.current) {
      setDirty(false);
      return;
    }
    setDirty(isDirty(next, persistedRef.current));
  }, []);

  const markDirtyOptimistic = useCallback(() => {
    if (persistedRef.current) setDirty(true);
  }, []);

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

  // Load admin state and optionally ?layout=<id>
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const state = await getAdminState();
        if (cancelled) return;
        setLayouts(state.layouts);
        setConfig(state.config);
        const params = new URLSearchParams(window.location.search);
        const paramId = params.get('layout');
        const targetId =
          paramId || state.config.defaultLayout || state.layouts[0]?.id;
        if (targetId) {
          try {
            const doc = await getAdminLayout(targetId);
            if (cancelled) return;
            setDraft(cloneDocument(doc as LayoutDocument));
            setPersisted(cloneDocument(doc as LayoutDocument));
            historyRef.current.reset(doc as LayoutDocument);
            setDirty(false);
          } catch {
            if (!cancelled && paramId) setPickerOpen(true);
          }
        }
        if (!paramId) setPickerOpen(true);
      } catch {
        // leave empty state for local dev without host
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  // beforeunload guard
  useEffect(() => {
    const handle = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handle);
    return () => window.removeEventListener('beforeunload', handle);
  }, [dirty]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) {
          const next = historyRef.current.redo();
          if (next) {
            setDraft(next);
            markDirty(next);
          }
        } else {
          const previous = historyRef.current.undo();
          if (previous) {
            setDraft(previous);
            markDirty(previous);
          }
        }
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        const next = historyRef.current.redo();
        if (next) {
          setDraft(next);
          markDirty(next);
        }
      }
      if (event.key === 'Delete' && selectedControlId) {
        deleteControlRef.current(selectedControlId);
      }
      if (event.key === 'Escape') {
        setSelectedControlId(null);
        setSelectedSectionId(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedControlId, markDirty]);

  // Fork helpers ------------------------------------------------------------
  const defaultForkName = useCallback(
    (base: string) => {
      let name = `${base} copy`;
      let id = slugifyId(name);
      let i = 2;
      while (layouts.some((l) => l.id === id)) {
        name = `${base} copy ${i}`;
        id = slugifyId(name);
        i += 1;
      }
      return name;
    },
    [layouts],
  );

  const requestFork = useCallback(() => {
    if (!currentBuiltin) return;
    setForkName(defaultForkName(draft?.name ?? 'Layout'));
    setForkError(null);
    setForkOpen(true);
  }, [currentBuiltin, draft, defaultForkName]);

  // Single mutation chokepoint. The ONLY place that reads currentBuiltin to
  // decide whether the built-in layout is writable.
  const applyCommit = useCallback(
    (
      next: LayoutDocument,
      opts?: { live?: boolean },
    ): LayoutDocument | null => {
      if (currentBuiltin) {
        return null;
      }
      setDraft(next);
      if (opts?.live) {
        markDirtyOptimistic();
      } else {
        historyRef.current.push(next);
        markDirty(next);
      }
      return next;
    },
    [currentBuiltin, markDirty, markDirtyOptimistic],
  );

  const mutate = useCallback(
    (
      transform: (doc: LayoutDocument) => LayoutDocument,
    ): LayoutDocument | null => {
      if (!draft) return null;
      return applyCommit(transform(draft));
    },
    [draft, applyCommit],
  );

  // Draft change helper: live during drag, precise on commit
  const handleDraftChange = useCallback(
    (next: LayoutDocument, commit: boolean) => {
      applyCommit(next, { live: !commit });
    },
    [applyCommit],
  );

  const handleSelectLayout = useCallback(async (id: string) => {
    try {
      const doc = await getAdminLayout(id);
      setDraft(cloneDocument(doc as LayoutDocument));
      setPersisted(cloneDocument(doc as LayoutDocument));
      historyRef.current.reset(doc as LayoutDocument);
      setDirty(false);
      setSelectedControlId(null);
      setSelectedSectionId(null);
      setLocks({});
      setError(null);
      const url = new URL(window.location.href);
      url.searchParams.set('layout', id);
      window.history.replaceState(null, '', url);
    } catch {
      setError('Failed to load layout.');
    }
  }, []);

  const handleOpenPicked = useCallback(
    async (id: string) => {
      setPickerOpen(false);
      await handleSelectLayout(id);
    },
    [handleSelectLayout],
  );

  const handlePickerCancel = useCallback(() => {
    setPickerOpen(false);
  }, []);

  const handleNewLayout = useCallback(() => {
    setNewLayoutDialogOpen(true);
  }, []);

  const handleRename = useCallback(
    async (name: string) => {
      if (!draft || currentBuiltin) return;
      const next = cloneDocument(draft);
      next.name = name;
      await updateAdminLayout(next.id, next);
      setDraft(next);
      setPersisted(cloneDocument(next));
      historyRef.current.push(next);
      setDirty(false);
      const state = await getAdminState();
      setLayouts(state.layouts);
    },
    [draft, currentBuiltin],
  );

  const handleDelete = useCallback(async () => {
    if (!draft || currentBuiltin) return;
    await deleteAdminLayout(draft.id);
    const state = await getAdminState();
    setLayouts(state.layouts);
    // Fallback to default or first layout
    const fallbackId =
      config?.defaultLayout &&
      state.layouts.find((l) => l.id === config.defaultLayout)
        ? config.defaultLayout
        : state.layouts[0]?.id;
    if (fallbackId) {
      await handleSelectLayout(fallbackId);
    }
  }, [draft, currentBuiltin, config, handleSelectLayout]);

  const handleSave = useCallback(async () => {
    if (!draft || !persisted || currentBuiltin) return;
    if (errors.length > 0) return;
    const isNew = !layouts.some((l) => l.id === draft.id);
    try {
      if (isNew) {
        await createAdminLayout(draft);
      } else {
        await updateAdminLayout(draft.id, draft);
      }
      setPersisted(cloneDocument(draft));
      historyRef.current.push(draft);
      setDirty(false);
      const state = await getAdminState();
      setLayouts(state.layouts);
      setError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Save failed.';
      setError(message);
    }
  }, [draft, persisted, errors, layouts, currentBuiltin]);

  const handleDiscard = useCallback(() => {
    if (!persisted) return;
    if (dirty) {
      setDiscardOpen(true);
      return;
    }
    setDraft(cloneDocument(persisted));
    historyRef.current.reset(persisted);
    setDirty(false);
    setSelectedControlId(null);
    setSelectedSectionId(null);
  }, [persisted, dirty]);

  const confirmDiscard = useCallback(() => {
    if (!persisted) return;
    setDraft(cloneDocument(persisted));
    historyRef.current.reset(persisted);
    setDirty(false);
    setSelectedControlId(null);
    setSelectedSectionId(null);
    setDiscardOpen(false);
  }, [persisted]);

  const handleUndo = useCallback(() => {
    const previous = historyRef.current.undo();
    if (previous) {
      setDraft(previous);
      markDirty(previous);
    }
  }, [markDirty]);

  const handleRedo = useCallback(() => {
    const next = historyRef.current.redo();
    if (next) {
      setDraft(next);
      markDirty(next);
    }
  }, [markDirty]);

  const handleBack = useCallback(() => {
    if (dirty) {
      setBackOpen(true);
      return;
    }
    window.location.href = '/dashboard';
  }, [dirty]);

  const confirmBack = useCallback(() => {
    window.location.href = '/dashboard';
  }, []);

  // Control CRUD
  const handleDuplicateControl = useCallback(
    (controlId: string) => {
      const next = mutate((doc) => duplicateControl(doc, controlId));
      if (!next) return;
      const found = findControl(next, controlId);
      const section = found?.section;
      const idx = section?.controls.findIndex((c) => c.id === controlId) ?? -1;
      const newControl = section?.controls[idx + 1];
      if (newControl) {
        setSelectedControlId(newControl.id);
        setSelectedSectionId(null);
      }
    },
    [mutate],
  );

  const handleDeleteControl = useCallback(
    (controlId: string) => {
      const next = mutate((doc) => deleteControl(doc, controlId));
      if (!next) return;
      if (selectedControlId === controlId) setSelectedControlId(null);
      // if selected was a hitfill of deleted parent, also clear selection
      const stillExists = next.sections.some((s) =>
        s.controls.some((c) => c.id === selectedControlId),
      );
      if (!stillExists) setSelectedControlId(null);
    },
    [mutate, selectedControlId],
  );

  const handleAddHitfill = useCallback(
    (parentId: string) => {
      const next = mutate((doc) => addHitfill(doc, parentId) ?? doc);
      if (!next) return;
      const found = findControl(next, parentId);
      const section = found?.section;
      const idx = section?.controls.findIndex((c) => c.id === parentId) ?? -1;
      const newControl = section?.controls[idx + 1];
      if (newControl) {
        setSelectedControlId(newControl.id);
        setSelectedSectionId(null);
      }
    },
    [mutate],
  );

  const deleteControlRef = useRef(handleDeleteControl);
  useEffect(() => {
    deleteControlRef.current = handleDeleteControl;
  }, [handleDeleteControl]);

  const handleMoveControl = useCallback(
    (controlId: string, direction: 'up' | 'down') => {
      mutate((doc) => {
        const found = findControl(doc, controlId);
        if (!found) return doc;
        const fromIndex = found.section.controls.findIndex(
          (c) => c.id === controlId,
        );
        const toIndex = direction === 'up' ? fromIndex - 1 : fromIndex + 1;
        if (toIndex < 0 || toIndex >= found.section.controls.length) {
          return doc;
        }
        return moveControl(doc, found.section.id, fromIndex, toIndex);
      });
    },
    [mutate],
  );

  const handleReorderControl = useCallback(
    (sectionId: string, fromIndex: number, toIndex: number) => {
      mutate((doc) => moveControl(doc, sectionId, fromIndex, toIndex));
    },
    [mutate],
  );

  const handleAddControl = useCallback(
    (result: AddControlResult) => {
      const next = mutate((doc) => {
        const section = doc.sections.find((s) => s.id === result.sectionId);
        if (!section) return doc;
        section.controls.push(result.control);
        return doc;
      });
      if (!next) return;
      setSelectedControlId(result.control.id);
      setSelectedSectionId(null);
      setAddDialogSection(null);
    },
    [mutate],
  );

  // Lock/Detach toggles
  const handleToggleLock = useCallback(
    (id: string) => {
      setLocks((prev) => {
        const effective =
          prev[id] ??
          (() => {
            if (!draft) return false;
            const entry = findControl(draft, id);
            return entry ? isDefaultLocked(entry.control) : false;
          })();
        return { ...prev, [id]: !effective };
      });
    },
    [draft],
  );

  // Create + select a layout (shared by New layout and fork dialogs)
  const createAndSelectLayout = useCallback(
    async (name: string, baseId: string | null) => {
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
      setLayouts(state.layouts);
      await handleSelectLayout(id);
    },
    [handleSelectLayout],
  );

  const handleForkConfirm = useCallback(async () => {
    if (!draft || !forkName.trim()) return;
    setForkBusy(true);
    setForkError(null);
    try {
      await createAndSelectLayout(forkName, draft.id);
      setForkOpen(false);
    } catch (error) {
      setForkError(
        error instanceof Error ? error.message : 'Failed to duplicate layout.',
      );
    } finally {
      setForkBusy(false);
    }
  }, [draft, forkName, createAndSelectLayout]);

  // New Layout dialog
  const [newLayoutName, setNewLayoutName] = useState('');
  const [newLayoutBase, setNewLayoutBase] = useState('blank');
  const [newLayoutError, setNewLayoutError] = useState<string | null>(null);

  const handleCreateNew = useCallback(
    async (name: string, baseId: string | null) => {
      if (!name.trim()) return;
      setNewLayoutError(null);
      try {
        await createAndSelectLayout(name, baseId);
        setNewLayoutDialogOpen(false);
        setNewLayoutName('');
      } catch (error) {
        setNewLayoutError(
          error instanceof Error ? error.message : 'Creation failed.',
        );
      }
    },
    [createAndSelectLayout],
  );

  const handleApplyToAll = useCallback(async () => {
    if (!draft || dirty || errors.length > 0) return;
    try {
      await setAllPlayerLayouts(draft.id);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Apply to all failed.');
    }
  }, [draft, dirty, errors]);

  if (!draft) {
    return (
      <div className="grid min-h-dvh place-items-center bg-background p-6">
        <div className="text-sm text-muted-foreground">Loading layout…</div>
      </div>
    );
  }

  const shellClass = [
    'grid h-dvh min-w-0 overflow-hidden bg-background text-foreground transition-[grid-template-columns] duration-200 ease-out motion-reduce:transition-none',
    'grid-rows-[auto_minmax(0,1fr)]',
    leftCollapsed && rightCollapsed
      ? 'grid-cols-[36px_minmax(0,1fr)_36px] max-lg:grid-cols-1'
      : leftCollapsed
        ? 'grid-cols-[36px_minmax(0,1fr)_280px] max-xl:grid-cols-[36px_minmax(0,1fr)_240px] max-lg:grid-cols-1'
        : rightCollapsed
          ? 'grid-cols-[260px_minmax(0,1fr)_36px] max-xl:grid-cols-[220px_minmax(0,1fr)_36px] max-lg:grid-cols-1'
          : 'grid-cols-[260px_minmax(0,1fr)_280px] max-xl:grid-cols-[220px_minmax(0,1fr)_240px] max-lg:grid-cols-1',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <TooltipProvider delay={0}>
      <div className={shellClass}>
        <div className="col-span-full flex flex-col">
          <div className="border-b border-border bg-background px-4 py-3 max-lg:col-span-1">
            <LayoutHeader
              layouts={layouts}
              currentId={draft.id}
              currentName={draft.name}
              isBuiltin={currentBuiltin}
              isDefault={currentDefault}
              dirty={dirty}
              canUndo={historyRef.current.canUndo}
              canRedo={historyRef.current.canRedo}
              hasErrors={errors.length > 0}
              onSelectLayout={handleSelectLayout}
              onNewLayout={handleNewLayout}
              onRename={handleRename}
              onDelete={handleDelete}
              onUndo={handleUndo}
              onRedo={handleRedo}
              onDiscard={handleDiscard}
              onSave={handleSave}
              onBack={handleBack}
              onDuplicate={requestFork}
              onApplyToAll={handleApplyToAll}
            />
          </div>
          {error && (
            <div
              className="mx-4 my-3 flex items-center justify-between gap-3 rounded-lg border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              role="alert"
            >
              <span>{error}</span>
              <button
                type="button"
                onClick={() => setError(null)}
                className="shrink-0 rounded px-2 py-0.5 text-xs hover:bg-destructive/10 hover:cursor-pointer"
                aria-label="Dismiss error"
              >
                ✕
              </button>
            </div>
          )}

          {readOnly && (
            <div className="mx-4 flex items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
              <span>
                Built-in layout · Read-only. Duplicate to make changes.
              </span>
              <button
                type="button"
                onClick={requestFork}
                className="shrink-0 rounded bg-amber-500/20 px-2.5 py-1 text-xs font-medium hover:bg-amber-500/30 hover:cursor-pointer"
              >
                Duplicate to edit
              </button>
            </div>
          )}
        </div>

        <div
          className={
            leftCollapsed
              ? 'relative flex min-h-[320px] items-center justify-center overflow-hidden border-r border-border bg-card max-lg:min-h-9 max-lg:h-9'
              : 'relative flex min-h-0 min-w-0 flex-col overflow-hidden border-r border-border bg-background max-lg:border-r-0 max-lg:border-b h-full'
          }
        >
          {leftCollapsed ? (
            <TooltipProvider delay={0}>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      className="flex size-full min-h-[200px] items-center justify-center rounded-xl border-0 bg-transparent text-muted-foreground hover:bg-accent/40 hover:text-foreground max-lg:min-h-9 max-lg:h-9 cursor-pointer"
                      onClick={() => setLeftCollapsed(false)}
                      aria-label="Expand sections"
                    >
                      <ChevronRight className="size-4" />
                    </button>
                  }
                />
                <TooltipContent side="right">
                  Expand sections panel
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : (
            <SectionsPanel
              document={draft}
              selectedControlId={selectedControlId}
              selectedSectionId={selectedSectionId}
              hoveredControlId={hoveredControlId}
              onSelectControl={(id) => {
                setSelectedControlId(id);
                setSelectedSectionId(null);
              }}
              onSelectSection={(id) => {
                setSelectedSectionId(id as SectionId);
                setSelectedControlId(null);
              }}
              onHoverSection={(id) =>
                setHoveredSectionId(id as SectionId | null)
              }
              onAddControl={(sectionId) =>
                setAddDialogSection(sectionId as SectionId | null)
              }
              onMoveControl={handleMoveControl}
              onDuplicateControl={handleDuplicateControl}
              onDeleteControl={handleDeleteControl}
              onReorderControl={handleReorderControl}
              onHoverControl={setHoveredControlId}
              onCollapse={() => setLeftCollapsed(true)}
            />
          )}
        </div>

        <div className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-background p-2.5 max-lg:p-2 gap-2">
          <LayoutCanvas
            document={draft}
            selectedControlId={selectedControlId}
            selectedSectionId={selectedSectionId}
            hoveredControlId={hoveredControlId}
            hoveredSectionId={hoveredSectionId}
            onSelectControl={setSelectedControlId}
            onSelectSection={(id) =>
              setSelectedSectionId(id as SectionId | null)
            }
            onHoverSection={(id) => setHoveredSectionId(id as SectionId | null)}
            onDraftChange={handleDraftChange}
            locks={locks}
          />
        </div>

        <div
          className={
            rightCollapsed
              ? 'relative flex min-h-[320px] items-center justify-center overflow-hidden border-l border-border bg-card max-lg:min-h-9 max-lg:h-9 max-lg:border-l-0 max-lg:border-t'
              : 'relative flex min-h-0 min-w-0 flex-col overflow-hidden border-l border-border bg-background max-lg:border-l-0 max-lg:border-t h-full'
          }
        >
          {rightCollapsed ? (
            <TooltipProvider delay={0}>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      className="flex size-full min-h-[200px] items-center justify-center rounded-xl border-0 bg-transparent text-muted-foreground hover:bg-accent/40 hover:text-foreground max-lg:min-h-9 max-lg:h-9 cursor-pointer"
                      onClick={() => setRightCollapsed(false)}
                      aria-label="Expand inspector"
                    >
                      <ChevronLeft className="size-4" />
                    </button>
                  }
                />
                <TooltipContent side="left">Expand inspector</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : (
            <Inspector
              document={draft}
              selectedControlId={selectedControlId}
              selectedSectionId={selectedSectionId}
              onDraftChange={handleDraftChange}
              errors={errors}
              locks={locks}
              onToggleLock={handleToggleLock}
              onCollapse={() => setRightCollapsed(true)}
              onDuplicateControl={handleDuplicateControl}
              onDeleteControl={handleDeleteControl}
              onAddHitfill={handleAddHitfill}
            />
          )}
        </div>

        {addDialogSection && (
          <AddControlDialog
            open
            document={draft}
            sectionId={addDialogSection}
            onOpenChange={(open) => {
              if (!open) setAddDialogSection(null);
            }}
            onAdd={handleAddControl}
          />
        )}

        {pickerOpen && (
          <LayoutPicker
            layouts={layouts}
            defaultId={config?.defaultLayout ?? draft.id}
            onOpen={(id) => void handleOpenPicked(id)}
            onCancel={handlePickerCancel}
          />
        )}

        {/* Fork dialog */}
        <Dialog open={forkOpen} onOpenChange={setForkOpen}>
          <DialogContent>
            <DialogTitle>Duplicate built-in layout</DialogTitle>
            <DialogDescription>
              {draft.name} is built-in and can't be edited. Make a copy to save
              your changes.
            </DialogDescription>
            {forkError && (
              <p className="rounded border border-destructive/20 bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
                {forkError}
              </p>
            )}
            <div className="space-y-2 py-2">
              <div>
                <Label htmlFor="fork-name">Name</Label>
                <Input
                  id="fork-name"
                  value={forkName}
                  onChange={(event) => setForkName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void handleForkConfirm();
                  }}
                />
              </div>
              <p className="text-[11px] text-muted-foreground">
                ID: <span className="font-mono">{slugifyId(forkName)}</span>
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <DialogClose
                render={
                  <Button type="button" variant="outline">
                    Cancel
                  </Button>
                }
              />
              <Button
                type="button"
                disabled={!forkName.trim() || forkBusy}
                onClick={() => void handleForkConfirm()}
              >
                Duplicate &amp; edit
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* New Layout dialog */}
        <Dialog
          open={newLayoutDialogOpen}
          onOpenChange={setNewLayoutDialogOpen}
        >
          <DialogContent>
            <DialogTitle>New layout</DialogTitle>
            <DialogDescription>
              Create a blank layout or clone an existing one.
            </DialogDescription>
            {newLayoutError && (
              <p className="rounded border border-destructive/20 bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
                {newLayoutError}
              </p>
            )}
            <div className="space-y-3 py-2">
              <div>
                <Label htmlFor="new-layout-name">Name</Label>
                <Input
                  id="new-layout-name"
                  value={newLayoutName}
                  onChange={(event) => setNewLayoutName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter')
                      void handleCreateNew(
                        newLayoutName,
                        newLayoutBase === 'blank' ? null : newLayoutBase,
                      );
                  }}
                />
              </div>
              <div>
                <Label htmlFor="new-layout-base">Base</Label>
                <Select
                  value={newLayoutBase}
                  onValueChange={(value) => {
                    if (value) setNewLayoutBase(value);
                  }}
                >
                  <SelectTrigger id="new-layout-base" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="blank">Blank</SelectItem>
                    {layouts.map((layout) => (
                      <SelectItem key={layout.id} value={layout.id}>
                        {layout.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <DialogClose
                render={
                  <Button type="button" variant="outline">
                    Cancel
                  </Button>
                }
              />
              <Button
                type="button"
                disabled={!newLayoutName.trim()}
                onClick={() =>
                  void handleCreateNew(
                    newLayoutName,
                    newLayoutBase === 'blank' ? null : newLayoutBase,
                  )
                }
              >
                Create
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        <AlertDialog open={discardOpen} onOpenChange={setDiscardOpen}>
          <AlertDialogContent>
            <AlertDialogTitle>Discard changes?</AlertDialogTitle>
            <AlertDialogDescription>
              Discard unsaved changes? This cannot be undone.
            </AlertDialogDescription>
            <div className="flex justify-end gap-2 pt-2">
              <AlertDialogCancel
                render={
                  <Button type="button" variant="outline">
                    Cancel
                  </Button>
                }
              />
              <Button
                type="button"
                variant="destructive"
                onClick={confirmDiscard}
              >
                Discard
              </Button>
            </div>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog open={backOpen} onOpenChange={setBackOpen}>
          <AlertDialogContent>
            <AlertDialogTitle>Leave editor?</AlertDialogTitle>
            <AlertDialogDescription>
              You have unsaved changes. Leave without saving?
            </AlertDialogDescription>
            <div className="flex justify-end gap-2 pt-2">
              <AlertDialogCancel
                render={
                  <Button type="button" variant="outline">
                    Stay
                  </Button>
                }
              />
              <Button type="button" variant="destructive" onClick={confirmBack}>
                Leave
              </Button>
            </div>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </TooltipProvider>
  );
}

const root = document.getElementById('root');
if (root) {
  root.replaceChildren();
  createRoot(root).render(<EditorApp />);
}
