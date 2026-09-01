import { useEffect, useState } from 'react';

function isEditableTarget(target: EventTarget | Element | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.closest('[contenteditable="true"]')) return true;
  return false;
}

function shouldIgnoreShift(eventTarget: EventTarget | null): boolean {
  return (
    isEditableTarget(eventTarget) || isEditableTarget(document.activeElement)
  );
}

export function useIsShiftHeld(): boolean {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    const update = (event: KeyboardEvent): void => {
      if (shouldIgnoreShift(event.target)) {
        setHeld(false);
        return;
      }
      setHeld(event.shiftKey);
    };
    const clear = (): void => setHeld(false);
    const handleFocusIn = (): void => {
      if (isEditableTarget(document.activeElement)) setHeld(false);
    };
    window.addEventListener('keydown', update);
    window.addEventListener('keyup', update);
    window.addEventListener('blur', clear);
    window.addEventListener('focusin', handleFocusIn);
    return () => {
      window.removeEventListener('keydown', update);
      window.removeEventListener('keyup', update);
      window.removeEventListener('blur', clear);
      window.removeEventListener('focusin', handleFocusIn);
    };
  }, []);
  return held;
}
