import '../controller/controller.css';
import {
  CapabilityManager,
  type CapabilityStatus,
} from '../controller/capabilities';
import { FeedbackController } from '../controller/feedback';
import { FrameSender } from '../controller/frame-sender';
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
import './join.css';

const rootElement = document.querySelector<HTMLElement>('#root');
if (!rootElement) throw new Error('join root is missing');
const root: HTMLElement = rootElement;

const DISPLAY_NAME_KEY = 'airdeck.displayName';
const RUMBLE_KEY = 'airdeck.rumble';
const SOUND_KEY = 'airdeck.sound';
const WAKE_LOCK_KEY = 'airdeck.wakeLock';

let activeSocket: ControllerSocket | undefined;
let activeSender: FrameSender | undefined;
let activeRenderer: RenderedLayout | undefined;
let activeFeedback: FeedbackController | undefined;
let activeCapabilities: CapabilityManager | undefined;
let removeVisibilityHandlers: (() => void) | undefined;

renderJoinScreen();

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
    'Use the code shown on the host dashboard. Keep this page open while you play.';
  content.append(kicker, heading, intro);

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
    'Display name (optional)',
    'displayName',
    readStorage(DISPLAY_NAME_KEY) ?? '',
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
  content.append(form);

  const capabilities = new CapabilityManager({
    onStatus: (status) => updateCapabilityMessage(capabilityMessage, status),
  });
  activeCapabilities = capabilities;
  updateCapabilityMessage(capabilityMessage, capabilities.currentStatus);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const code = codeField.input.value.trim();
    if (!/^\d{4}$/.test(code)) {
      showError(error, 'Enter the 4-digit session code.');
      codeField.input.focus();
      return;
    }
    const displayName = nameField.input.value.trim();
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
  codeField.input.focus();
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

  const header = document.createElement('header');
  header.className = 'controller-header';
  const identity = document.createElement('div');
  identity.className = 'controller-identity';
  const accent = document.createElement('span');
  accent.className = 'controller-accent';
  accent.setAttribute('aria-hidden', 'true');
  const identityText = document.createElement('div');
  const slot = document.createElement('div');
  slot.className = 'controller-slot';
  slot.textContent = 'Slot --';
  const name = document.createElement('div');
  name.className = 'controller-name';
  name.textContent = options.displayName || 'Player';
  identityText.append(slot, name);
  identity.append(accent, identityText);

  const tools = document.createElement('div');
  tools.className = 'controller-tools';
  const layoutSelect = document.createElement('select');
  layoutSelect.className = 'controller-layout-picker';
  layoutSelect.setAttribute('aria-label', 'Controller layout');
  layoutSelect.disabled = true;
  const waitingOption = document.createElement('option');
  waitingOption.textContent = 'Loading layout';
  waitingOption.value = '';
  layoutSelect.append(waitingOption);
  const connection = document.createElement('span');
  connection.className = 'controller-connection';
  connection.textContent = 'Connecting';
  tools.append(layoutSelect, connection);
  header.append(identity, tools);

  const status = document.createElement('p');
  status.className = 'controller-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.textContent = 'Connecting to the host...';
  const host = document.createElement('div');
  host.className = 'controller-host';
  shell.append(header, status, host);
  root.replaceChildren(shell);

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
      updateConnectionStatus(connection, status, nextState);
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
      applyWelcome(welcome, slot, name, accent, shell, layoutSelect);
      currentLayoutId = welcome.selectedLayout;
      layoutSelect.value = welcome.selectedLayout;
      layoutSelect.disabled = false;
    },
    onLayout: (layout, diagnostic) => {
      activeRenderer?.destroy();
      activeRenderer = renderLayout(host, layout, { state, feedback });
      currentLayoutId = layout.id;
      writeStorage(SELECTED_LAYOUT_KEY, layout.id);
      layoutSelect.value = layout.id;
      status.textContent = diagnostic ?? 'Controller ready.';
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
      status.textContent = message.message;
    },
    onRumble: (message) => feedback.rumble(message),
    onReconnect: () => {
      activeRenderer?.cancelPointers();
      state.reset();
      status.textContent = 'Connection lost. Reconnecting...';
    },
    onClose: () => {
      status.textContent = 'The connection to the host closed.';
    },
  });
  activeSocket = socket;

  layoutSelect.addEventListener('change', () => {
    const requested = layoutSelect.value;
    if (!requested || requested === currentLayoutId) return;
    if (socket.selectLayout(requested))
      status.textContent = 'Loading layout...';
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
  accent: HTMLElement,
  shell: HTMLElement,
  layoutSelect: HTMLSelectElement,
): void {
  slot.textContent = `Player ${welcome.slot + 1}`;
  name.textContent = welcome.displayName;
  accent.style.setProperty('--slot-accent', welcome.accent);
  shell.style.setProperty('--slot-accent', welcome.accent);
  layoutSelect.replaceChildren();
  for (const layout of welcome.availableLayouts) {
    const option = document.createElement('option');
    option.value = layout.id;
    option.textContent = layout.name;
    layoutSelect.append(option);
  }
}

function updateConnectionStatus(
  connection: HTMLElement,
  status: HTMLElement,
  state: ConnectionState,
): void {
  const labels: Record<ConnectionState, string> = {
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
  connection.textContent = labels[state];
  if (state === 'reconnecting')
    status.textContent = 'Connection lost. Reconnecting...';
  if (state === 'kicked') status.textContent = 'The host disconnected you.';
  if (state === 'session-reset')
    status.textContent = 'The host started a new session.';
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
