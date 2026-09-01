import { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import '@/index.css';
import '../controller/controller.css';
import { getSkin, initSkin } from '../skins/loader';
import { EditorShell } from './components/editor-shell';
import { useBeforeUnload } from './hooks/use-before-unload';
import { useEditorInit } from './hooks/use-editor-init';
import { useEditorKeyboard } from './hooks/use-editor-keyboard';
import './editor.css';

function EditorApp() {
  useEffect(() => {
    try {
      document.documentElement.setAttribute('data-skin', getSkin());
    } catch {}
    initSkin();
  }, []);

  useBeforeUnload();
  useEditorKeyboard();
  useEditorInit();

  return <EditorShell />;
}

const root = document.getElementById('root');
if (root) {
  root.replaceChildren();
  createRoot(root).render(<EditorApp />);
}
