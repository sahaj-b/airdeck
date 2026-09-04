import { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import '@/index.css';
import '../controller/controller.css';
import { settingsStore } from '../join/settings-store';
import { startSkinSync } from '../skins/loader';
import { EditorShell } from './components/editor-shell';
import { useBeforeUnload } from './hooks/use-before-unload';
import { useEditorInit } from './hooks/use-editor-init';
import { useEditorKeyboard } from './hooks/use-editor-keyboard';
import './editor.css';

function EditorApp() {
  useEffect(() => startSkinSync(settingsStore), []);

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
