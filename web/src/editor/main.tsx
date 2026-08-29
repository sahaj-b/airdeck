import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { LayoutDocument } from '@/shared/layout';
import { cloneDocument, isDirty, LayoutHistory } from '@/shared/layout-editor';
import './editor.css';

function EditorApp() {
  const [draft, setDraft] = useState<LayoutDocument | null>(null);
  const [persisted, setPersisted] = useState<LayoutDocument | null>(null);
  const [selectedId, setSelectedId] = useState<string>('');
  const [layouts, setLayouts] = useState<{ id: string; name: string }[]>([]);
  const historyRef = useRef<LayoutHistory>(new LayoutHistory(50));

  const dirty = useMemo(() => {
    if (!draft || !persisted) return false;
    return isDirty(draft, persisted);
  }, [draft, persisted]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const response = await fetch('/api/admin/state', {
          credentials: 'same-origin',
        });
        if (!response.ok) return;
        const data = (await response.json()) as {
          layouts: { id: string; name: string }[];
          config: { defaultLayout: string };
        };
        if (cancelled) return;
        setLayouts(data.layouts);
        const targetId =
          selectedId || data.config.defaultLayout || data.layouts[0]?.id;
        if (!targetId) return;
        const docResponse = await fetch(
          `/api/admin/layouts/${encodeURIComponent(targetId)}`,
          { credentials: 'same-origin' },
        );
        if (!docResponse.ok) return;
        const doc = (await docResponse.json()) as LayoutDocument;
        if (cancelled) return;
        setDraft(cloneDocument(doc));
        setPersisted(cloneDocument(doc));
        historyRef.current.reset(doc);
      } catch {
        // leave empty state for local dev without host
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [dirty]);

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
      if (event.key === 'Escape') setSelectedId('');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const handleSave = async () => {
    if (!draft || !persisted) return;
    const isNew = !layouts.some((layout) => layout.id === draft.id);
    const method = isNew ? 'POST' : 'PUT';
    const url = isNew
      ? '/api/admin/layouts'
      : `/api/admin/layouts/${encodeURIComponent(draft.id)}`;
    const response = await fetch(url, {
      method,
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(draft),
    });
    if (response.ok) {
      setPersisted(cloneDocument(draft));
      historyRef.current.push(draft);
    }
  };

  const handleDiscard = () => {
    if (!persisted) return;
    if (dirty && !window.confirm('Discard unsaved changes?')) return;
    setDraft(cloneDocument(persisted));
    historyRef.current.reset(persisted);
  };

  if (!draft) {
    return (
      <div className="editor-shell">
        <div className="p-6 text-sm text-white/60">Loading layout...</div>
      </div>
    );
  }

  return (
    <div className="editor-shell">
      <header className="col-span-3 flex items-center gap-3 border-b border-white/10 pb-3">
        <a href="/dashboard" className="text-sm text-white/70 hover:text-white">
          ← Dashboard
        </a>
        <div className="ml-auto flex items-center gap-2">
          {dirty && (
            <span className="text-xs text-amber-400">● Unsaved changes</span>
          )}
          <button
            type="button"
            className="rounded bg-white/10 px-3 py-1.5 text-xs text-white hover:bg-white/15"
            onClick={handleDiscard}
            disabled={!dirty}
          >
            Discard
          </button>
          <button
            type="button"
            className="rounded bg-white px-3 py-1.5 text-xs font-medium text-black hover:bg-white/90 disabled:opacity-50"
            onClick={() => void handleSave()}
            disabled={!dirty}
          >
            Save
          </button>
          <button
            type="button"
            className="rounded bg-white/10 px-2 py-1.5 text-xs text-white"
            onClick={() => {
              const previous = historyRef.current.undo();
              if (previous) setDraft(previous);
            }}
            disabled={!historyRef.current.canUndo}
            title="Undo Ctrl+Z"
          >
            Undo
          </button>
          <button
            type="button"
            className="rounded bg-white/10 px-2 py-1.5 text-xs text-white"
            onClick={() => {
              const next = historyRef.current.redo();
              if (next) setDraft(next);
            }}
            disabled={!historyRef.current.canRedo}
            title="Redo Ctrl+Shift+Z"
          >
            Redo
          </button>
        </div>
      </header>
      <section className="rounded-xl border border-white/10 p-3">
        <h2 className="text-xs font-semibold text-white/80">Layouts</h2>
        <ul className="mt-2 space-y-1">
          {layouts.map((layout) => (
            <li key={layout.id}>
              <button
                type="button"
                className={`w-full rounded px-2 py-1.5 text-left text-xs ${draft.id === layout.id ? 'bg-white text-black' : 'text-white/70 hover:bg-white/10 hover:text-white'}`}
                onClick={() => setSelectedId(layout.id)}
              >
                {layout.name}
              </button>
            </li>
          ))}
        </ul>
      </section>
      <section className="editor-canvas min-h-[520px] p-4">
        <div className="text-xs text-white/60">
          Preview canvas (full interaction in Phase 4). Draft: {draft.name}
        </div>
        <div className="mt-4 text-xs text-white/40">
          Selected: {selectedId || draft.id}
        </div>
      </section>
      <section className="editor-inspector rounded-xl border border-white/10 p-3">
        <h2 className="text-xs font-semibold text-white/80">Inspector</h2>
        <div className="mt-3 space-y-3">
          <label className="block text-xs text-white/60">
            Name
            <input
              className="mt-1 w-full rounded bg-white/10 px-2 py-1.5 text-xs text-white outline-none"
              value={draft.name}
              onChange={(event) => {
                const next = cloneDocument(draft);
                next.name = event.target.value;
                setDraft(next);
              }}
            />
          </label>
          <div className="text-xs text-white/40">Document ID: {draft.id}</div>
          <div className="text-xs text-white/40">
            Sections:{' '}
            {draft.sections
              .map((section) => `${section.id}:${section.relativeWidth}`)
              .join(' | ')}
          </div>
        </div>
      </section>
    </div>
  );
}

const root = document.getElementById('root');
if (root) createRoot(root).render(<EditorApp />);
