export function isEditableTarget(
  target: EventTarget | Element | null,
): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT' ||
    Boolean(target.closest('[contenteditable="true"]'))
  );
}
