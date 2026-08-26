import { DEFAULT_SKIN_ID, SKINS } from './index';

export { DEFAULT_SKIN_ID, SKINS } from './index';

const STORAGE_KEY = 'airdeck.skin';

let skinEl: HTMLStyleElement | undefined;

function applySkin(id: string): void {
  const skin =
    SKINS.find((candidate) => candidate.id === id) ??
    SKINS.find((candidate) => candidate.id === DEFAULT_SKIN_ID);
  if (!skin) return;
  if (!skinEl) {
    skinEl = document.createElement('style');
    skinEl.id = 'airdeck-skin';
  }
  document.documentElement.setAttribute('data-skin', skin.id);
  skinEl.textContent = skin.css;
  if (!skinEl.parentNode) document.head.append(skinEl);
}

export function initSkin(): void {
  applySkin(getSkin());
}

export function setSkin(id: string): void {
  if (!SKINS.some((skin) => skin.id === id)) return;
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Skin selection is convenience state; ignore storage failures.
  }
  applySkin(id);
}

export function getSkin(): string {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(STORAGE_KEY);
  } catch {
    stored = null;
  }
  return SKINS.some((skin) => skin.id === stored)
    ? (stored as string)
    : DEFAULT_SKIN_ID;
}
