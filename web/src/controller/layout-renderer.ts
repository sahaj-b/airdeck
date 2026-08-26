import type { Orientation } from '../shared/contracts';
import {
  type Control,
  DEFAULT_LAYOUT,
  type LayoutDocument,
  orientationRect,
  validateLayout,
} from '../shared/layout';
import { type PointerFeedback, PointerInput } from './pointer-input';
import type { InputStateStore } from './state';

export interface LayoutRendererOptions {
  state: InputStateStore;
  feedback?: PointerFeedback;
  orientation?: Orientation;
  assetBasePath?: string;
}

export interface RenderedLayout {
  root: HTMLElement;
  pointerInput: PointerInput;
  setOrientation(orientation: Orientation): void;
  cancelPointers(): void;
  destroy(): void;
}

interface RenderedControl {
  control: Control;
  element: HTMLElement;
}

const CHEVRON_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5.5 14.5 12 8l6.5 6.5" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

export function renderLayout(
  container: HTMLElement,
  document: LayoutDocument,
  options: LayoutRendererOptions,
): RenderedLayout {
  const layout = validateLayout(document) ? document : DEFAULT_LAYOUT;
  const ownerDocument = container.ownerDocument;
  const pointerInput = new PointerInput(options.state, options.feedback);
  const root = ownerDocument.createElement('div');
  root.className = 'controller-layout';
  root.dataset.layoutId = layout.id;

  const surface = ownerDocument.createElement('div');
  surface.className = 'controller-surface';
  root.append(surface);

  const orientationMessage = ownerDocument.createElement('div');
  orientationMessage.className = 'orientation-message';
  orientationMessage.setAttribute('role', 'status');
  orientationMessage.textContent =
    'Rotate your phone to landscape to use this controller.';
  root.append(orientationMessage);

  const renderedControls: RenderedControl[] = [];
  const assetBasePath = options.assetBasePath ?? '/assets';
  for (const section of layout.sections) {
    const sectionElement = ownerDocument.createElement('section');
    sectionElement.className = 'controller-section';
    sectionElement.dataset.sectionId = section.id;
    setGeometry(sectionElement, section.rect);
    surface.append(sectionElement);

    for (const control of section.controls) {
      if (!control.visible) continue;
      const rendered = renderControl(
        ownerDocument,
        control,
        layout,
        assetBasePath,
        pointerInput,
      );
      if (!rendered) continue;
      renderedControls.push(rendered);
      sectionElement.append(rendered.element);
    }
  }

  container.replaceChildren(root);
  const hasPortraitGeometry = layout.sections.some((section) =>
    section.controls.some((control) => control.orientations?.portrait),
  );

  const applyOrientation = (orientation: Orientation): void => {
    root.dataset.orientation = orientation;
    root.classList.toggle('has-portrait-layout', hasPortraitGeometry);
    root.classList.toggle(
      'portrait-fallback',
      orientation === 'portrait' &&
        layout.defaultOrientation === 'landscape' &&
        !hasPortraitGeometry,
    );
    for (const rendered of renderedControls) {
      setControlGeometry(
        rendered.element,
        orientationRect(rendered.control, orientation),
      );
    }
  };
  applyOrientation(
    options.orientation ?? readOrientation(ownerDocument.defaultView),
  );

  const view = ownerDocument.defaultView;
  const onViewportChange = (): void => applyOrientation(readOrientation(view));
  view?.addEventListener('resize', onViewportChange);
  view?.addEventListener('orientationchange', onViewportChange);

  return {
    root,
    pointerInput,
    setOrientation: applyOrientation,
    cancelPointers: () => pointerInput.clear(),
    destroy: () => {
      pointerInput.destroy();
      view?.removeEventListener('resize', onViewportChange);
      view?.removeEventListener('orientationchange', onViewportChange);
      root.remove();
    },
  };
}

function renderControl(
  document: Document,
  control: Control,
  layout: LayoutDocument,
  assetBasePath: string,
  pointerInput: PointerInput,
): RenderedControl | undefined {
  if (control.type === 'label') {
    const label = document.createElement('span');
    label.className = 'controller-label';
    label.textContent = control.label;
    setControlGeometry(label, control.rect);
    return { control, element: label };
  }

  if (control.type === 'image') {
    const image = document.createElement('img');
    image.className = 'controller-image';
    image.alt = control.label;
    const asset = layout.assets.find(
      (candidate) => candidate.id === control.asset,
    );
    if (asset) image.src = assetURL(assetBasePath, asset.path);
    setControlGeometry(image, control.rect);
    return { control, element: image };
  }

  if (control.type === 'dpad') {
    const dpad = document.createElement('div');
    dpad.className = 'controller-control controller-dpad';
    dpad.dataset.controlId = control.id;
    dpad.setAttribute('aria-label', control.label);
    setControlGeometry(dpad, control.rect);
    const directions = ['up', 'right', 'down', 'left'] as const;
    for (const direction of directions) {
      const marker = document.createElement('span');
      marker.className = `dpad-direction dpad-${direction}`;
      marker.innerHTML = CHEVRON_SVG;
      marker.setAttribute('aria-hidden', 'true');
      dpad.append(marker);
    }
    pointerInput.bind(dpad, control);
    return { control, element: dpad };
  }

  const element = document.createElement('button');
  element.type = 'button';
  element.className = `controller-control control-${control.type}`;
  element.dataset.controlId = control.id;
  element.dataset.shape = control.shape ?? 'rect';
  element.textContent = control.label;
  element.setAttribute('aria-label', control.label);
  if (control.type === 'button') element.setAttribute('aria-pressed', 'false');
  if (control.type === 'trigger') {
    element.setAttribute('aria-valuemin', '0');
    element.setAttribute('aria-valuemax', '255');
    element.setAttribute('aria-valuenow', '0');
  }
  setControlGeometry(element, control.rect);
  if (control.binding) pointerInput.bind(element, control);
  return { control, element };
}

function setGeometry(
  element: HTMLElement,
  rect: { x: number; y: number; width: number; height: number },
): void {
  element.style.setProperty('--x', `${rect.x * 100}%`);
  element.style.setProperty('--y', `${rect.y * 100}%`);
  element.style.setProperty('--width', `${rect.width * 100}%`);
  element.style.setProperty('--height', `${rect.height * 100}%`);
}

// Control width/height are fractions of the section height (reference
// dimension) so controls keep their authored aspect ratio on any screen.
function setControlGeometry(
  element: HTMLElement,
  rect: { x: number; y: number; width: number; height: number },
): void {
  element.style.setProperty('--x', `${rect.x * 100}%`);
  element.style.setProperty('--y', `${rect.y * 100}%`);
  element.style.setProperty('--w', `${rect.width}`);
  element.style.setProperty('--h', `${rect.height}`);
}

function assetURL(basePath: string, path: string): string {
  const encodedPath = path
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
  return `${basePath.replace(/\/$/, '')}/${encodedPath}`;
}

function readOrientation(view: Window | null): Orientation {
  if (!view) return 'landscape';
  return view.innerWidth < view.innerHeight ? 'portrait' : 'landscape';
}
