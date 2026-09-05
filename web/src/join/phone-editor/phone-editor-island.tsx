import { useEffect, useRef } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import type { FrameSender } from '@/controller/frame-sender';
import type { RenderedLayout } from '@/controller/layout-renderer';
import { findControlVisual, resolveLayout } from '@/controller/layout-resolver';
import type { InputStateStore } from '@/controller/state';
import { useInteractGeometry } from '@/hooks/use-interact-geometry';
import type { Document as LayoutDocument } from '@/shared/generated/layout';
import { validateLayout } from '@/shared/layout';
import {
  addHitzone,
  cloneDocument,
  deleteControl,
  duplicateControl,
  effectiveHitShape,
  findControl,
  getHitzonesOf,
  isAspectLockForced,
  moveControlAcross,
  moveParentWithHitzonesAcross,
  resizeControl,
  resolveAspectLock,
  rotationOf,
  updateControlRotation,
} from '@/shared/layout-editor';
import {
  loadPersonalLayouts,
  savePersonalLayout,
  slugify,
} from '../personal-layouts';
import { PhoneEditorBar } from './components/phone-editor-bar';
import { PhoneHit } from './components/phone-hit';
import { PhoneOnboarding } from './components/phone-onboarding';
import { usePhoneGestures } from './hooks/use-phone-gestures';
import { usePhoneViewport } from './hooks/use-phone-viewport';
import { usePhoneEditorStore } from './store/phone-editor-store';

interface IslandProps {
  initialDoc: LayoutDocument;
  sender: FrameSender;
  state: InputStateStore;
  renderer: RenderedLayout | undefined;
  hostLayoutIds?: string[];
  onSave: (doc: LayoutDocument) => void;
  onCancel: () => void;
}

function PhoneEditorIsland({
  initialDoc,
  sender,
  state,
  renderer,
  hostLayoutIds,
  onSave,
  onCancel,
}: IslandProps) {
  const draftFromStore = usePhoneEditorStore((s) => s.draft);
  const draft = draftFromStore ?? initialDoc;
  const name = usePhoneEditorStore((s) => s.name);
  const nameError = usePhoneEditorStore((s) => s.nameError);
  const selectedId = usePhoneEditorStore((s) => s.selectedId);
  const locks = usePhoneEditorStore((s) => s.locks);
  const showOnboarding = usePhoneEditorStore((s) => s.showOnboarding);
  const canUndo = usePhoneEditorStore((s) => s.history.index > 0);
  const canRedo = usePhoneEditorStore(
    (s) => s.history.index < s.history.stack.length - 1,
  );

  const setName = usePhoneEditorStore((s) => s.setName);
  const setNameError = usePhoneEditorStore((s) => s.setNameError);
  const setSelectedId = usePhoneEditorStore((s) => s.setSelectedId);
  const dismissOnboarding = usePhoneEditorStore((s) => s.dismissOnboarding);

  const originalIdRef = useRef(initialDoc.id);
  const selectedRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const { viewport, hostOrigin } = usePhoneViewport(renderer);

  const draftRef = useRef<LayoutDocument>(draft);
  draftRef.current = draft;
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  const locksRef = useRef(locks);
  locksRef.current = locks;
  const liveRafRef = useRef<number | null>(null);
  const pendingLiveRef = useRef<LayoutDocument | null>(null);

  const flushLive = (): void => {
    if (liveRafRef.current !== null) {
      cancelAnimationFrame(liveRafRef.current);
      liveRafRef.current = null;
    }
    pendingLiveRef.current = null;
  };

  // Single rAF-batched path for live (uncommitted) draft updates. Keeps
  // draftRef in sync for the next delta while coalescing store writes.
  const queueLive = (next: LayoutDocument): void => {
    draftRef.current = next;
    pendingLiveRef.current = next;
    if (liveRafRef.current === null) {
      liveRafRef.current = requestAnimationFrame(() => {
        liveRafRef.current = null;
        const pending = pendingLiveRef.current;
        pendingLiveRef.current = null;
        if (pending) usePhoneEditorStore.getState().setDraftLive(pending);
      });
    }
  };

  useEffect(() => {
    return () => {
      if (liveRafRef.current !== null) cancelAnimationFrame(liveRafRef.current);
    };
  }, []);

  const isPinchingRef = useRef(false);
  const isMultiTouchRef = useRef(false);
  const activePointersRef = useRef<Set<number>>(new Set());
  const gestureRefs = {
    isPinching: isPinchingRef,
    isMultiTouch: isMultiTouchRef,
    activePointers: activePointersRef,
  };

  usePhoneGestures(
    overlayRef,
    gestureRefs,
    draftRef,
    selectedIdRef,
    locksRef,
    queueLive,
  );

  useEffect(() => {
    usePhoneEditorStore.getState().resetDocument(initialDoc);
    originalIdRef.current = initialDoc.id;
    const wasRunning = sender.isRunning;
    if (wasRunning) sender.stop();
    renderer?.cancelPointers();
    state.reset();
    return () => {
      if (wasRunning) sender.start();
      try {
        renderer?.update(initialDoc);
      } catch {}
    };
  }, [initialDoc]);

  useEffect(() => {
    if (!draft || !renderer) return;
    try {
      renderer.update(draft);
    } catch {}
  }, [draft, viewport, renderer]);

  const resolved = draft ? resolveLayout(draft, viewport, 'landscape') : null;

  const selectedControl =
    selectedId && draft
      ? (findControl(draft, selectedId)?.control ?? null)
      : null;

  // Validation forbids hitzones parenting hitzones, so a hitzone id never
  // has peers and no type lookup is needed.
  const selectedPeerIds = new Set(
    selectedId ? getHitzonesOf(draft, selectedId) : [],
  );

  const locked = selectedControl
    ? resolveAspectLock(selectedControl, locks)
    : true;

  const selectedRect = findControlVisual(resolved, selectedId);

  const handleCommit = (next: LayoutDocument): void => {
    flushLive();
    draftRef.current = next;
    usePhoneEditorStore.getState().commitDraft(next);
  };

  const handleDrag = (deltaX: number, deltaY: number): void => {
    if (!selectedId) return;
    if (isMultiTouchRef.current || isPinchingRef.current) return;
    const cur = draftRef.current as LayoutDocument;
    if (!cur) return;
    const hasHitzones = getHitzonesOf(cur, selectedId).length > 0;
    let next: LayoutDocument;
    if (hasHitzones) {
      next = moveParentWithHitzonesAcross(
        cur,
        selectedId,
        deltaX,
        deltaY,
        viewport,
      );
    } else {
      next = moveControlAcross(cur, selectedId, deltaX, deltaY, viewport);
    }
    queueLive(next);
  };

  const handleResize = (
    deltaWidth: number,
    deltaHeight: number,
    deltaLeft: number,
    deltaTop: number,
    lockedArg: boolean,
  ): void => {
    if (!selectedId) return;
    if (isMultiTouchRef.current || isPinchingRef.current) return;
    const cur = draftRef.current as LayoutDocument;
    const effectiveLocked = lockedArg ?? locked;
    const next = resizeControl(
      cur,
      selectedId,
      deltaWidth,
      deltaHeight,
      effectiveLocked,
      deltaLeft,
      deltaTop,
    );
    queueLive(next);
  };

  const commit = (): void => {
    if (isPinchingRef.current || isMultiTouchRef.current) return;
    flushLive();
    handleCommit(draftRef.current as LayoutDocument);
  };

  useInteractGeometry({
    enabled: Boolean(selectedRect && selectedId),
    targetRef: selectedRef,
    viewportHeight: viewport.height,
    scale: 1,
    key: selectedId ?? undefined,
    locked,
    edges: {
      left: '.phone-editor-handle.tl, .phone-editor-handle.bl',
      right: '.phone-editor-handle.tr, .phone-editor-handle.br',
      top: '.phone-editor-handle.tl, .phone-editor-handle.tr',
      bottom: '.phone-editor-handle.bl, .phone-editor-handle.br',
    },
    onDrag: handleDrag,
    onResize: handleResize,
    onDragEnd: commit,
    onResizeEnd: commit,
  });

  const handleDelete = (): void => {
    const cur = draftRef.current;
    const sid = selectedIdRef.current;
    if (!cur || !sid) return;
    const next = deleteControl(cur, sid);
    queueLive(next);
    handleCommit(next);
    setSelectedId(null);
  };

  const handleDuplicate = (): void => {
    const cur = draftRef.current;
    const sid = selectedIdRef.current;
    if (!cur || !sid) return;
    const found = findControl(cur, sid);
    if (!found) return;
    const next = duplicateControl(cur, sid);
    const section = next.sections.find((s) => s.id === found.section.id);
    const idx = section?.controls.findIndex((cc) => cc.id === sid) ?? -1;
    const newCtrl = section?.controls[idx + 1];
    queueLive(next);
    handleCommit(next);
    if (newCtrl) setSelectedId(newCtrl.id);
  };

  const handleAddHitzone = (): void => {
    const cur = draftRef.current;
    const sid = selectedIdRef.current;
    if (!cur || !sid) return;
    const found = findControl(cur, sid);
    if (!found || found.control.type === 'hitzone') return;
    const next = addHitzone(cur, sid);
    if (!next) return;
    const section = next.sections.find((s) => s.id === found.section.id);
    const idx = section?.controls.findIndex((cc) => cc.id === sid) ?? -1;
    const newCtrl = section?.controls[idx + 1];
    queueLive(next);
    handleCommit(next);
    if (newCtrl) setSelectedId(newCtrl.id);
  };

  const handleToggleShape = (): void => {
    const cur = draftRef.current;
    const sid = selectedIdRef.current;
    if (!cur || !sid) return;
    const found = findControl(cur, sid);
    if (!found) return;
    if (found.control.type === 'dpad' || found.control.type === 'label') return;
    const next = cloneDocument(cur);
    const target = next.sections
      .find((s) => s.id === found.section.id)
      ?.controls.find((cc) => cc.id === sid);
    if (!target) return;
    if (target.shape === 'round') target.shape = 'rect';
    else target.shape = 'round';
    delete (target as unknown as Record<string, unknown>).hitShape;
    queueLive(next);
    handleCommit(next);
  };

  const handleRotate = (): void => {
    const cur = draftRef.current;
    const sid = selectedIdRef.current;
    if (!cur || !sid) return;
    const found = findControl(cur, sid);
    if (found?.control.type !== 'hitzone') return;
    const next = updateControlRotation(
      cur,
      sid,
      rotationOf(found.control) + 15,
    );
    queueLive(next);
    handleCommit(next);
  };

  const handleSave = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError('Name is required.');
      return;
    }
    const slug = slugify(trimmed);
    const existing = loadPersonalLayouts();
    const isEditingExisting = !!existing[originalIdRef.current];
    if (existing[slug] && slug !== originalIdRef.current) {
      setNameError(`An edit named "${trimmed}" already exists.`);
      return;
    }
    if (hostLayoutIds?.includes(slug)) {
      setNameError(
        `"${trimmed}" collides with a host layout. Use a different name.`,
      );
      return;
    }
    const cur = draftRef.current;
    if (!cur) return;
    const nextDoc: LayoutDocument = {
      ...cloneDocument(cur),
      id: slug,
      name: trimmed,
    };
    if (!validateLayout(nextDoc)) {
      setNameError('Layout is invalid.');
      return;
    }
    const err = savePersonalLayout(nextDoc);
    if (err) {
      setNameError(err);
      return;
    }
    if (isEditingExisting && originalIdRef.current !== slug) {
      try {
        const all = loadPersonalLayouts();
        delete all[originalIdRef.current];
        localStorage.setItem('airdeck.personalLayouts', JSON.stringify(all));
      } catch {}
    }
    state.reset();
    onSave(nextDoc);
  };

  const handleBack = () => {
    state.reset();
    try {
      renderer?.update(initialDoc);
    } catch {}
    onCancel();
  };

  const handleUndo = () => {
    const prev = usePhoneEditorStore.getState().historyUndo();
    if (prev) queueLive(prev);
  };

  const handleRedo = () => {
    const next = usePhoneEditorStore.getState().historyRedo();
    if (next) queueLive(next);
  };

  const handleToggleLock = () => {
    const sid = selectedIdRef.current;
    const cur = draftRef.current;
    if (!sid || !cur) return;
    const found = findControl(cur, sid);
    if (!found) return;
    if (isAspectLockForced(found.control)) return;
    const curLock = resolveAspectLock(found.control, locks);
    usePhoneEditorStore.getState().toggleLock(sid, curLock);
  };

  if (!draft || !resolved) return null;

  return (
    <div
      ref={overlayRef}
      className="phone-editor-overlay fixed inset-0 z-40 touch-none select-none"
      data-phone-overlay
      onClick={(event) => {
        if (event.target === event.currentTarget) setSelectedId(null);
      }}
    >
      <PhoneEditorBar
        name={name}
        nameError={nameError}
        selectedId={selectedId}
        draft={draft}
        originalId={originalIdRef.current}
        locks={locks}
        canUndo={canUndo}
        canRedo={canRedo}
        onNameChange={setName}
        onClearError={() => setNameError(null)}
        onBack={handleBack}
        onSave={handleSave}
        onDelete={handleDelete}
        onToggleLock={handleToggleLock}
        onDuplicate={handleDuplicate}
        onAddHitzone={handleAddHitzone}
        onToggleShape={handleToggleShape}
        onRotate={handleRotate}
        onUndo={handleUndo}
        onRedo={handleRedo}
      />

      <div
        className="absolute inset-0 pointer-events-none"
        data-phone-canvas-wrap
        style={{ top: 32 }}
        onClick={(e) => {
          if (e.target === e.currentTarget) setSelectedId(null);
        }}
      >
        {resolved.sections.flatMap((section) =>
          section.controls.map((rc) => {
            const isSelected = rc.control.id === selectedId;
            const isHitzone = rc.control.type === 'hitzone';
            const hitShape = effectiveHitShape(rc.control);
            const BAR_H = 32;
            const left = hostOrigin.x + rc.visual.left;
            const top = hostOrigin.y + rc.visual.top - BAR_H;
            const isPeer = selectedPeerIds.has(rc.control.id);
            const isForgiving =
              isSelected &&
              hitShape === 'rect' &&
              rc.control.shape === 'round' &&
              !isHitzone &&
              rc.control.type !== 'label' &&
              rc.control.type !== 'dpad';
            const showHitzoneHatch = isHitzone && (isPeer || isSelected);
            return (
              <PhoneHit
                key={rc.control.id}
                control={rc.control}
                left={left}
                top={top}
                width={rc.visual.width}
                height={rc.visual.height}
                hitShape={hitShape}
                isSelected={isSelected}
                isHitzone={isHitzone}
                isPeer={isPeer}
                isForgiving={isForgiving}
                showHitzoneHatch={showHitzoneHatch}
                viewport={viewport}
                viewportHeight={viewport.height}
                draftRef={draftRef}
                selectedId={selectedId}
                onSelect={(id) => setSelectedId(id)}
                onDraftLive={queueLive}
                onCommit={handleCommit}
                selectedRef={selectedRef}
                locked={locked}
                isMultiTouchRef={isMultiTouchRef}
                isPinchingRef={isPinchingRef}
              />
            );
          }),
        )}
      </div>

      {showOnboarding && <PhoneOnboarding onDismiss={dismissOnboarding} />}
    </div>
  );
}

export interface PhoneEditorHandle {
  unmount: () => void;
  isDestroyed: () => boolean;
}

export function mountPhoneEditor(
  hostEl: HTMLElement,
  options: {
    document: LayoutDocument;
    sender: FrameSender;
    state: InputStateStore;
    renderer?: RenderedLayout;
    hostLayoutIds?: string[];
    onSave: (doc: LayoutDocument) => void;
    onCancel: () => void;
  },
): PhoneEditorHandle {
  const container = document.createElement('div');
  hostEl.append(container);
  const root: Root = createRoot(container);
  let destroyed = false;

  const cleanup = () => {
    if (destroyed) return;
    destroyed = true;
    try {
      root.unmount();
    } catch {}
    container.remove();
  };

  const handleSave = (doc: LayoutDocument) => {
    cleanup();
    options.onSave(doc);
  };
  const handleCancel = () => {
    cleanup();
    options.onCancel();
  };

  flushSync(() =>
    root.render(
      <PhoneEditorIsland
        initialDoc={options.document}
        sender={options.sender}
        state={options.state}
        renderer={options.renderer}
        hostLayoutIds={options.hostLayoutIds}
        onSave={handleSave}
        onCancel={handleCancel}
      />,
    ),
  );

  return {
    unmount: cleanup,
    isDestroyed: () => destroyed,
  };
}
