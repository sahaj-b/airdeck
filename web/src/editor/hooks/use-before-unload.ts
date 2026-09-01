import { useEffect } from 'react';
import { useEditorStore } from '@/editor/store/editor-store';

let suppressBeforeUnload = false;

/**
 * Skip the native browser leave-alert for one navigation we initiate
 * ourselves (in-app leave/layout switch). Reload and tab close still warn.
 */
export function suppressNextBeforeUnload(): void {
  suppressBeforeUnload = true;
}

export function useBeforeUnload(): void {
  useEffect(() => {
    const handle = (event: BeforeUnloadEvent): void => {
      if (suppressBeforeUnload) {
        suppressBeforeUnload = false;
        return;
      }
      if (useEditorStore.getState().dirty) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handle);
    return () => window.removeEventListener('beforeunload', handle);
  }, []);
}
