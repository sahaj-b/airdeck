import '@/index.css';
import '../controller/controller.css';
import { CapabilityManager } from '../controller/capabilities';
import { FeedbackController } from '../controller/feedback';
import { FrameSender } from '../controller/frame-sender';
import { buildFullscreenButton } from '../controller/fullscreen-button';
import { GyroController } from '../controller/gyro/controller';
import {
  type RenderedLayout,
  renderLayout,
} from '../controller/layout-renderer';
import { ControllerSocket, SELECTED_LAYOUT_KEY } from '../controller/socket';
import { InputStateStore } from '../controller/state';
import { bindTap } from '../controller/tap';
import type { Welcome } from '../shared/contracts';
import type { LayoutDocument } from '../shared/layout';
import { DEFAULT_LAYOUT, validateLayout } from '../shared/layout';
import { getSkin, initSkin, setSkin } from '../skins/loader';
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
import {
  deletePersonalLayout,
  loadPersonalLayouts,
  renamePersonalLayout,
} from './personal-layouts';
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
  panel.className =
    'flex min-h-[100dvh] min-h-[100svh] flex-col items-center justify-center gap-6 overflow-y-auto bg-background p-5 pt-[max(1.25rem,env(safe-area-inset-top))] pr-[max(1.25rem,env(safe-area-inset-right))] pb-[max(1.25rem,env(safe-area-inset-bottom))] pl-[max(1.25rem,env(safe-area-inset-left))] [-webkit-overflow-scrolling:touch] [@media(max-height:440px)]:p-2.5 [@media(orientation:landscape)_and_(max-height:620px)]:justify-start [@media(orientation:landscape)_and_(max-height:620px)]:gap-4 [@media(orientation:landscape)_and_(max-height:620px)]:p-3';
  const brand = document.createElement('div');
  brand.className = 'flex w-full shrink-0 justify-center';
  const brandLogo = document.createElement('img');
  brandLogo.src = '/airdeck.svg';
  brandLogo.alt = 'Airdeck';
  brandLogo.className =
    'block h-9 w-auto max-w-[70vw] sm:h-[2.65rem] [@media(orientation:landscape)_and_(max-height:620px)]:h-7';
  brandLogo.width = 266;
  brandLogo.height = 48;
  brand.append(brandLogo);
  const content = document.createElement('div');
  content.className =
    'w-full max-w-[30rem] shrink-0 rounded-[var(--radius)] border bg-card p-6 text-card-foreground shadow-sm [@media(max-height:560px)]:p-[1.15rem] [@media(max-height:440px)]:p-4 [@media(orientation:landscape)_and_(max-height:620px)_and_(min-width:700px)]:max-w-[54rem] [@media(orientation:landscape)_and_(max-height:620px)_and_(min-width:700px)]:px-6 [@media(orientation:landscape)_and_(max-height:500px)_and_(max-width:699px)]:max-w-[38rem]';
  panel.append(brand, content);

  const heading = document.createElement('h1');
  heading.textContent = 'Join a session';
  heading.className =
    'm-0 font-heading text-[1.55rem] font-semibold leading-none tracking-[-0.025em] [@media(max-height:440px)]:text-[1.3rem] [@media(orientation:landscape)_and_(max-height:620px)_and_(min-width:700px)]:text-[1.5rem] [@media(orientation:landscape)_and_(max-height:500px)_and_(max-width:699px)]:text-[1.3rem]';
  const intro = document.createElement('p');
  intro.className = 'hidden';
  intro.textContent =
    'Enter the session code if your host uses one. Keep this page open while you play.';

  const fullscreen = buildFullscreenButton();
  // override controller's absolute positioning -> static centered button
  fullscreen.button.classList.add(
    '!static',
    '!translate-x-0',
    'mx-auto',
    'mt-4',
    'border',
    'bg-secondary',
    'text-secondary-foreground',
    '[@media(orientation:landscape)_and_(max-height:620px)_and_(min-width:700px)]:col-span-full',
  );
  // ensure static wins even without !important fallback
  fullscreen.button.style.position = 'static';
  fullscreen.button.style.transform = 'none';
  fullscreen.button.style.left = 'auto';
  fullscreen.button.style.bottom = 'auto';
  removeJoinFullscreenHandler = fullscreen.cleanup;

  const form = document.createElement('form');
  form.className =
    'mt-5 grid gap-4 [@media(max-height:560px)]:mt-4 [@media(max-height:560px)]:gap-3 [@media(orientation:landscape)_and_(max-height:620px)_and_(min-width:700px)]:grid-cols-[0.92fr_1.08fr] [@media(orientation:landscape)_and_(max-height:620px)_and_(min-width:700px)]:items-start [@media(orientation:landscape)_and_(max-height:620px)_and_(min-width:700px)]:gap-x-7 [@media(orientation:landscape)_and_(max-height:500px)_and_(max-width:699px)]:gap-[0.65rem] [@media(orientation:landscape)_and_(max-height:500px)_and_(max-width:699px)]:mt-[0.9rem]';
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
  // textField already applied Tailwind + mono tracking for code input
  codeField.input.inputMode = 'numeric';
  codeField.input.maxLength = 4;
  codeField.input.pattern = '[0-9]{4}';
  if (shouldHideCode) codeField.wrapper.hidden = true;
  const codeToggle = document.createElement('button');
  codeToggle.type = 'button';
  codeToggle.className =
    'justify-self-start -mt-1 bg-transparent px-0 py-[0.15rem] text-[0.72rem] font-normal tracking-[0.02em] text-muted-foreground underline decoration-[color-mix(in_oklch,var(--muted-foreground)_35%,transparent)] underline-offset-[3px] hover:text-foreground hover:decoration-current focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:rounded-sm cursor-pointer';
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
  preferences.className =
    'm-0 grid gap-2.5 rounded-[calc(var(--radius)-2px)] border bg-transparent p-3 px-[0.85rem] [@media(orientation:landscape)_and_(max-height:500px)_and_(max-width:699px)]:grid-cols-2 [@media(orientation:landscape)_and_(max-height:500px)_and_(max-width:699px)]:gap-x-3 [@media(orientation:landscape)_and_(max-height:500px)_and_(max-width:699px)]:gap-y-1.5 [@media(orientation:landscape)_and_(max-height:500px)_and_(max-width:699px)]:p-2.5';
  const legend = document.createElement('legend');
  legend.textContent = 'Local feedback';
  legend.className =
    'px-1.5 text-foreground text-[0.8rem] font-medium leading-none';
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
  capabilityMessage.className =
    'm-0 text-muted-foreground text-[0.78rem] leading-[1.4]';
  capabilityMessage.setAttribute('role', 'status');
  capabilityMessage.setAttribute('aria-live', 'polite');
  const error = document.createElement('p');
  error.className = 'm-0 text-destructive text-[0.78rem] leading-[1.4]';
  error.setAttribute('role', 'alert');
  error.textContent = errorMessage;
  if (!errorMessage) error.hidden = true;

  const submit = document.createElement('button');
  submit.className =
    'flex h-10 w-full items-center justify-center rounded-[calc(var(--radius)-2px)] border border-transparent bg-primary px-4 text-primary-foreground text-[0.9rem] font-medium cursor-pointer hover:bg-[color-mix(in_oklch,var(--primary)_90%,black)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60 [@media(max-height:560px)]:h-[2.35rem] [@media(orientation:landscape)_and_(max-height:500px)_and_(max-width:699px)]:h-[2.3rem] [@media(orientation:landscape)_and_(max-height:620px)_and_(min-width:700px)]:mt-[0.15rem]';
  submit.type = 'submit';
  submit.textContent = 'Join';

  // left/right split: left holds branding + inputs where empty space was,
  // right holds options + action so Join is always shown in landscape
  const left = document.createElement('div');
  left.className =
    'grid gap-[0.85rem] content-start [@media(orientation:landscape)_and_(max-height:500px)_and_(max-width:699px)]:grid-cols-2 [@media(orientation:landscape)_and_(max-height:500px)_and_(max-width:699px)]:gap-x-3 [@media(orientation:landscape)_and_(max-height:500px)_and_(max-width:699px)]:gap-y-2.5';
  // heading spans full width when left becomes 2-col on compact landscape
  heading.classList.add(
    '[@media(orientation:landscape)_and_(max-height:500px)_and_(max-width:699px)]:col-span-full',
  );
  left.append(heading, intro, codeField.wrapper, codeToggle, nameField.wrapper);
  const right = document.createElement('div');
  right.className = 'grid gap-[0.85rem] content-start';
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
  let currentLayoutDoc: LayoutDocument = DEFAULT_LAYOUT;
  let playerId = '';
  let currentPlayerDisplayName = options.displayName || '';
  let connectionText = CONNECTION_LABELS.connecting;
  let pingText = '—';
  let island: import('./settings-island').SettingsIsland | undefined;
  let islandLoading = false;
  let phoneEditorActive = false;
  let publishState: { id: string; name: string; remaining: number } | null =
    null;
  let publishTimer: number | undefined;
  let pendingPublishId: string | null = null;

  const capabilityMessages = options.capabilities.currentStatus.messages;
  const capabilityNotes = capabilityMessages.join(' ');

  const getPersonalList = (): { id: string; name: string }[] =>
    Object.values(loadPersonalLayouts()).map((d) => ({
      id: d.id,
      name: d.name,
    }));

  const isPersonalLayout = (id: string): boolean => {
    try {
      return !!loadPersonalLayouts()[id];
    } catch {
      return false;
    }
  };

  const renderLocalLayout = (doc: LayoutDocument) => {
    activeRenderer?.destroy();
    activeRenderer = renderLayout(host, doc, { state, feedback, chrome });
    currentLayoutDoc = doc;
    currentLayoutId = doc.id;
    writeStorage(SELECTED_LAYOUT_KEY, doc.id);
    syncGyroLock();
    if (island && !island.isDestroyed())
      island.update({
        selectedLayout: currentLayoutId,
        layouts: availableLayouts,
        personalLayouts: getPersonalList(),
      });
  };

  const clearPublishTimer = () => {
    if (publishTimer !== undefined) {
      window.clearInterval(publishTimer);
      publishTimer = undefined;
    }
  };

  const setPublishState = (next: typeof publishState) => {
    publishState = next;
    if (island && !island.isDestroyed()) island.update({ publishState });
  };

  const startPublishCountdown = (id: string, docName: string) => {
    let remaining = 60;
    setPublishState({ id, name: docName, remaining });
    clearPublishTimer();
    publishTimer = window.setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        clearPublishTimer();
        setPublishState(null);
        pendingPublishId = null;
        return;
      }
      if (publishState) setPublishState({ ...publishState, remaining });
    }, 1000);
  };

  const handleSelectLayout = (id: string) => {
    if (!id || id === currentLayoutId) return;
    if (isPersonalLayout(id)) {
      const doc = loadPersonalLayouts()[id];
      if (doc && validateLayout(doc)) {
        renderLocalLayout(doc);
        updateStatus('Controller ready.');
      }
      return;
    }
    if (socket.selectLayout(id)) updateStatus('Loading layout...');
  };

  const handleEditPersonal = async (editId: string) => {
    let docToEdit: LayoutDocument | undefined;
    if (editId === '__new_from_current') {
      const base = currentLayoutDoc;
      const isPersonal = isPersonalLayout(base.id);
      if (isPersonal) {
        docToEdit = { ...structuredClone(base), name: base.name };
      } else {
        const rawPlayer =
          currentPlayerDisplayName || readStorage(DISPLAY_NAME_KEY) || '';
        const isDefault =
          !rawPlayer.trim() || DEFAULT_NAME_PATTERN.test(rawPlayer.trim());
        const suffix = isDefault ? 'Copy' : rawPlayer.trim();
        const newName = `${base.name} ${suffix}`.trim();
        docToEdit = { ...structuredClone(base), name: newName };
      }
    } else {
      docToEdit = loadPersonalLayouts()[editId];
      if (!docToEdit) docToEdit = currentLayoutDoc;
    }
    // Close settings drawer while editing to avoid overlapping overlays
    if (island && !island.isDestroyed()) {
      island.unmount();
    }
    phoneEditorActive = true;
    try {
      const { mountPhoneEditor } = await import('./phone-editor-island');
      // Ensure sender exists
      const sender = activeSender;
      if (!sender || !activeRenderer) {
        phoneEditorActive = false;
        return;
      }
      const overlayHost = document.createElement('div');
      overlayHost.id = 'phone-editor-host';
      overlayHost.style.position = 'fixed';
      overlayHost.style.inset = '0';
      overlayHost.style.zIndex = '50';
      document.body.append(overlayHost);
      const handle = mountPhoneEditor(overlayHost, {
        document: docToEdit,
        sender,
        state,
        renderer: activeRenderer,
        hostLayoutIds: availableLayouts.map((l) => l.id),
        onSave: (nextDoc) => {
          overlayHost.remove();
          phoneEditorActive = false;
          renderLocalLayout(nextDoc);
          // refresh personal list in settings if reopened
          if (island && !island.isDestroyed())
            island.update({
              personalLayouts: getPersonalList(),
              selectedLayout: nextDoc.id,
            });
        },
        onCancel: () => {
          overlayHost.remove();
          phoneEditorActive = false;
          // restore previous doc renderer already reverted in island cancel
        },
      });
      // island handle auto-cleans on save/cancel; guard visibility neutralize via phoneEditorActive flag
      void handle;
    } catch (err) {
      console.error('Failed to load phone editor', err);
      phoneEditorActive = false;
    }
  };

  const handleDeletePersonal = (id: string) => {
    deletePersonalLayout(id);
    const list = getPersonalList();
    // if deleted was current, fallback to default host layout or first available
    if (currentLayoutId === id) {
      const fallback = availableLayouts[0];
      if (fallback) handleSelectLayout(fallback.id);
      else renderLocalLayout(DEFAULT_LAYOUT);
    }
    if (island && !island.isDestroyed())
      island.update({ personalLayouts: list, selectedLayout: currentLayoutId });
  };

  const handleRenamePersonal = (id: string, newName: string) => {
    const slug = newName
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    if (availableLayouts.some((l) => l.id === slug)) {
      updateStatus(`"${newName.trim()}" collides with a host layout.`);
      setTimeout(() => updateStatus(null), 3000);
      return;
    }
    const result = renamePersonalLayout(id, newName);
    if (result.error) {
      updateStatus(result.error);
      setTimeout(() => updateStatus(null), 3000);
      console.warn(result.error);
      return;
    }
    const list = getPersonalList();
    if (currentLayoutId === id) currentLayoutId = result.nextId;
    if (island && !island.isDestroyed())
      island.update({ personalLayouts: list, selectedLayout: currentLayoutId });
    // if renamed current personal doc, re-render with new id/name doc
    const docs = loadPersonalLayouts();
    if (docs[result.nextId] && currentLayoutId === result.nextId) {
      renderLocalLayout(docs[result.nextId]);
    }
  };

  const handlePublishPersonal = async (id: string) => {
    const doc = loadPersonalLayouts()[id];
    if (!doc || !playerId) return;
    try {
      const res = await fetch('/api/layouts/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId, document: doc }),
      });
      if (res.status !== 202) {
        const body = await res.json().catch(() => ({}));
        const msg = (body as { error?: string }).error ?? 'Publish failed.';
        updateStatus(msg);
        return;
      }
      const body = (await res.json()) as { id: string; status: string };
      pendingPublishId = body.id;
      startPublishCountdown(body.id, doc.name);
    } catch (err) {
      console.error('Publish failed', err);
      updateStatus('Publish failed.');
    }
  };

  const handleCancelPublish = async () => {
    if (!pendingPublishId) {
      clearPublishTimer();
      setPublishState(null);
      return;
    }
    const id = pendingPublishId;
    pendingPublishId = null;
    clearPublishTimer();
    setPublishState(null);
    try {
      await fetch(`/api/layouts/publish/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
    } catch {
      // ignore
    }
  };

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
          personalLayouts: getPersonalList(),
          publishState,
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
        personalLayouts: getPersonalList(),
        selectedLayout: currentLayoutId,
        publishState,
        onSelectLayout: handleSelectLayout,
        onEditPersonal: handleEditPersonal,
        onDeletePersonal: handleDeletePersonal,
        onRenamePersonal: handleRenamePersonal,
        onPublishPersonal: handlePublishPersonal,
        onCancelPublish: handleCancelPublish,
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
    clearPublishTimer();
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
    selectedLayout: (() => {
      const stored = readStorage(SELECTED_LAYOUT_KEY) ?? undefined;
      if (stored && isPersonalLayout(stored)) return undefined;
      return stored;
    })(),
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
      playerId = welcome.playerId;
      currentPlayerDisplayName =
        welcome.displayName || currentPlayerDisplayName;
      const stored = readStorage(SELECTED_LAYOUT_KEY);
      if (stored && isPersonalLayout(stored)) {
        const personalDoc = loadPersonalLayouts()[stored];
        if (personalDoc && validateLayout(personalDoc)) {
          currentLayoutId = stored;
          currentLayoutDoc = personalDoc;
          renderLocalLayout(personalDoc);
          if (island && !island.isDestroyed())
            island.update({
              layouts: availableLayouts,
              personalLayouts: getPersonalList(),
              selectedLayout: currentLayoutId,
            });
          return;
        }
      }
      currentLayoutId = welcome.selectedLayout;
      if (island && !island.isDestroyed())
        island.update({
          layouts: availableLayouts,
          personalLayouts: getPersonalList(),
          selectedLayout: currentLayoutId,
        });
    },
    onLayout: (layout, diagnostic) => {
      // if current selection is personal, don't overwrite it with host layout pushes (only when host changes default or reassigned)
      // However if host sends layout that matches current host selection, we should render it.
      // For simplicity, if current is personal, ignore host layout messages unless diagnostic indicates reassignment? spec says layout update does not push new layout to currently playing phones, while deleting selected layout sends default. So host layout push is only for active host selection changes, but personal should remain.
      if (isPersonalLayout(currentLayoutId)) {
        // Only update if host explicitly moved player to a different host layout via dashboard roster assign
        // That would come as welcome.selectedLayout change? For now ignore pure host layout pushes when personal is active
        // but keep availableLayouts updated via welcome. Diagnostic path handled.
        updateStatus(diagnostic ?? 'Controller ready.');
        return;
      }
      activeRenderer?.destroy();
      activeRenderer = renderLayout(host, layout, {
        state,
        feedback,
        chrome,
      });
      currentLayoutDoc = layout;
      currentLayoutId = layout.id;
      writeStorage(SELECTED_LAYOUT_KEY, layout.id);
      syncGyroLock();
      if (island && !island.isDestroyed())
        island.update({ selectedLayout: currentLayoutId });
      updateStatus(diagnostic ?? 'Controller ready.');
    },
    onSlotUpdate: (update) => {
      slot.textContent = `Player ${update.slot + 1}`;
      shell.style.setProperty('--slot-accent', update.accent);
    },
    onPublishResult: (result) => {
      clearPublishTimer();
      // only handle pending id match
      if (pendingPublishId && result.id !== pendingPublishId) return;
      pendingPublishId = null;
      publishState = null;
      if (island && !island.isDestroyed())
        island.update({ publishState: null });
      const message =
        result.status === 'accepted'
          ? `Publish accepted (${result.id}).`
          : result.status === 'declined'
            ? `Publish declined.`
            : result.status === 'expired'
              ? `Publish expired.`
              : `Publish cancelled.`;
      updateStatus(message);
      setTimeout(() => updateStatus(null), 3000);
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
    if (phoneEditorActive) {
      activeRenderer?.cancelPointers();
      gyro.handleVisibilityHidden();
      state.reset();
      return;
    }
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
