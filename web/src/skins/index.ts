import clay from './clay.css?raw';
import console from './console.css?raw';
import minimal from './minimal.css?raw';
import moonlight from './moonlight.css?raw';
import neumorph from './neumorph.css?raw';
import neumorphLight from './neumorph-light.css?raw';
import oled from './oled.css?raw';
import airdeck from './airdeck.css?raw';
import retro from './retro.css?raw';

export interface Skin {
  id: string;
  name: string;
  css: string;
}

export const SKINS: Skin[] = [
  { id: 'airdeck', name: 'Airdeck', css: airdeck },
  { id: 'clay', name: 'Clay', css: clay },
  { id: 'console', name: 'Console', css: console },
  { id: 'minimal', name: 'Minimal', css: minimal },
  { id: 'moonlight', name: 'Moonlight', css: moonlight },
  { id: 'neumorph-light', name: 'Neumorph Light', css: neumorphLight },
  { id: 'neumorph', name: 'Neumorph', css: neumorph },
  { id: 'oled', name: 'OLED', css: oled },
  { id: 'retro', name: 'Retro', css: retro },
];

export const DEFAULT_SKIN_ID = 'airdeck';
