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

const loaders: Record<string, () => Promise<string>> = {
  airdeck: () => import('./airdeck.css?raw').then((m) => m.default),
  clay: () => import('./clay.css?raw').then((m) => m.default),
  console: () => import('./console.css?raw').then((m) => m.default),
  minimal: () => import('./minimal.css?raw').then((m) => m.default),
  moonlight: () => import('./moonlight.css?raw').then((m) => m.default),
  'neumorph-light': () =>
    import('./neumorph-light.css?raw').then((m) => m.default),
  neumorph: () => import('./neumorph.css?raw').then((m) => m.default),
  oled: () => import('./oled.css?raw').then((m) => m.default),
  retro: () => import('./retro.css?raw').then((m) => m.default),
};

const cache = new Map<string, string>();

export function loadSkinCSS(id: string): Promise<string> {
  const cached = cache.get(id);
  if (cached !== undefined) return Promise.resolve(cached);
  const loader = loaders[id];
  if (!loader) return Promise.reject(new Error(`unknown skin ${id}`));
  return loader().then((css) => {
    cache.set(id, css);
    return css;
  });
}
