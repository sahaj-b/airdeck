import { bindTap } from './tap';

const EXPAND_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>';
const COMPRESS_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/></svg>';

export function buildFullscreenButton(): {
  button: HTMLButtonElement;
  cleanup: () => void;
} {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'icon-button fullscreen-button';
  button.setAttribute('aria-label', 'Enter fullscreen');
  button.innerHTML = EXPAND_ICON;
  if (typeof document.documentElement.requestFullscreen !== 'function')
    button.hidden = true;

  const onFullscreenChange = (): void => {
    const active = document.fullscreenElement !== null;
    button.innerHTML = active ? COMPRESS_ICON : EXPAND_ICON;
    button.setAttribute(
      'aria-label',
      active ? 'Exit fullscreen' : 'Enter fullscreen',
    );
  };
  const toggleFullscreen = (): void => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else
      void document.documentElement.requestFullscreen().catch(() => undefined);
  };
  // click is suppressed inside the controller shell (touchstart preventDefault
  // kills the long-press buzz), so bind via pointer events like the controls.
  const unbindTap = bindTap(button, toggleFullscreen);
  document.addEventListener('fullscreenchange', onFullscreenChange);
  return {
    button,
    cleanup: () => {
      unbindTap();
      document.removeEventListener('fullscreenchange', onFullscreenChange);
    },
  };
}
