import { DEFAULT_SKIN_ID, isSkinId } from './index';

// All skins ship as static CSS. Switching is just the data-skin attribute,
// which also means a nested [data-skin] element (like a picker preview)
// picks up that skin's variables with no extra work.
import './base.css';
import './airdeck.css';
import './clay.css';
import './console.css';
import './minimal.css';
import './moonlight.css';
import './neumorph-light.css';
import './neumorph.css';
import './oled.css';
import './retro.css';

export { DEFAULT_SKIN_ID, isSkinId, SKINS } from './index';

// The settings store owns the selection. This module only paints it.
export function applySkin(id: string): void {
  document.documentElement.setAttribute(
    'data-skin',
    isSkinId(id) ? id : DEFAULT_SKIN_ID,
  );
}

interface SkinSource {
  getState(): { skin: string };
  subscribe(
    listener: (state: { skin: string }, prev: { skin: string }) => void,
  ): () => void;
}

// Paint the current selection and keep it painted. Returns the unsubscribe.
export function startSkinSync(store: SkinSource): () => void {
  applySkin(store.getState().skin);
  return store.subscribe((state, prev) => {
    if (state.skin !== prev.skin) applySkin(state.skin);
  });
}
