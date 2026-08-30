import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@/index.css';
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
  createAdminLayout,
  deleteAdminLayout,
  getAdminLayout,
  getAdminState,
  reloadAdminLayouts,
  updateAdminLayout,
} from '@/dashboard/api';
import type { AdminLayoutSummary } from '@/shared/contracts';
import type { Document as LayoutDocument } from '@/shared/generated/layout';
import { validateLayoutDetailed } from '@/shared/layout';
import {
  cloneDocument,
  isDirty,
  LayoutHistory,
  type SectionId,
} from '@/shared/layout-editor';
import {
  AddControlDialog,
  type AddControlResult,
} from './components/add-control-dialog';
import { Inspector } from './components/inspector';
import { LayoutCanvas } from './components/layout-canvas';
import { LayoutHeader } from './components/layout-header';
import { duplicateControl, SectionsPanel } from './components/sections-panel';
import './editor.css';

function EditorApp() {
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
  const [locks, setLocks] = useState<Record<string, boolean>>({});
  const [detachedIds, setDetachedIds] = useState<Set<string>>(new Set());
  const [addDialogSection, setAddDialogSection] = useState<SectionId | null>(
    null,
  );
  const [newLayoutDialogOpen, setNewLayoutDialogOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const historyRef = useRef<LayoutHistory>(new LayoutHistory(50));

  const dirty = useMemo(
    () => draft !== null && persisted !== null && isDirty(draft, persisted),
    [draft, persisted],
  );

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
          if (next) setDraft(next);
        } else {
          const previous = historyRef.current.undo();
          if (previous) setDraft(previous);
        }
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        const next = historyRef.current.redo();
        if (next) setDraft(next);
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
  }, [selectedControlId]);

  // Draft change helper
  const handleDraftChange = useCallback(
    (next: LayoutDocument, commit: boolean) => {
      setDraft(next);
      if (commit) historyRef.current.push(next);
    },
    [],
  );

  const handleSelectLayout = useCallback(async (id: string) => {
    try {
      const doc = await getAdminLayout(id);
      setDraft(cloneDocument(doc as LayoutDocument));
      setPersisted(cloneDocument(doc as LayoutDocument));
      historyRef.current.reset(doc as LayoutDocument);
      setSelectedControlId(null);
      setSelectedSectionId(null);
      setLocks({});
      setDetachedIds(new Set());
    } catch {
      setToast('Failed to load layout.');
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

  const handleReload = useCallback(async () => {
    await reloadAdminLayouts();
    const state = await getAdminState();
    setLayouts(state.layouts);
    // Reload current doc
    if (draft) {
      const doc = await getAdminLayout(draft.id);
      if (doc) {
        setDraft(cloneDocument(doc as LayoutDocument));
        setPersisted(cloneDocument(doc as LayoutDocument));
        historyRef.current.reset(doc as LayoutDocument);
      }
    }
  }, [draft]);

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
      const state = await getAdminState();
      setLayouts(state.layouts);
      setToast(`Saved "${draft.name}" — assign it from the roster.`);
      setTimeout(() => setToast(null), 3000);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Save failed.';
      setToast(message);
      setTimeout(() => setToast(null), 3000);
    }
  }, [draft, persisted, errors, layouts]);

  const handleDiscard = useCallback(() => {
    if (!persisted) return;
    if (dirty && !window.confirm('Discard unsaved changes?')) return;
    setDraft(cloneDocument(persisted));
    historyRef.current.reset(persisted);
    setSelectedControlId(null);
    setSelectedSectionId(null);
  }, [persisted, dirty]);

  const handleUndo = useCallback(() => {
    const previous = historyRef.current.undo();
    if (previous) setDraft(previous);
  }, []);

  const handleRedo = useCallback(() => {
    const next = historyRef.current.redo();
    if (next) setDraft(next);
  }, []);

  const handleBack = useCallback(() => {
    if (dirty && !window.confirm('Discard unsaved changes?')) return;
    window.location.href = '/dashboard';
  }, [dirty]);

  // Control CRUD
  // Control CRUD
  const handleDuplicateControl = useCallback(
    (controlId: string) => {
      if (!draft) return;
      const next = duplicateControl(draft, controlId);
      setDraft(next);
      historyRef.current.push(next);
    },
    [draft],
  );

  const handleDeleteControl = useCallback(
    (controlId: string) => {
      if (!draft) return;
      const next = cloneDocument(draft);
      for (const section of next.sections) {
        const index = section.controls.findIndex(
          (candidate) => candidate.id === controlId,
        );
        if (index >= 0) {
          section.controls.splice(index, 1);
          break;
        }
      }
      setDraft(next);
      historyRef.current.push(next);
      if (selectedControlId === controlId) setSelectedControlId(null);
    },
    [draft, selectedControlId],
  );
  const deleteControlRef = useRef(handleDeleteControl);
  useEffect(() => {
    deleteControlRef.current = handleDeleteControl;
  }, [handleDeleteControl]);

  const handleMoveControl = useCallback(
    (controlId: string, direction: 'up' | 'down') => {
      if (!draft) return;
      const next = cloneDocument(draft);
      for (const section of next.sections) {
        const index = section.controls.findIndex(
          (candidate) => candidate.id === controlId,
        );
        if (index >= 0) {
          const target = direction === 'up' ? index - 1 : index + 1;
          if (target >= 0 && target < section.controls.length) {
            const [moved] = section.controls.splice(index, 1);
            section.controls.splice(target, 0, moved);
          }
          break;
        }
      }
      setDraft(next);
      historyRef.current.push(next);
    },
    [draft],
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
      setSelectedControlId(result.control.id);
      setSelectedSectionId(null);
      setAddDialogSection(null);
    },
    [draft],
  );

  // Lock/Detach toggles
  const handleToggleLock = useCallback((id: string) => {
    setLocks((prev) => {
      const next = { ...prev };
      if (next[id]) delete next[id];
      else next[id] = true;
      return next;
    });
  }, []);

  const handleToggleDetach = useCallback((id: string) => {
    setDetachedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

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
        <div className="col-span-3 p-6 text-sm text-white/60">
          Loading layout…
        </div>
      </div>
    );
  }

  return (
    <div className="editor-shell">
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
        onReload={handleReload}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onDiscard={handleDiscard}
        onSave={handleSave}
        onBack={handleBack}
      />

      <SectionsPanel
        document={draft}
        selectedControlId={selectedControlId}
        onSelectControl={setSelectedControlId}
        onAddControl={(sectionId) =>
          setAddDialogSection(sectionId as SectionId | null)
        }
        onDuplicateControl={handleDuplicateControl}
        onDeleteControl={handleDeleteControl}
        onMoveControl={handleMoveControl}
      />

      <LayoutCanvas
        document={draft}
        selectedControlId={selectedControlId}
        onSelectControl={setSelectedControlId}
        onSelectSection={(id) => setSelectedSectionId(id as SectionId | null)}
        onDraftChange={handleDraftChange}
        locks={locks}
        detached={detachedIds}
        onToggleDetach={handleToggleDetach}
      />

      <Inspector
        document={draft}
        selectedControlId={selectedControlId}
        selectedSectionId={selectedSectionId}
        onDraftChange={handleDraftChange}
        errors={errors}
        locks={locks}
        onToggleLock={handleToggleLock}
        detached={detachedIds}
        onToggleDetach={handleToggleDetach}
      />

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
      <Dialog open={newLayoutDialogOpen} onOpenChange={setNewLayoutDialogOpen}>
        <DialogContent>
          <DialogTitle>New layout</DialogTitle>
          <DialogDescription>
            Create a blank layout or clone an existing one.
          </DialogDescription>
          {newLayoutError && (
            <p className="rounded bg-red-900/20 px-2 py-1.5 text-xs text-red-400">
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
              onClick={() => void handleCreateNew(newLayoutName, newLayoutBase)}
            >
              Create
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {toast && (
        <div className="fixed bottom-6 right-6 z-50 rounded-lg bg-white px-4 py-2 text-sm text-black shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}

const root = document.getElementById('root');
if (root) {
  root.replaceChildren();
  createRoot(root).render(<EditorApp />);
}
