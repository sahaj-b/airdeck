import {
  ArrowLeft,
  Circle,
  Copy,
  Lock,
  LockOpen,
  Plus,
  Redo2,
  Square,
  Trash2,
  Undo2,
} from 'lucide-react';
import type { Document as LayoutDocument } from '@/shared/generated/layout';
import {
  findControl,
  isAspectLockForced,
  resolveAspectLock,
} from '@/shared/layout-editor';
import { loadPersonalLayouts } from '../../personal-layouts';

interface PhoneEditorBarProps {
  name: string;
  nameError: string | null;
  selectedId: string | null;
  draft: LayoutDocument | null;
  originalId: string | null;
  locks: Record<string, boolean>;
  canUndo: boolean;
  canRedo: boolean;
  onNameChange: (v: string) => void;
  onClearError: () => void;
  onBack: () => void;
  onSave: () => void;
  onDelete: () => void;
  onToggleLock: () => void;
  onDuplicate: () => void;
  onAddHitzone: () => void;
  onToggleShape: () => void;
  onUndo: () => void;
  onRedo: () => void;
}

export function PhoneEditorBar({
  name,
  nameError,
  selectedId,
  draft,
  originalId,
  locks,
  canUndo,
  canRedo,
  onNameChange,
  onClearError,
  onBack,
  onSave,
  onDelete,
  onToggleLock,
  onDuplicate,
  onAddHitzone,
  onToggleShape,
  onUndo,
  onRedo,
}: PhoneEditorBarProps) {
  const selectedControl =
    selectedId && draft
      ? (findControl(draft, selectedId)?.control ?? null)
      : null;
  const locked = selectedControl
    ? resolveAspectLock(selectedControl, locks)
    : true;
  const lockDisabled =
    !selectedId ||
    (selectedControl ? isAspectLockForced(selectedControl) : false);

  const isCreate = originalId ? !loadPersonalLayouts()[originalId] : true;

  return (
    <>
      <div
        className="phone-editor-bar absolute top-0 left-0 right-0 h-8 flex items-center gap-3 px-2.5 bg-black/40 z-10 pointer-events-auto border-b border-white/10"
        data-phone-bar
      >
        <button
          type="button"
          className="grid place-items-center size-7 shrink-0 rounded border border-white/20 bg-white text-black cursor-pointer hover:bg-white/90"
          aria-label="Cancel"
          onClick={onBack}
        >
          <ArrowLeft size={14} strokeWidth={2.5} />
        </button>
        <input
          type="text"
          enterKeyHint="done"
          inputMode="text"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          className={`min-w-0 flex-1 max-w-[50vw] truncate bg-transparent border-0 border-b px-0.5 py-1 text-xs leading-none outline-none placeholder:text-white/50 ${nameError ? 'border-red-500 text-red-300 focus:border-red-500' : 'border-white/20 text-white focus:border-white/60'}`}
          value={name}
          onChange={(e) => {
            onNameChange(e.target.value);
            if (nameError) onClearError();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              (e.currentTarget as HTMLInputElement).blur();
            }
          }}
          placeholder="Layout name"
        />
        <div className="ml-auto flex items-center gap-2.5">
          <button
            type="button"
            className="grid place-items-center size-6 shrink-0 rounded bg-red-500/90 hover:bg-red-500 border border-white/15 text-white cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
            aria-label="Delete control"
            title="Delete control"
            disabled={!selectedId}
            onClick={onDelete}
          >
            <Trash2 size={12} />
          </button>
          <button
            type="button"
            className={`grid place-items-center size-6 shrink-0 rounded border cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed ${selectedId && locked ? 'bg-white text-black border-white hover:bg-white/90' : 'bg-white/10 text-white border-white/15 hover:bg-white/20'}`}
            aria-label={locked ? 'Unlock aspect ratio' : 'Lock aspect ratio'}
            title={
              lockDisabled && selectedId
                ? 'Joysticks stay square'
                : locked
                  ? 'Unlock aspect ratio'
                  : 'Lock aspect ratio'
            }
            disabled={lockDisabled}
            onClick={onToggleLock}
          >
            {locked ? <Lock size={12} /> : <LockOpen size={12} />}
          </button>
          <button
            type="button"
            className="grid place-items-center size-6 shrink-0 rounded border bg-white/10 text-white border-white/15 hover:bg-white/20 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
            aria-label="Duplicate control"
            title="Duplicate control"
            disabled={!selectedId}
            onClick={onDuplicate}
          >
            <Copy size={12} />
          </button>
          <button
            type="button"
            className="grid place-items-center size-6 shrink-0 rounded border bg-white/10 text-white border-white/15 hover:bg-white/20 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
            aria-label="Add hitzone"
            title="Add hitzone"
            disabled={!selectedControl || selectedControl.type === 'hitzone'}
            onClick={onAddHitzone}
          >
            <span className="relative flex items-center justify-center size-[14px] rounded-[3px] border border-dashed border-yellow-400 bg-violet-500/10 overflow-hidden">
              <span
                className="absolute inset-0 opacity-30"
                style={{
                  backgroundImage:
                    'repeating-linear-gradient(135deg, rgb(139 92 246 / 0.5) 0 1px, transparent 1px 7px), repeating-linear-gradient(45deg, rgb(139 92 246 / 0.5) 0 1px, transparent 1px 7px)',
                }}
              />
              <Plus
                size={8}
                className="relative text-white"
                strokeWidth={2.5}
              />
            </span>
          </button>
          <button
            type="button"
            className={`grid place-items-center size-6 shrink-0 rounded border cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed ${selectedControl && (selectedControl.type === 'dpad' || selectedControl.type === 'label') ? 'bg-white/10 text-white/40 border-white/10' : selectedControl && selectedControl.shape === 'round' ? 'bg-white text-black border-white hover:bg-white/90' : 'bg-white/10 text-white border-white/15 hover:bg-white/20'}`}
            aria-label="Toggle shape"
            title={
              selectedControl?.shape === 'round'
                ? 'Shape: round → rect'
                : 'Shape: rect → round'
            }
            disabled={
              !selectedControl ||
              selectedControl.type === 'dpad' ||
              selectedControl.type === 'label'
            }
            onClick={onToggleShape}
          >
            {selectedControl?.shape === 'round' ? (
              <Circle size={12} />
            ) : (
              <Square size={12} />
            )}
          </button>
          <button
            type="button"
            className="grid size-6 shrink-0 place-items-center rounded border border-white/20 bg-transparent text-white cursor-pointer disabled:opacity-40"
            aria-label="Undo"
            onClick={onUndo}
            disabled={!canUndo}
            style={{ opacity: canUndo ? 1 : 0.4 }}
          >
            <Undo2 size={12} strokeWidth={2} />
          </button>
          <button
            type="button"
            className="grid size-6 shrink-0 place-items-center rounded border border-white/20 bg-transparent text-white cursor-pointer disabled:opacity-40"
            aria-label="Redo"
            onClick={onRedo}
            disabled={!canRedo}
            style={{ opacity: canRedo ? 1 : 0.4 }}
          >
            <Redo2 size={12} strokeWidth={2} />
          </button>
          <div
            className="w-px h-4 bg-white/15 shrink-0 mx-1.5"
            aria-hidden="true"
          />
          <button
            type="button"
            className="h-[22px] px-2 shrink-0 rounded-md border border-white/20 bg-white text-black text-xs font-semibold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed hover:bg-white/90"
            onClick={onSave}
          >
            {isCreate ? 'Create' : 'Save'}
          </button>
        </div>
      </div>
      {nameError && (
        <div
          className="absolute top-8 left-0 right-0 bg-red-500/90 text-white text-[11px] px-2 py-0.5 z-[11]"
          style={{ background: 'rgba(239,68,68,0.9)' }}
        >
          {nameError}
        </div>
      )}
    </>
  );
}
