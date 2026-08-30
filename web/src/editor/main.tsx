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
  updateAdminLayout,
} from '@/dashboard/api';
import type { AdminLayoutSummary } from '@/shared/contracts';
import type { Document as LayoutDocument } from '@/shared/generated/layout';
import { validateLayoutDetailed } from '@/shared/layout';
import {
  clampGeometry,
  cloneDocument,
  duplicateControl,
  findControl,
  isDefaultLocked,
  isDirty,
  LayoutHistory,
  moveControl,
  nextControlId,
  type SectionId,
} from '@/shared/layout-editor';
import { getSkin, initSkin } from '../skins/loader';
import {
  AddControlDialog,
  type AddControlResult,
} from './components/add-control-dialog';
import { Inspector } from './components/inspector';
import { LayoutCanvas } from './components/layout-canvas';
import { LayoutHeader } from './components/layout-header';
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
        const targetId =
          params.get('layout') ||
          state.config.defaultLayout ||
          state.layouts[0]?.id;
        if (!targetId) return;
        const doc = await getAdminLayout(targetId);
        if (cancelled) return;
        setDraft(cloneDocument(doc as LayoutDocument));
        setPersisted(cloneDocument(doc as LayoutDocument));
        historyRef.current.reset(doc as LayoutDocument);
        setDirty(false);
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

  // Draft change helper: optimistic dirty during drag, precise on commit
  const handleDraftChange = useCallback(
    (next: LayoutDocument, commit: boolean) => {
      setDraft(next);
      if (commit) {
        historyRef.current.push(next);
        markDirty(next);
      } else {
        markDirtyOptimistic();
      }
    },
    [markDirty, markDirtyOptimistic],
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
    } catch {
      setError('Failed to load layout.');
    }
  }, []);

  const handleNewLayout = useCallback(() => {
    setNewLayoutDialogOpen(true);
  }, []);

  const handleRename = useCallback(
    async (name: string) => {
      if (!draft) return;
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
    [draft],
  );

  const handleDelete = useCallback(async () => {
    if (!draft) return;
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
  }, [draft, config, handleSelectLayout]);

  const handleSave = useCallback(async () => {
    if (!draft || !persisted) return;
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
  }, [draft, persisted, errors, layouts]);

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
      if (!draft) return;
      const before = findControl(draft, controlId);
      if (!before) return;
      const next = duplicateControl(draft, controlId);
      // find new id: the control inserted after source
      const section = next.sections.find((s) => s.id === before.section.id);
      const idx = section?.controls.findIndex((c) => c.id === controlId) ?? -1;
      const newControl = section?.controls[idx + 1];
      setDraft(next);
      historyRef.current.push(next);
      markDirty(next);
      if (newControl) {
        setSelectedControlId(newControl.id);
        setSelectedSectionId(null);
      }
    },
    [draft, markDirty],
  );

  const handleDeleteControl = useCallback(
    (controlId: string) => {
      if (!draft) return;
      const next = cloneDocument(draft);
      let deletedIsParent = false;
      for (const section of next.sections) {
        const index = section.controls.findIndex(
          (candidate) => candidate.id === controlId,
        );
        if (index >= 0) {
          const removed = section.controls[index];
          deletedIsParent = removed.type !== 'hitfill';
          section.controls.splice(index, 1);
          break;
        }
      }
      // cascade: if deleted was a parent, delete its hitfills
      if (deletedIsParent) {
        for (const section of next.sections) {
          section.controls = section.controls.filter(
            (candidate) => candidate.parentId !== controlId,
          );
        }
      }
      setDraft(next);
      historyRef.current.push(next);
      markDirty(next);
      if (selectedControlId === controlId) setSelectedControlId(null);
      // if selected was a hitfill of deleted parent, also clear selection if it was removed?
      if (draft) {
        const stillExists = next.sections.some((s) =>
          s.controls.some((c) => c.id === selectedControlId),
        );
        if (!stillExists) setSelectedControlId(null);
      }
    },
    [draft, selectedControlId, markDirty],
  );

  const handleAddHitfill = useCallback(
    (parentId: string) => {
      if (!draft) return;
      const found = findControl(draft, parentId);
      if (!found) return;
      if (found.control.type === 'hitfill') return;
      const next = cloneDocument(draft);
      const targetSection = next.sections.find(
        (s) => s.id === found.section.id,
      );
      if (!targetSection) return;
      const parentControl = targetSection.controls.find(
        (c) => c.id === parentId,
      );
      if (!parentControl) return;
      const newId = nextControlId(next);
      const offsetPos = {
        x: parentControl.geometry.position.x + 0.04,
        y: parentControl.geometry.position.y + 0.04,
      };
      const rawGeom = {
        position: offsetPos,
        size: { width: 0.08, height: 0.08 },
      };
      const clamped = clampGeometry(rawGeom, targetSection);
      const hitfill = {
        id: newId,
        type: 'hitfill' as const,
        geometry: clamped,
        label: '',
        parentId,
        shape: 'rect' as const,
      };
      // insert after parent for visibility
      const parentIndex = targetSection.controls.findIndex(
        (c) => c.id === parentId,
      );
      targetSection.controls.splice(
        parentIndex + 1,
        0,
        hitfill as unknown as (typeof targetSection.controls)[number],
      );
      setDraft(next);
      historyRef.current.push(next);
      markDirty(next);
      setSelectedControlId(newId);
      setSelectedSectionId(null);
    },
    [draft, markDirty],
  );
  const deleteControlRef = useRef(handleDeleteControl);
  useEffect(() => {
    deleteControlRef.current = handleDeleteControl;
  }, [handleDeleteControl]);

  const handleMoveControl = useCallback(
    (controlId: string, direction: 'up' | 'down') => {
      if (!draft) return;
      const found = findControl(draft, controlId);
      if (!found) return;
      const fromIndex = found.section.controls.findIndex(
        (c) => c.id === controlId,
      );
      const toIndex = direction === 'up' ? fromIndex - 1 : fromIndex + 1;
      if (toIndex < 0 || toIndex >= found.section.controls.length) return;
      const next = moveControl(draft, found.section.id, fromIndex, toIndex);
      setDraft(next);
      historyRef.current.push(next);
      markDirty(next);
    },
    [draft, markDirty],
  );

  const handleReorderControl = useCallback(
    (sectionId: string, fromIndex: number, toIndex: number) => {
      if (!draft) return;
      const next = moveControl(draft, sectionId, fromIndex, toIndex);
      if (next === draft) return;
      setDraft(next);
      historyRef.current.push(next);
      markDirty(next);
    },
    [draft, markDirty],
  );

  const handleAddControl = useCallback(
    (result: AddControlResult) => {
      if (!draft) return;
      const next = cloneDocument(draft);
      const section = next.sections.find((s) => s.id === result.sectionId);
      if (!section) return;
      section.controls.push(result.control);
      setDraft(next);
      historyRef.current.push(next);
      markDirty(next);
      setSelectedControlId(result.control.id);
      setSelectedSectionId(null);
      setAddDialogSection(null);
    },
    [draft, markDirty],
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

  // New Layout dialog
  const [newLayoutName, setNewLayoutName] = useState('');
  const [newLayoutBase, setNewLayoutBase] = useState('blank');
  const [newLayoutError, setNewLayoutError] = useState<string | null>(null);

  const handleCreateNew = useCallback(
    async (name: string, baseId: string | null) => {
      if (!name.trim()) return;
      const id = name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '-');
      let doc: LayoutDocument;
      if (baseId && baseId !== 'blank') {
        const base = await getAdminLayout(baseId);
        doc = cloneDocument(base as LayoutDocument);
        doc.id = id;
        doc.name = name.trim();
      } else {
        doc = {
          id,
          name: name.trim(),
          schemaVersion: 2,
          defaultOrientation: 'landscape',
          sections: [
            { id: 'left', relativeWidth: 0.86, controls: [] },
            { id: 'center', relativeWidth: 0.5, controls: [] },
            { id: 'right', relativeWidth: 0.94, controls: [] },
          ],
          assets: [],
        };
      }
      try {
        await createAdminLayout(doc);
        setNewLayoutDialogOpen(false);
        setNewLayoutName('');
        setNewLayoutError(null);
        const state = await getAdminState();
        setLayouts(state.layouts);
        // Select the new layout
        await handleSelectLayout(id);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Creation failed.';
        setNewLayoutError(message);
      }
    },
    [handleSelectLayout],
  );

  if (!draft) {
    return (
      <div className="editor-shell">
        <div className="col-span-3 p-6 text-sm text-muted-foreground">
          Loading layout…
        </div>
      </div>
    );
  }

  const shellClass = [
    'editor-shell',
    leftCollapsed ? 'editor-shell--left-collapsed' : '',
    rightCollapsed ? 'editor-shell--right-collapsed' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <TooltipProvider delay={100}>
      <div className={shellClass}>
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
        />
        {error && (
          <div
            className="col-span-full flex items-center justify-between gap-3 rounded-lg border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            role="alert"
          >
            <span>{error}</span>
            <button
              type="button"
              onClick={() => setError(null)}
              className="shrink-0 rounded px-2 py-0.5 text-xs hover:bg-destructive/10"
              aria-label="Dismiss error"
            >
              ✕
            </button>
          </div>
        )}

        <div
          className={
            leftCollapsed
              ? 'editor-side editor-side--collapsed'
              : 'editor-side editor-side--left'
          }
        >
          {leftCollapsed ? (
            <TooltipProvider delay={100}>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      className="editor-collapse-strip"
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

        <LayoutCanvas
          document={draft}
          selectedControlId={selectedControlId}
          selectedSectionId={selectedSectionId}
          hoveredControlId={hoveredControlId}
          hoveredSectionId={hoveredSectionId}
          onSelectControl={setSelectedControlId}
          onSelectSection={(id) => setSelectedSectionId(id as SectionId | null)}
          onHoverSection={(id) => setHoveredSectionId(id as SectionId | null)}
          onDraftChange={handleDraftChange}
          locks={locks}
        />

        <div
          className={
            rightCollapsed
              ? 'editor-side editor-side--collapsed editor-side--right-collapsed'
              : 'editor-side editor-side--right'
          }
        >
          {rightCollapsed ? (
            <TooltipProvider delay={100}>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      className="editor-collapse-strip"
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
                      void handleCreateNew(newLayoutName, newLayoutBase);
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
                  void handleCreateNew(newLayoutName, newLayoutBase)
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
