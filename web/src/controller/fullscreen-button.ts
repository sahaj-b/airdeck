import { isIOSWithoutFullscreen, lacksNativeFullscreen } from './device';
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
  // iPhone Safari has no element fullscreen at all. Hiding the button there
  // reads as a broken app, so keep it visible and explain on tap instead.
  const iosFallback = isIOSWithoutFullscreen();
  if (lacksNativeFullscreen() && !iosFallback) button.hidden = true;
  let hint: HTMLElement | undefined;
  const showIosHint = (): void => {
    hint?.remove();
    const bubble = document.createElement('div');
    bubble.setAttribute('role', 'status');
    bubble.textContent =
      'iPhone does not allow fullscreen. For a bigger view use Safari Hide Toolbar and rotate sideways.';
    bubble.style.position = 'fixed';
    bubble.style.left = '50%';
    bubble.style.transform = 'translateX(-50%)';
    bubble.style.bottom = 'calc(env(safe-area-inset-bottom, 0px) + 4.5rem)';
    bubble.style.zIndex = '9999';
    bubble.style.maxWidth = '22rem';
    bubble.style.margin = '0 1rem';
    bubble.style.padding = '0.65rem 1rem';
    bubble.style.borderRadius = '0.75rem';
    bubble.style.background = '#1a2230';
    bubble.style.color = '#f3f6fb';
    bubble.style.fontSize = '0.82rem';
    bubble.style.lineHeight = '1.45';
    bubble.style.textAlign = 'center';
    bubble.style.boxShadow = '0 8px 30px rgba(0, 0, 0, 0.45)';
    document.body.append(bubble);
    hint = bubble;
    window.setTimeout(() => {
      bubble.remove();
      if (hint === bubble) hint = undefined;
    }, 4500);
  };

  const onFullscreenChange = (): void => {
    const active = document.fullscreenElement !== null;
    button.innerHTML = active ? COMPRESS_ICON : EXPAND_ICON;
    button.setAttribute(
      'aria-label',
      active ? 'Exit fullscreen' : 'Enter fullscreen',
    );
  };
  const toggleFullscreen = (): void => {
    if (iosFallback) {
      showIosHint();
      return;
    }
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
      hint?.remove();
      hint = undefined;
    },
  };
}
