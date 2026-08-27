import type { FeedbackController } from '../controller/feedback';
import { getSkin, SKINS, setSkin } from '../skins/loader';
import { CLOSE_ICON } from './constants';
import { formatVibration, settingsRow } from './dom-helpers';
import { writeStorage } from './storage';

export function buildSettingsSheet(parts: {
  layoutSelect: HTMLSelectElement;
  connectionValue: HTMLElement;
  pingValue: HTMLElement;
  vibrationMs: number;
  rumble: boolean;
  sound: boolean;
  ignoreCutout: boolean;
  onCutoutChange: (ignored: boolean) => void;
  feedback: FeedbackController;
  capabilityNotes: string;
}): {
  root: HTMLElement;
  backdrop: HTMLElement;
  closeButton: HTMLButtonElement;
} {
  const root = document.createElement('aside');
  root.className = 'settings-sheet';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', 'Controller settings');
  root.hidden = true;

  const heading = document.createElement('h2');
  heading.textContent = 'Settings';
  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'icon-button';
  closeButton.setAttribute('aria-label', 'Close settings');
  closeButton.innerHTML = CLOSE_ICON;
  const head = document.createElement('div');
  head.className = 'settings-head';
  head.append(heading, closeButton);

  const layoutRow = document.createElement('label');
  layoutRow.className = 'settings-row';
  layoutRow.append('Layout', parts.layoutSelect);

  const vibrationInput = document.createElement('input');
  vibrationInput.type = 'range';
  vibrationInput.min = '0';
  vibrationInput.max = '100';
  vibrationInput.step = '10';
  vibrationInput.value = String(parts.vibrationMs);
  vibrationInput.setAttribute('aria-label', 'Button vibration duration');
  const vibrationValue = document.createElement('span');
  vibrationValue.className = 'settings-value';
  vibrationValue.textContent = formatVibration(parts.vibrationMs);
  const vibrationHead = document.createElement('div');
  vibrationHead.className = 'settings-row';
  vibrationHead.append('Button vibration', vibrationValue);
  const vibrationRow = document.createElement('div');
  vibrationRow.className = 'settings-vibration';
  vibrationRow.append(vibrationHead, vibrationInput);
  vibrationInput.addEventListener('input', () => {
    const ms = vibrationInput.valueAsNumber;
    vibrationValue.textContent = formatVibration(ms);
    parts.feedback.setPreferences({ pressVibrationMs: ms });
    writeStorage('airdeck.vibrationMs', String(ms));
  });

  const rumbleInput = document.createElement('input');
  rumbleInput.type = 'checkbox';
  rumbleInput.checked = parts.rumble;
  const rumbleRow = document.createElement('label');
  rumbleRow.className = 'settings-row';
  rumbleRow.append('Game rumble', rumbleInput);
  rumbleInput.addEventListener('change', () => {
    parts.feedback.setPreferences({ rumble: rumbleInput.checked });
    writeStorage('airdeck.rumble', String(rumbleInput.checked));
  });

  const soundInput = document.createElement('input');
  soundInput.type = 'checkbox';
  soundInput.checked = parts.sound;
  const soundRow = document.createElement('label');
  soundRow.className = 'settings-row';
  soundRow.append('Button sounds', soundInput);
  soundInput.addEventListener('change', () => {
    parts.feedback.setPreferences({ sound: soundInput.checked });
    writeStorage('airdeck.sound', String(soundInput.checked));
  });

  const cutoutInput = document.createElement('input');
  cutoutInput.type = 'checkbox';
  cutoutInput.checked = parts.ignoreCutout;
  const cutoutRow = document.createElement('label');
  cutoutRow.className = 'settings-row';
  cutoutRow.append('Ignore display cutout', cutoutInput);
  cutoutInput.addEventListener('change', () => {
    writeStorage('airdeck.ignoreCutout', String(cutoutInput.checked));
    parts.onCutoutChange(cutoutInput.checked);
  });

  const notes = document.createElement('p');
  notes.className = 'settings-capabilities';
  notes.textContent = parts.capabilityNotes;

  const skinSelect = document.createElement('select');
  skinSelect.className = 'controller-layout-picker';
  skinSelect.setAttribute('aria-label', 'Controller skin');
  for (const skin of SKINS) {
    const skinOption = document.createElement('option');
    skinOption.value = skin.id;
    skinOption.textContent = skin.name;
    skinSelect.append(skinOption);
  }
  skinSelect.value = getSkin();
  skinSelect.addEventListener('change', () => setSkin(skinSelect.value));
  const skinRow = document.createElement('label');
  skinRow.className = 'settings-row';
  skinRow.append('Skin', skinSelect);

  root.append(
    head,
    layoutRow,
    skinRow,
    vibrationRow,
    rumbleRow,
    soundRow,
    cutoutRow,
    settingsRow('Connection', parts.connectionValue),
    settingsRow('Ping', parts.pingValue),
    notes,
  );

  const backdrop = document.createElement('div');
  backdrop.className = 'settings-backdrop';
  backdrop.hidden = true;
  return { root, backdrop, closeButton };
}
