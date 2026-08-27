import '../controller/controller.css';
import { CapabilityManager } from '../controller/capabilities';
import { FeedbackController } from '../controller/feedback';
import { FrameSender } from '../controller/frame-sender';
import { buildFullscreenButton } from '../controller/fullscreen-button';
import {
  type RenderedLayout,
  renderLayout,
} from '../controller/layout-renderer';
import { ControllerSocket, SELECTED_LAYOUT_KEY } from '../controller/socket';
import { InputStateStore } from '../controller/state';
import type { Welcome } from '../shared/contracts';
import { initSkin } from '../skins/loader';
import './join.css';
import {
  CONNECTION_LABELS,
  CUTOUT_KEY,
  DEFAULT_NAME_PATTERN,
  DEFAULT_VIBRATION_MS,
  DISPLAY_NAME_KEY,
  GEAR_ICON,
  PILL_LABELS,
  RUMBLE_KEY,
  SOUND_KEY,
  shortStatus,
  VIBRATION_KEY,
  WAKE_LOCK_KEY,
} from './constants';
import {
  checkboxField,
  showError,
  textField,
  updateCapabilityMessage,
} from './dom-helpers';
import { buildSettingsSheet } from './settings-sheet';
import {
  getSessionCode,
  readBoolean,
  readNumber,
  readStorage,
  writeStorage,
} from './storage';

const rootElement = document.querySelector<HTMLElement>('#root');
if (!rootElement) throw new Error('join root is missing');
const root: HTMLElement = rootElement;

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
    'Display name',
    'displayName',
    readStorage(DISPLAY_NAME_KEY) ?? '',
    'Optional',
  );
  nameField.input.maxLength = 40;
  form.append(codeField.wrapper, nameField.wrapper);

  const preferences = document.createElement('fieldset');
  preferences.className = 'join-preferences';
  const legend = document.createElement('legend');
  legend.textContent = 'Local feedback';
  preferences.append(legend);
  const vibrationMs = readNumber(VIBRATION_KEY, DEFAULT_VIBRATION_MS);
  const rumble = checkboxField(
    'rumble',
    'Game rumble',
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
  const cutout = checkboxField(
    'ignoreCutout',
    'Ignore display cutout',
    readBoolean(CUTOUT_KEY, true),
  );
  preferences.append(
    rumble.wrapper,
    sound.wrapper,
    wakeLock.wrapper,
    cutout.wrapper,
  );
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
    writeStorage(CUTOUT_KEY, String(cutout.input.checked));
    capabilities.setWakeLockPreference(wakeLock.input.checked);
    void capabilities.requestJoinCapabilities(wakeLock.input.checked);

    submit.disabled = true;
    showController({
      sessionCode: code,
      displayName,
      vibrationMs,
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
  vibrationMs: number;
  rumble: boolean;
  sound: boolean;
  capabilities: CapabilityManager;
}): void {
  const state = new InputStateStore();
  const feedback = new FeedbackController({
    pressVibrationMs: options.vibrationMs,
    rumble: options.rumble,
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
  if (readBoolean(CUTOUT_KEY, true)) host.classList.add('ignore-cutout');

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
    vibrationMs: options.vibrationMs,
    rumble: options.rumble,
    sound: options.sound,
    ignoreCutout: readBoolean(CUTOUT_KEY, true),
    onCutoutChange: (ignored) => {
      host.classList.toggle('ignore-cutout', ignored);
    },
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
  const isDefaultName = DEFAULT_NAME_PATTERN.test(welcome.displayName);
  name.textContent = welcome.displayName;
  name.hidden = isDefaultName;
  name.style.display = isDefaultName ? 'none' : '';
  shell.style.setProperty('--slot-accent', welcome.accent);
  layoutSelect.replaceChildren();
  for (const layout of welcome.availableLayouts) {
    const option = document.createElement('option');
    option.value = layout.id;
    option.textContent = layout.name;
    layoutSelect.append(option);
  }
}
