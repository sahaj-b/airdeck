// Fires on touch and mouse without double-firing. The controller shell
// preventDefaults touchstart/touchend to kill Android's long-press context
// menu buzz, which also suppresses the synthetic click on touch. Pointer
// events still fire (the game controls depend on this too), so we bind
// pointerup and dedupe the trailing click that mouse and keyboard produce.
export function bindTap(element: HTMLElement, handler: () => void): () => void {
  let handledByPointer = false;
  const onPointerUp = (): void => {
    handledByPointer = true;
    handler();
  };
  const onClick = (): void => {
    if (handledByPointer) {
      handledByPointer = false;
      return;
    }
    handler();
  };
  element.addEventListener('pointerup', onPointerUp);
  element.addEventListener('click', onClick);
  return () => {
    element.removeEventListener('pointerup', onPointerUp);
    element.removeEventListener('click', onClick);
  };
}
