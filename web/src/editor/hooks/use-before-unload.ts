import { useEffect } from 'react';
import { useEditorStore } from '@/editor/store/editor-store';

export function useBeforeUnload(): void {
  useEffect(() => {
    const handle = (event: BeforeUnloadEvent): void => {
      if (useEditorStore.getState().dirty) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handle);
    return () => window.removeEventListener('beforeunload', handle);
  }, []);
}
