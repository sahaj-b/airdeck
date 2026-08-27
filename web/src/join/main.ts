import '@/index.css';
import '../controller/controller.css';
import { CapabilityManager } from '../controller/capabilities';
import { FeedbackController } from '../controller/feedback';
import { FrameSender } from '../controller/frame-sender';
import { bindTap } from '../controller/tap';
import { buildFullscreenButton } from '../controller/fullscreen-button';
import { GyroController } from '../controller/gyro/controller';
import {
  type RenderedLayout,
  renderLayout,
} from '../controller/layout-renderer';
import { ControllerSocket, SELECTED_LAYOUT_KEY } from '../controller/socket';
import { InputStateStore } from '../controller/state';
import type { Welcome } from '../shared/contracts';
import { getSkin, initSkin, setSkin } from '../skins/loader';
import './join.css';
import {
  CONNECTION_LABELS,
  DEFAULT_NAME_PATTERN,
  DISPLAY_NAME_KEY,
  GEAR_ICON,
  PILL_LABELS,
  shortStatus,
  WAKE_LOCK_KEY,
} from './constants';
import {
  checkboxField,
  showError,
  textField,
  updateCapabilityMessage,
} from './dom-helpers';
import { settingsStore } from './settings-store';
import {
  getSessionCode,
  readBoolean,
  readStorage,
  writeStorage,
} from './storage';

// dark mode: shadcn uses .dark ancestor (see @custom-variant dark in index.css)
document.documentElement.classList.add('dark');

const rootElement = document.querySelector<HTMLElement>('#root');
if (!rootElement) throw new Error('join root is missing');
const root: HTMLElement = rootElement;
root.classList.add('dark');

let activeSocket: ControllerSocket | undefined;
let activeSender: FrameSender | undefined;
let activeRenderer: RenderedLayout | undefined;
let activeFeedback: FeedbackController | undefined;
let activeCapabilities: CapabilityManager | undefined;
let activeGyro: GyroController | undefined;
let removeVisibilityHandlers: (() => void) | undefined;
let removeControllerDocumentHandlers: (() => void) | undefined;
let removeJoinFullscreenHandler: (() => void) | undefined;

renderJoinScreen();
initSkin();

// sync skin from zustand store (keeps loader + store aligned)
{
  const s = settingsStore.getState().skin;
  if (s && s !== getSkin()) setSkin(s);
}

function renderJoinScreen(errorMessage = '', revealCode = false): void {
  activeSocket?.close();
  activeSender?.destroy();
  activeRenderer?.destroy();
  activeFeedback?.destroy();
  activeCapabilities?.destroy();
  activeGyro?.destroy();
  activeGyro = undefined;
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
  const brand = document.createElement('div');
  brand.className = 'join-brand';
  const brandLogo = document.createElement('img');
  brandLogo.src = '/airdeck.svg';
  brandLogo.alt = 'Airdeck';
  brandLogo.className = 'join-brand-logo';
  brandLogo.width = 266;
  brandLogo.height = 48;
  brand.append(brandLogo);
  const content = document.createElement('div');
  content.className = 'join-panel';
  panel.append(brand, content);

  const heading = document.createElement('h1');
  heading.textContent = 'Join a session';
  const intro = document.createElement('p');
  intro.className = 'join-intro';
  intro.textContent =
    'Enter the session code if your host uses one. Keep this page open while you play.';

  const fullscreen = buildFullscreenButton();
  fullscreen.button.classList.add('join-fullscreen');
  removeJoinFullscreenHandler = fullscreen.cleanup;

  const form = document.createElement('form');
  form.className = 'join-form';
  form.noValidate = true;
  const urlCode = getSessionCode();
  const hasUrlCode = urlCode !== '';
  const shouldHideCode = hasUrlCode && !revealCode;
  const codeField = textField(
    'Session code',
    'code',
    urlCode,
    'Enter the 4-digit code',
  );
  codeField.input.className = 'join-code';
  codeField.input.inputMode = 'numeric';
  codeField.input.maxLength = 4;
  codeField.input.pattern = '[0-9]{4}';
  if (shouldHideCode) codeField.wrapper.hidden = true;
  const codeToggle = document.createElement('button');
  codeToggle.type = 'button';
  codeToggle.className = 'join-code-toggle';
  codeToggle.textContent = 'Enter code manually';
  codeToggle.setAttribute('aria-expanded', 'false');
  codeToggle.setAttribute('aria-controls', 'code');
  if (!shouldHideCode) codeToggle.hidden = true;
  codeToggle.addEventListener('click', () => {
    codeField.wrapper.hidden = false;
    codeToggle.hidden = true;
    codeToggle.setAttribute('aria-expanded', 'true');
    codeField.input.focus();
    codeField.input.select();
  });
  const nameField = textField(
    'Display name',
    'displayName',
    readStorage(DISPLAY_NAME_KEY) ?? '',
    'Optional',
  );
  nameField.input.maxLength = 40;

  const storeState = settingsStore.getState();
  const preferences = document.createElement('fieldset');
  preferences.className = 'join-preferences';
  const legend = document.createElement('legend');
  legend.textContent = 'Local feedback';
  preferences.append(legend);
  const rumble = checkboxField('rumble', 'Game rumble', storeState.rumble);
  const sound = checkboxField('sound', 'Button sounds', storeState.sound);
  const wakeLock = checkboxField(
    'wakeLock',
    'Keep the screen awake',
    readBoolean(WAKE_LOCK_KEY, true),
  );
  const cutout = checkboxField(
    'ignoreCutout',
    'Ignore display cutout',
    storeState.ignoreCutout,
  );
  preferences.append(
    rumble.wrapper,
    sound.wrapper,
    wakeLock.wrapper,
    cutout.wrapper,
  );

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

  // left/right split: left holds branding + inputs where empty space was,
  // right holds options + action so Join is always visible in landscape
  const left = document.createElement('div');
  left.className = 'join-left';
  left.append(heading, intro, codeField.wrapper, codeToggle, nameField.wrapper);
  const right = document.createElement('div');
  right.className = 'join-right';
  right.append(preferences, capabilityMessage, error, submit);
  form.append(left, right);
  content.append(form, fullscreen.button);

  const capabilities = new CapabilityManager({
    onStatus: (status) => updateCapabilityMessage(capabilityMessage, status),
  });
  activeCapabilities = capabilities;
  updateCapabilityMessage(capabilityMessage, capabilities.currentStatus);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const rawCode = codeField.wrapper.hidden
      ? urlCode
      : codeField.input.value.trim();
    const code = rawCode;
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
    // sync to zustand store (single source of truth)
    settingsStore.getState().setRumble(rumble.input.checked);
    settingsStore.getState().setSound(sound.input.checked);
    settingsStore.getState().setIgnoreCutout(cutout.input.checked);
    writeStorage(WAKE_LOCK_KEY, String(wakeLock.input.checked));
    capabilities.setWakeLockPreference(wakeLock.input.checked);
    // don't go fullscreen/orientation-lock yet — wait until the server confirms
    // the code is actually valid. This avoids flashing fullscreen then popping
    // back to the join screen on a bad code. The transient user-activation
    // from this click is still alive when the welcome arrives (~100-300ms on
    // LAN) so the deferred request still counts as a user gesture.

    submit.disabled = true;
    submit.textContent = 'Connecting…';
    showController({
      sessionCode: code,
      displayName,
      capabilities,
    });
  });

  root.replaceChildren(panel);
  if (shouldHideCode) {
    nameField.input.focus();
  } else if (revealCode && errorMessage) {
    codeField.input.focus();
    codeField.input.select();
  } else if (!codeField.input.value) codeField.input.focus();
  else nameField.input.focus();
}

function showController(options: {
  sessionCode: string;
  displayName: string;
  capabilities: CapabilityManager;
}): void {
  const storeState = settingsStore.getState();
  const state = new InputStateStore();
  const feedback = new FeedbackController({
    pressVibrationMs: storeState.vibrationMs,
    joystickPressMs: storeState.joystickPressMs,
    joystickEdgeMs: storeState.joystickEdgeMs,
    rumble: storeState.rumble,
    sound: storeState.sound,
  });
  activeFeedback = feedback;

  // keep feedback in sync if store changes before island mounts (vibration via slider is handled inside island)
  const unsubFeedback = settingsStore.subscribe((s, prev) => {
    if (
      s.rumble !== prev.rumble ||
      s.sound !== prev.sound ||
      s.vibrationMs !== prev.vibrationMs ||
      s.joystickPressMs !== prev.joystickPressMs ||
      s.joystickEdgeMs !== prev.joystickEdgeMs
    ) {
      feedback.setPreferences({
        pressVibrationMs: s.vibrationMs,
        joystickPressMs: s.joystickPressMs,
        joystickEdgeMs: s.joystickEdgeMs,
        rumble: s.rumble,
        sound: s.sound,
      });
    }
    if (s.ignoreCutout !== prev.ignoreCutout) {
      host.classList.toggle('ignore-cutout', s.ignoreCutout);
    }
  });

  // Gyro controller (vanilla, no React in hot path)
  let gyroStatus: import('../controller/gyro/controller').GyroStatus = 'idle';
  let gyroLiveX = 0;
  let gyroLiveY = 0;
  const gyro = new GyroController(state, settingsStore, {
    getIsLandscape: () => window.innerWidth > window.innerHeight,
    onVisualUpdate: (target, x, y) => {
      gyroLiveX = x;
      gyroLiveY = y;
      activeRenderer?.updateGyroThumb(
        target as 'leftStick' | 'rightStick',
        x,
        y,
      );
      if (island && !island.isDestroyed())
        island.update({ gyroLiveX: x, gyroLiveY: y });
    },
    onStatusChange: (s) => {
      gyroStatus = s;
      if (island && !island.isDestroyed()) island.update({ gyroStatus: s });
    },
  });
  activeGyro = gyro;

  // keep exclusive lock in sync with gyro target/enabled
  const syncGyroLock = () => {
    const s = settingsStore.getState();
    const locked = s.gyroEnabled
      ? (s.gyroTarget as 'leftStick' | 'rightStick')
      : null;
    activeRenderer?.setGyroLocked(locked);
  };
  const unsubGyroLock = settingsStore.subscribe((s, prev) => {
    if (s.gyroEnabled !== prev.gyroEnabled || s.gyroTarget !== prev.gyroTarget)
      syncGyroLock();
  });

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
  if (storeState.ignoreCutout) host.classList.add('ignore-cutout');

  const fullscreen = buildFullscreenButton();
  chrome.append(fullscreen.button);
  shell.append(host);
  // immediate long-press kill before layout even renders. preventDefault on
  // touchstart/touchend is what stops Android from even starting long-press
  // detection (the contextmenu buzz). Downside: it also suppresses the
  // synthetic click on touch, so the settings/fullscreen buttons bind via
  // pointer events (see bindTap) instead of click.
  {
    const kill = (event: Event): void => event.preventDefault();
    const touchOpts: AddEventListenerOptions = {
      passive: false,
      capture: true,
    };
    const captureOpts: AddEventListenerOptions = { capture: true };
    for (const type of [
      'touchstart',
      'touchmove',
      'touchend',
      'touchcancel',
    ] as const) {
      shell.addEventListener(type, kill, touchOpts);
      host.addEventListener(type, kill, touchOpts);
    }
    for (const type of [
      'contextmenu',
      'selectstart',
      'dragstart',
      'copy',
      'cut',
    ] as const) {
      shell.addEventListener(type, kill, captureOpts);
      host.addEventListener(type, kill, captureOpts);
    }
  }
  root.replaceChildren(shell);

  // lazy island host container (outside shell, fixed overlay)
  const islandHost = document.createElement('div');
  islandHost.id = 'settings-island-host';
  root.append(islandHost);

  let availableLayouts: { id: string; name: string }[] = [];
  let currentLayoutId = '';
  let connectionText = CONNECTION_LABELS.connecting;
  let pingText = '—';
  let island: import('./settings-island').SettingsIsland | undefined;
  let islandLoading = false;

  const capabilityMessages = options.capabilities.currentStatus.messages;
  const capabilityNotes = capabilityMessages.join(' ');

  const updateStatus = (transient: string | null): void => {
    const full = transient ?? CONNECTION_LABELS[socket.state];
    status.textContent = transient
      ? shortStatus(transient)
      : PILL_LABELS[socket.state];
    connectionText = full;
    if (island && !island.isDestroyed()) island.update({ connectionText });
  };

  const updatePing = (text: string) => {
    pingText = text;
    if (island && !island.isDestroyed()) island.update({ pingText });
  };

  const openSettings = async (): Promise<void> => {
    if (islandLoading) return;
    if (island) {
      if (island.isDestroyed()) {
        island = undefined;
      } else {
        // already mounted — reopen (cancels closing animation if in progress)
        island.setOpen(true);
        gearButton.setAttribute('aria-expanded', 'true');
        island.update({
          layouts: availableLayouts,
          selectedLayout: currentLayoutId,
          connectionText,
          pingText,
          gyro,
          gyroStatus,
          gyroLiveX,
          gyroLiveY,
        });
        return;
      }
    }
    islandLoading = true;
    gearButton.setAttribute('aria-expanded', 'true');
    try {
      const { mountSettingsIsland } = await import('./settings-island');
      island = mountSettingsIsland(islandHost, {
        store: settingsStore,
        feedback,
        capabilityNotes,
        layouts: availableLayouts,
        selectedLayout: currentLayoutId,
        onSelectLayout: (id) => {
          if (!id || id === currentLayoutId) return;
          if (socket.selectLayout(id)) updateStatus('Loading layout...');
        },
        connectionText,
        pingText,
        gyro,
        gyroStatus,
        gyroLiveX,
        gyroLiveY,
        onClose: () => {
          gearButton.setAttribute('aria-expanded', 'false');
          // focus back to gear for a11y, but only if still in DOM
          if (document.contains(gearButton)) gearButton.focus();
          island = undefined;
          islandLoading = false;
        },
      });
    } catch (err) {
      console.error('Failed to load settings island', err);
      gearButton.setAttribute('aria-expanded', 'false');
      islandLoading = false;
    } finally {
      // on success, keep loading false (onClose will also clear). Don't
      // overwrite the true->false from onClose double clear.
      if (island) islandLoading = false;
    }
  };

  const unbindGearTap = bindTap(gearButton, () => {
    void openSettings();
  });

  const onShellKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && island) {
      island.unmount();
    }
  };
  document.addEventListener('keydown', onShellKeyDown);
  removeControllerDocumentHandlers = () => {
    document.removeEventListener('keydown', onShellKeyDown);
    unbindGearTap();
    fullscreen.cleanup();
    unsubFeedback();
    unsubGyroLock();
    gyro.destroy();
    activeGyro = undefined;
    island?.unmount();
  };

  activeSender = new FrameSender(
    {
      sendBinary: (frame) => activeSocket?.sendBinary(frame) ?? false,
    },
    state,
  );

  const socket = new ControllerSocket({
    sessionCode: options.sessionCode,
    displayName: options.displayName,
    selectedLayout: readStorage(SELECTED_LAYOUT_KEY) ?? undefined,
    capabilities: () => options.capabilities.capabilities,
    onStateChange: (nextState) => {
      updateStatus(nextState === 'active' ? null : null);
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
          true,
        );
      }
    },
    onWelcome: (welcome) => {
      // code is valid — now it's safe to grab fullscreen/orientation. Still
      // inside the transient user-activation window from the Join click (LAN
      // round-trip is ~50-300ms, activation lives ~5s) so browsers accept it.
      void options.capabilities
        .requestJoinCapabilities()
        .catch(() => undefined);

      activeSender?.setInputRate(welcome.targetInputRate);
      applyWelcome(welcome, slot, name, shell);
      availableLayouts = welcome.availableLayouts;
      currentLayoutId = welcome.selectedLayout;
      if (island && !island.isDestroyed())
        island.update({
          layouts: availableLayouts,
          selectedLayout: currentLayoutId,
        });
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
      syncGyroLock();
      if (island && !island.isDestroyed())
        island.update({ selectedLayout: currentLayoutId });
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
        const reveal =
          message.code === 'invalid_code' ||
          message.code === 'invalid_reconnect';
        renderJoinScreen(message.message, reveal);
        return;
      }
      if (message.code === 'invalid_layout') {
        if (island && !island.isDestroyed())
          island.update({ selectedLayout: currentLayoutId });
      }
      updateStatus(message.message);
    },
    onRumble: (message) => feedback.rumble(message),
    onPing: (rttMs) => {
      updatePing(`${Math.round(rttMs)} ms`);
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

  const neutralize = (): void => {
    const wasRunning = activeSender?.isRunning ?? false;
    if (wasRunning) activeSender?.stop();
    activeRenderer?.cancelPointers();
    gyro.handleVisibilityHidden();
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
): void {
  slot.textContent = `Player ${welcome.slot + 1}`;
  const isDefaultName = DEFAULT_NAME_PATTERN.test(welcome.displayName);
  name.textContent = welcome.displayName;
  name.hidden = isDefaultName;
  name.style.display = isDefaultName ? 'none' : '';
  shell.style.setProperty('--slot-accent', welcome.accent);
}
