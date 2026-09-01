import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type { SectionId } from '@/shared/layout-editor';
import { useEditorActions } from '../hooks/use-editor-actions';
import { useEditorStore } from '../store/editor-store';
import { AddControlDialog } from './add-control-dialog';
import {
  BackConfirmDialog,
  DiscardConfirmDialog,
} from './dialogs/confirm-dialogs';
import { ForkDialog } from './dialogs/fork-dialog';
import { NewLayoutDialog } from './dialogs/new-layout-dialog';
import { Inspector } from './inspector';
import { LayoutCanvas } from './layout-canvas';
import { LayoutHeader } from './layout-header';
import { LayoutPicker } from './layout-picker';
import { SectionsPanel } from './sections-panel';

export function EditorShell() {
  const draft = useEditorStore((s) => s.draft);
  const layouts = useEditorStore((s) => s.layouts);
  const config = useEditorStore((s) => s.config);
  const selectedControlId = useEditorStore((s) => s.selectedControlId);
  const selectedSectionId = useEditorStore((s) => s.selectedSectionId);
  const hoveredControlId = useEditorStore((s) => s.hoveredControlId);
  const hoveredSectionId = useEditorStore((s) => s.hoveredSectionId);
  const locks = useEditorStore((s) => s.locks);
  const addDialogSection = useEditorStore((s) => s.addDialogSection);
  const pickerOpen = useEditorStore((s) => s.pickerOpen);
  const leftCollapsed = useEditorStore((s) => s.leftCollapsed);
  const rightCollapsed = useEditorStore((s) => s.rightCollapsed);
  const error = useEditorStore((s) => s.error);
  const dirty = useEditorStore((s) => s.dirty);
  const canUndo = useEditorStore((s) => s.history.index > 0);
  const canRedo = useEditorStore(
    (s) => s.history.index < s.history.stack.length - 1,
  );

  const {
    errors,
    currentBuiltin,
    currentDefault,
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
  } = useEditorActions();

  if (!draft) {
    return (
      <div className="grid min-h-dvh place-items-center bg-background p-6">
        <div className="text-sm text-muted-foreground">Loading layout…</div>
      </div>
    );
  }

  const readOnly = currentBuiltin;
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
              canUndo={canUndo}
              canRedo={canRedo}
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
                onClick={() => useEditorStore.getState().setError(null)}
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
                      onClick={() =>
                        useEditorStore.getState().setLeftCollapsed(false)
                      }
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
              onSelectControl={(id) =>
                useEditorStore.getState().setSelectedControlId(id)
              }
              onSelectSection={(id) => {
                useEditorStore.getState().setSelectedSectionId(id as SectionId);
                useEditorStore.getState().setSelectedControlId(null);
              }}
              onHoverSection={(id) =>
                useEditorStore
                  .getState()
                  .setHoveredSectionId(id as SectionId | null)
              }
              onAddControl={(sectionId) =>
                useEditorStore
                  .getState()
                  .setAddDialogSection(sectionId as SectionId | null)
              }
              onMoveControl={handleMoveControl}
              onDuplicateControl={handleDuplicateControl}
              onDeleteControl={handleDeleteControl}
              onReorderControl={handleReorderControl}
              onHoverControl={(id) =>
                useEditorStore.getState().setHoveredControlId(id)
              }
              onCollapse={() =>
                useEditorStore.getState().setLeftCollapsed(true)
              }
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
            onSelectControl={(id) =>
              useEditorStore.getState().setSelectedControlId(id)
            }
            onSelectSection={(id) =>
              useEditorStore
                .getState()
                .setSelectedSectionId(id as SectionId | null)
            }
            onHoverSection={(id) =>
              useEditorStore
                .getState()
                .setHoveredSectionId(id as SectionId | null)
            }
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
                      onClick={() =>
                        useEditorStore.getState().setRightCollapsed(false)
                      }
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
              onCollapse={() =>
                useEditorStore.getState().setRightCollapsed(true)
              }
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
              if (!open) useEditorStore.getState().setAddDialogSection(null);
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

        <ForkDialog draftName={draft.name} onConfirm={handleForkConfirm} />
        <NewLayoutDialog onCreate={handleCreateNew} />
        <DiscardConfirmDialog onConfirm={confirmDiscard} />
        <BackConfirmDialog onConfirm={confirmBack} />
      </div>
    </TooltipProvider>
  );
}
