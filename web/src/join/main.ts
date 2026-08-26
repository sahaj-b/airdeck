import '../controller/controller.css';
import {
  CapabilityManager,
  type CapabilityStatus,
} from '../controller/capabilities';
import { FeedbackController } from '../controller/feedback';
import { FrameSender } from '../controller/frame-sender';
import { buildFullscreenButton } from '../controller/fullscreen-button';
import {
  type RenderedLayout,
  renderLayout,
} from '../controller/layout-renderer';
import {
  type ConnectionState,
  ControllerSocket,
  SELECTED_LAYOUT_KEY,
} from '../controller/socket';
import { InputStateStore } from '../controller/state';
import type { Welcome } from '../shared/contracts';
import { getSkin, initSkin, SKINS, setSkin } from '../skins/loader';
import './join.css';

const rootElement = document.querySelector<HTMLElement>('#root');
if (!rootElement) throw new Error('join root is missing');
const root: HTMLElement = rootElement;

const DISPLAY_NAME_KEY = 'airdeck.displayName';
const RUMBLE_KEY = 'airdeck.rumble';
const SOUND_KEY = 'airdeck.sound';
const WAKE_LOCK_KEY = 'airdeck.wakeLock';
// Prefilled so the field never looks mandatory; a value matching this pattern
// is sent as empty so the host assigns its live slot-based fallback name.
const DEFAULT_NAME = 'Player';
const DEFAULT_NAME_PATTERN = /^player(?: \d{1,2})?$/i;

// Full status strings for the settings sheet.
const CONNECTION_LABELS: Record<ConnectionState, string> = {
  connecting: 'Connecting',
  'hello-sent': 'Joining',
  'welcome-received': 'Loading',
  active: 'Connected',
  reconnecting: 'Reconnecting',
  rejected: 'Rejected',
  kicked: 'Kicked',
  'session-reset': 'Session reset',
  closed: 'Closed',
};

// Short status strings for the controller header pill, which truncates.
const PILL_LABELS: Record<ConnectionState, string> = {
  connecting: 'Connecting',
  'hello-sent': 'Joining',
  'welcome-received': 'Loading',
  active: 'Ready',
  reconnecting: 'Reconnecting',
  rejected: 'Rejected',
  kicked: 'Kicked',
  'session-reset': 'Session reset',
  closed: 'Closed',
};

const SHORT_STATUS: Record<string, string> = {
  'Controller ready.': 'Ready',
  'The connection to the host closed.': 'Connection closed',
  'Loading layout...': 'Loading layout',
  'The session code is invalid.': 'Invalid code',
  'This session is not accepting new joins.': 'Joins closed',
  'This session already has 16 players.': 'Session full',
  'The reconnect window has expired. Join as a new player.':
    'Reconnect expired',
  'The host could not create your virtual controller.': 'Device error',
  'The host sent an invalid layout. The default layout is being used.':
    'Invalid layout',
};

const shortStatus = (full: string): string => SHORT_STATUS[full] ?? full;

const GEAR_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><circle cx="12" cy="12" r="3.2"/><path d="M19.4 13.5a7.6 7.6 0 0 0 0-3l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-2.6-1.5L14 2.5h-4l-.4 2.5a7.6 7.6 0 0 0-2.6 1.5l-2.4-1-2 3.4 2 1.6a7.6 7.6 0 0 0 0 3l-2 1.6 2 3.4 2.4-1a7.6 7.6 0 0 0 2.6 1.5l.4 2.5h4l.4-2.5a7.6 7.6 0 0 0 2.6-1.5l2.4 1 2-3.4z"/></svg>';
const CLOSE_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';

let activeSocket: ControllerSocket | undefined;
let activeSender: FrameSender | undefined;
let activeRenderer: RenderedLayout | undefined;
let activeFeedback: FeedbackController | undefined;
let activeCapabilities: CapabilityManager | undefined;
let removeVisibilityHandlers: (() => void) | undefined;
let removeControllerDocumentHandlers: (() => void) | undefined;
let removeJoinFullscreenHandler: (() => void) | undefined;

renderJoinScreen();
initSkin();

function renderJoinScreen(errorMessage = ''): void {
  activeSocket?.close();
  activeSender?.destroy();
  activeRenderer?.destroy();
  activeFeedback?.destroy();
  activeCapabilities?.destroy();
  activeSocket = undefined;
  activeSender = undefined;
  activeRenderer = undefined;
  activeFeedback = undefined;
  activeCapabilities = undefined;
  removeVisibilityHandlers?.();
  removeVisibilityHandlers = undefined;
  removeControllerDocumentHandlers?.();
  removeControllerDocumentHandlers = undefined;
  removeJoinFullscreenHandler?.();
  removeJoinFullscreenHandler = undefined;

  const panel = document.createElement('section');
  panel.className = 'join-screen';
  const content = document.createElement('div');
  content.className = 'join-panel';
  panel.append(content);

  const kicker = document.createElement('p');
  kicker.className = 'join-kicker';
  kicker.textContent = 'Airdeck LAN controller';
  const heading = document.createElement('h1');
  heading.textContent = 'Join a session';
  const intro = document.createElement('p');
  intro.className = 'join-intro';
  intro.textContent =
    'Enter the session code if your host uses one. Keep this page open while you play.';
  content.append(kicker, heading, intro);

  const fullscreen = buildFullscreenButton();
  fullscreen.button.classList.add('join-fullscreen');
  removeJoinFullscreenHandler = fullscreen.cleanup;

  const form = document.createElement('form');
  form.className = 'join-form';
  form.noValidate = true;
  const codeField = textField(
    'Session code',
    'code',
    getSessionCode(),
    'Enter the 4-digit code',
  );
  codeField.input.className = 'join-code';
  codeField.input.inputMode = 'numeric';
  codeField.input.maxLength = 4;
  codeField.input.pattern = '[0-9]{4}';
  const nameField = textField(
    `Display name (optional, defaults to ${DEFAULT_NAME})`,
    'displayName',
    readStorage(DISPLAY_NAME_KEY) || DEFAULT_NAME,
    'Your name',
  );
  nameField.input.maxLength = 40;
  form.append(codeField.wrapper, nameField.wrapper);

  const preferences = document.createElement('fieldset');
  preferences.className = 'join-preferences';
  const legend = document.createElement('legend');
  legend.textContent = 'Local feedback';
  preferences.append(legend);
  const rumble = checkboxField(
    'rumble',
    'Vibration and game rumble',
    readBoolean(RUMBLE_KEY, true),
  );
  const sound = checkboxField(
    'sound',
    'Button sounds',
    readBoolean(SOUND_KEY, false),
  );
  const wakeLock = checkboxField(
    'wakeLock',
    'Keep the screen awake',
    readBoolean(WAKE_LOCK_KEY, true),
  );
  preferences.append(rumble.wrapper, sound.wrapper, wakeLock.wrapper);
  form.append(preferences);

  const capabilityMessage = document.createElement('p');
  capabilityMessage.className = 'join-capabilities';
  capabilityMessage.setAttribute('role', 'status');
  capabilityMessage.setAttribute('aria-live', 'polite');
  const error = document.createElement('p');
  error.className = 'join-error';
  error.setAttribute('role', 'alert');
  error.textContent = errorMessage;
  if (!errorMessage) error.hidden = true;

  const submit = document.createElement('button');
  submit.className = 'join-submit';
  submit.type = 'submit';
  submit.textContent = 'Join';
  form.append(capabilityMessage, error, submit);
  content.append(form, fullscreen.button);

  const capabilities = new CapabilityManager({
    onStatus: (status) => updateCapabilityMessage(capabilityMessage, status),
  });
  activeCapabilities = capabilities;
  updateCapabilityMessage(capabilityMessage, capabilities.currentStatus);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    // An empty code is valid when the host runs with --no-code; the host
    // rejects it otherwise and the form re-renders with the error.
    const code = codeField.input.value.trim();
    if (code !== '' && !/^\d{4}$/.test(code)) {
      showError(error, 'Enter the 4-digit session code.');
      codeField.input.focus();
      return;
    }
    let displayName = nameField.input.value.trim();
    if (DEFAULT_NAME_PATTERN.test(displayName)) displayName = '';
    if ([...displayName].length > 40) {
      showError(error, 'Display name must be at most 40 characters.');
      nameField.input.focus();
      return;
    }

    writeStorage(DISPLAY_NAME_KEY, displayName);
    writeStorage(RUMBLE_KEY, String(rumble.input.checked));
    writeStorage(SOUND_KEY, String(sound.input.checked));
    writeStorage(WAKE_LOCK_KEY, String(wakeLock.input.checked));
    capabilities.setWakeLockPreference(wakeLock.input.checked);
    void capabilities.requestJoinCapabilities(wakeLock.input.checked);

    submit.disabled = true;
    showController({
      sessionCode: code,
      displayName,
      rumble: rumble.input.checked,
      sound: sound.input.checked,
      capabilities,
    });
  });

  root.replaceChildren(panel);
  if (!codeField.input.value) codeField.input.focus();
  else nameField.input.focus();
}

function showController(options: {
  sessionCode: string;
  displayName: string;
  rumble: boolean;
  sound: boolean;
  capabilities: CapabilityManager;
}): void {
  const state = new InputStateStore();
  const feedback = new FeedbackController({
    haptics: options.rumble,
    sound: options.sound,
  });
  activeFeedback = feedback;

  const shell = document.createElement('main');
  shell.className = 'controller-shell';
  shell.style.setProperty('--slot-accent', '#6ee7b7');

  const chrome = document.createElement('div');
  chrome.className = 'controller-runtime-chrome';
  const identity = document.createElement('div');
  identity.className = 'controller-identity';
  const slot = document.createElement('span');
  slot.className = 'controller-slot';
  slot.textContent = 'Player --';
  const name = document.createElement('span');
  name.className = 'controller-name';
  name.textContent = options.displayName || 'Player';
  identity.append(slot, name);

  const status = document.createElement('p');
  status.className = 'controller-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.textContent = 'Connecting';

  const gearButton = document.createElement('button');
  gearButton.type = 'button';
  gearButton.className = 'icon-button';
  gearButton.setAttribute('aria-label', 'Controller settings');
  gearButton.setAttribute('aria-expanded', 'false');
  gearButton.innerHTML = GEAR_ICON;

  const center = document.createElement('div');
  center.className = 'controller-center';
  center.append(status, gearButton);
  chrome.append(identity, center);

  const host = document.createElement('div');
  host.className = 'controller-host';

  const layoutSelect = document.createElement('select');
  layoutSelect.className = 'controller-layout-picker';
  layoutSelect.setAttribute('aria-label', 'Controller layout');
  layoutSelect.disabled = true;
  const waitingOption = document.createElement('option');
  waitingOption.textContent = 'Loading layout';
  waitingOption.value = '';
  layoutSelect.append(waitingOption);

  const connectionValue = document.createElement('span');
  connectionValue.className = 'settings-value';
  connectionValue.textContent = CONNECTION_LABELS.connecting;

  const pingValue = document.createElement('span');
  pingValue.className = 'settings-value';
  pingValue.textContent = '—';

  const capabilityMessages = options.capabilities.currentStatus.messages;
  const settings = buildSettingsSheet({
    layoutSelect,
    connectionValue,
    pingValue,
    rumble: options.rumble,
    sound: options.sound,
    feedback,
    capabilityNotes: capabilityMessages.length
      ? capabilityMessages.join(' ')
      : 'All local feedback capabilities are available.',
  });
  const fullscreen = buildFullscreenButton();
  chrome.append(fullscreen.button);
  shell.append(host, settings.backdrop, settings.root);
  root.replaceChildren(shell);

  let transientStatus: string | null = null;
  const updateStatus = (transient: string | null): void => {
    transientStatus = transient;
    const full = transient ?? CONNECTION_LABELS[socket.state];
    status.textContent = transient
      ? shortStatus(transient)
      : PILL_LABELS[socket.state];
    connectionValue.textContent = full;
  };

  const openSettings = (open: boolean): void => {
    settings.backdrop.hidden = !open;
    settings.root.hidden = !open;
    gearButton.setAttribute('aria-expanded', String(open));
    if (open) settings.closeButton.focus();
    else gearButton.focus();
  };
  gearButton.addEventListener('click', () =>
    openSettings(settings.root.hidden),
  );
  settings.backdrop.addEventListener('click', () => openSettings(false));
  settings.closeButton.addEventListener('click', () => openSettings(false));
  const onShellKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && !settings.root.hidden) openSettings(false);
  };
  document.addEventListener('keydown', onShellKeyDown);
  removeControllerDocumentHandlers = () => {
    document.removeEventListener('keydown', onShellKeyDown);
    fullscreen.cleanup();
  };

  activeSender = new FrameSender(
    {
      sendBinary: (frame) => activeSocket?.sendBinary(frame) ?? false,
    },
    state,
  );

  let currentLayoutId = '';
  const socket = new ControllerSocket({
    sessionCode: options.sessionCode,
    displayName: options.displayName,
    selectedLayout: readStorage(SELECTED_LAYOUT_KEY) ?? undefined,
    capabilities: () => options.capabilities.capabilities,
    onStateChange: (nextState) => {
      updateStatus(nextState === 'active' ? transientStatus : null);
      if (nextState === 'active') activeSender?.start();
      if (
        nextState === 'closed' ||
        nextState === 'kicked' ||
        nextState === 'session-reset'
      ) {
        activeSender?.stop();
      }
      if (nextState === 'session-reset') {
        renderJoinScreen(
          'The host started a new session. Enter the new code to join.',
        );
      }
    },
    onWelcome: (welcome) => {
      activeSender?.setInputRate(welcome.targetInputRate);
      applyWelcome(welcome, slot, name, shell, layoutSelect);
      currentLayoutId = welcome.selectedLayout;
      layoutSelect.value = welcome.selectedLayout;
      layoutSelect.disabled = false;
    },
    onLayout: (layout, diagnostic) => {
      activeRenderer?.destroy();
      activeRenderer = renderLayout(host, layout, {
        state,
        feedback,
        chrome,
      });
      currentLayoutId = layout.id;
      writeStorage(SELECTED_LAYOUT_KEY, layout.id);
      layoutSelect.value = layout.id;
      updateStatus(diagnostic ?? 'Controller ready.');
    },
    onError: (message) => {
      if (
        message.code === 'invalid_reconnect' ||
        message.code === 'invalid_code' ||
        message.code === 'joins_closed' ||
        message.code === 'session_full' ||
        message.code === 'device_error'
      ) {
        renderJoinScreen(message.message);
        return;
      }
      if (message.code === 'invalid_layout')
        layoutSelect.value = currentLayoutId;
      updateStatus(message.message);
    },
    onRumble: (message) => feedback.rumble(message),
    onPing: (rttMs) => {
      pingValue.textContent = `${Math.round(rttMs)} ms`;
    },
    onReconnect: () => {
      activeRenderer?.cancelPointers();
      state.reset();
    },
    onClose: () => {
      updateStatus('The connection to the host closed.');
    },
  });
  activeSocket = socket;

  layoutSelect.addEventListener('change', () => {
    const requested = layoutSelect.value;
    if (!requested || requested === currentLayoutId) return;
    if (socket.selectLayout(requested)) updateStatus('Loading layout...');
    else layoutSelect.value = currentLayoutId;
  });

  const neutralize = (): void => {
    const wasRunning = activeSender?.isRunning ?? false;
    if (wasRunning) activeSender?.stop();
    activeRenderer?.cancelPointers();
    state.reset();
    if (wasRunning) activeSender?.start();
  };
  const onVisibilityChange = (): void => {
    if (document.visibilityState === 'hidden') neutralize();
  };
  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('pagehide', neutralize);
  removeVisibilityHandlers = () => {
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('pagehide', neutralize);
  };

  socket.connect();
}

function applyWelcome(
  welcome: Welcome,
  slot: HTMLElement,
  name: HTMLElement,
  shell: HTMLElement,
  layoutSelect: HTMLSelectElement,
): void {
  slot.textContent = `Player ${welcome.slot + 1}`;
  name.textContent = welcome.displayName;
  shell.style.setProperty('--slot-accent', welcome.accent);
  layoutSelect.replaceChildren();
  for (const layout of welcome.availableLayouts) {
    const option = document.createElement('option');
    option.value = layout.id;
    option.textContent = layout.name;
    layoutSelect.append(option);
  }
}

function buildSettingsSheet(parts: {
  layoutSelect: HTMLSelectElement;
  connectionValue: HTMLElement;
  pingValue: HTMLElement;
  rumble: boolean;
  sound: boolean;
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

  const rumbleInput = document.createElement('input');
  rumbleInput.type = 'checkbox';
  rumbleInput.checked = parts.rumble;
  const rumbleRow = document.createElement('label');
  rumbleRow.className = 'settings-row';
  rumbleRow.append('Vibration', rumbleInput);
  rumbleInput.addEventListener('change', () => {
    parts.feedback.setPreferences({ haptics: rumbleInput.checked });
    writeStorage(RUMBLE_KEY, String(rumbleInput.checked));
  });

  const soundInput = document.createElement('input');
  soundInput.type = 'checkbox';
  soundInput.checked = parts.sound;
  const soundRow = document.createElement('label');
  soundRow.className = 'settings-row';
  soundRow.append('Button sounds', soundInput);
  soundInput.addEventListener('change', () => {
    parts.feedback.setPreferences({ sound: soundInput.checked });
    writeStorage(SOUND_KEY, String(soundInput.checked));
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
    rumbleRow,
    soundRow,
    settingsRow('Connection', parts.connectionValue),
    settingsRow('Ping', parts.pingValue),
    notes,
  );

  const backdrop = document.createElement('div');
  backdrop.className = 'settings-backdrop';
  backdrop.hidden = true;
  return { root, backdrop, closeButton };
}

function settingsRow(labelText: string, value: HTMLElement): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'settings-row';
  const label = document.createElement('span');
  label.textContent = labelText;
  row.append(label, value);
  return row;
}

function updateCapabilityMessage(
  element: HTMLElement,
  status: CapabilityStatus,
): void {
  const messages = [...status.messages];
  if (
    !status.haptics &&
    !messages.includes('Vibration unavailable. Input still works.')
  )
    messages.unshift('Vibration unavailable. Input still works.');
  if (!status.wakeLock && !messages.includes('Screen wake lock unavailable.'))
    messages.push('Screen wake lock unavailable.');
  element.textContent = messages.join(' ');
}

function textField(
  labelText: string,
  id: string,
  value: string,
  placeholder: string,
): { wrapper: HTMLDivElement; input: HTMLInputElement } {
  const wrapper = document.createElement('div');
  wrapper.className = 'join-field';
  const label = document.createElement('label');
  label.htmlFor = id;
  label.textContent = labelText;
  const input = document.createElement('input');
  input.id = id;
  input.name = id;
  input.value = value;
  input.placeholder = placeholder;
  input.setAttribute('autocomplete', id === 'code' ? 'off' : 'nickname');
  wrapper.append(label, input);
  return { wrapper, input };
}

function checkboxField(
  id: string,
  labelText: string,
  checked: boolean,
): { wrapper: HTMLLabelElement; input: HTMLInputElement } {
  const wrapper = document.createElement('label');
  wrapper.className = 'join-preference';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.id = id;
  input.checked = checked;
  const text = document.createElement('span');
  text.textContent = labelText;
  wrapper.append(input, text);
  return { wrapper, input };
}

function getSessionCode(): string {
  const code = new URLSearchParams(window.location.search).get('code') ?? '';
  return /^\d{4}$/.test(code) ? code : '';
}

function showError(element: HTMLElement, message: string): void {
  element.hidden = false;
  element.textContent = message;
}

function readBoolean(key: string, fallback: boolean): boolean {
  const value = readStorage(key);
  return value === null ? fallback : value === 'true';
}

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Browser storage is convenience state, not part of joining.
  }
}
