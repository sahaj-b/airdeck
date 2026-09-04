export interface Skin {
  id: string;
  name: string;
}

export const SKINS: Skin[] = [
  { id: 'airdeck', name: 'Airdeck' },
  { id: 'clay', name: 'Clay' },
  { id: 'console', name: 'Console' },
  { id: 'minimal', name: 'Minimal' },
  { id: 'moonlight', name: 'Moonlight' },
  { id: 'neumorph-light', name: 'Neumorph Light' },
  { id: 'neumorph', name: 'Neumorph' },
  { id: 'oled', name: 'OLED' },
  { id: 'retro', name: 'Retro' },
];

export const DEFAULT_SKIN_ID = 'airdeck';

export function isSkinId(id: unknown): id is string {
  return typeof id === 'string' && SKINS.some((skin) => skin.id === id);
}
