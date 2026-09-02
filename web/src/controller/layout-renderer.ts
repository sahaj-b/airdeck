import type { Orientation } from '../shared/contracts';
import {
  type Control,
  DEFAULT_LAYOUT,
  type LayoutDocument,
  validateLayout,
} from '../shared/layout';
import { buildFullscreenButton } from './fullscreen-button';
import {
  type PixelRect,
  type ResolvedControl,
  type ResolvedSection,
  resolveLayout,
  type Viewport,
} from './layout-resolver';
import { type PointerFeedback, PointerInput } from './pointer-input';
import type { InputStateStore } from './state';

export interface LayoutRendererOptions {
  state: InputStateStore;
  feedback?: PointerFeedback;
  orientation?: Orientation;
  chrome?: HTMLElement;
  interactive?: boolean;
}

export interface RenderedLayout {
  root: HTMLElement;
  pointerInput: PointerInput | null;
  setOrientation(orientation: Orientation, viewport?: Viewport): void;
  setGyroLocked(target: 'leftStick' | 'rightStick' | null): void;
  updateGyroThumb(
    target: 'leftStick' | 'rightStick',
    x: number,
    y: number,
  ): void;
  cancelPointers(): void;
  destroy(): void;
  update(nextDocument: LayoutDocument, viewport?: Viewport): void;
}

interface RenderedControl {
  control: Control;
  target?: HTMLElement;
  visual: HTMLElement;
}

interface RenderedSection {
  sectionId: string;
  element: HTMLElement;
  controls: RenderedControl[];
}

const CHEVRON_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5.5 14.5 12 8l6.5 6.5" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

export function renderLayout(
  container: HTMLElement,
  document: LayoutDocument,
  options: LayoutRendererOptions,
): RenderedLayout {
  let layout = validateLayout(document) ? document : DEFAULT_LAYOUT;
  const ownerDocument = container.ownerDocument;
  const view = ownerDocument.defaultView;
  const interactive = options.interactive !== false;
  const pointerInput = interactive
    ? new PointerInput(options.state, options.feedback)
    : null;
  const root = ownerDocument.createElement('div');
  root.className = 'controller-layout';
  root.dataset.layoutId = layout.id;

  const frame = ownerDocument.createElement('div');
  frame.className = 'controller-frame';
  const composition = ownerDocument.createElement('div');
  composition.className = 'controller-composition';
  frame.append(composition);
  root.append(frame);

  const orientationMessage = ownerDocument.createElement('div');
  orientationMessage.className = 'orientation-message';
  orientationMessage.setAttribute('role', 'status');
  orientationMessage.textContent =
    'Rotate your phone to landscape to use this controller.';
  root.append(orientationMessage);
  const fallbackFullscreen = interactive ? buildFullscreenButton() : null;
  if (interactive && fallbackFullscreen) {
    orientationMessage.append(fallbackFullscreen.button);
  }

  const renderedSections: RenderedSection[] = [];
  for (const section of layout.sections) {
    const sectionElement = ownerDocument.createElement('section');
    sectionElement.className = 'controller-section';
    sectionElement.dataset.sectionId = section.id;
    const renderedSection: RenderedSection = {
      sectionId: section.id,
      element: sectionElement,
      controls: [],
    };
    for (const control of section.controls) {
      const rendered = renderControl(ownerDocument, control, layout);
      if (!rendered) continue;
      renderedSection.controls.push(rendered);
      if (rendered.target) sectionElement.append(rendered.target);
      else sectionElement.append(rendered.visual);
    }
    renderedSections.push(renderedSection);
    composition.append(sectionElement);
  }

  if (interactive && pointerInput) {
    const visualById = new Map<string, HTMLElement>();
    for (const section of renderedSections) {
      for (const rc of section.controls) {
        if (rc.control.type !== 'hitzone')
          visualById.set(rc.control.id, rc.visual);
      }
    }
    for (const section of renderedSections) {
      for (const rc of section.controls) {
        if (!rc.target) continue;
        if (rc.control.type === 'hitzone') {
          const parent = layout.sections
            .flatMap((s) => s.controls)
            .find((c) => c.id === rc.control.parentId);
          if (!parent) continue;
          const parentVisual = visualById.get(parent.id);
          const effectiveControl = {
            ...rc.control,
            binding: parent.binding,
            bindings: parent.bindings,
          } as Control;
          pointerInput.bind(
            rc.target,
            effectiveControl,
            rc.visual,
            parentVisual,
          );
        } else {
          pointerInput.bind(rc.target, rc.control, rc.visual);
        }
      }
    }
  }

  if (options.chrome && interactive) {
    options.chrome.classList.add('controller-runtime-chrome');
    const centerIndex = 1;
    renderedSections[centerIndex]?.element.append(options.chrome);
  }

  container.replaceChildren(root);

  const cleanups: (() => void)[] = [];

  // Must be capture + non-passive or iOS/Android still selects/buzzes before pointerdown.
  // preventDefault on touchstart kills synthetic clicks, so buttons use pointer events (bindTap).
  if (interactive) {
    const kill = (event: Event): void => {
      event.preventDefault();
    };
    const touchOpts: AddEventListenerOptions = {
      passive: false,
      capture: true,
    };
    const captureOpts: AddEventListenerOptions = { capture: true };
    const touchEvents = [
      'touchstart',
      'touchmove',
      'touchend',
      'touchcancel',
    ] as const;
    const menuEvents = [
      'contextmenu',
      'selectstart',
      'dragstart',
      'copy',
      'cut',
      'beforeinput',
    ] as const;
    for (const type of touchEvents) {
      root.addEventListener(type, kill, touchOpts);
      container.addEventListener(type, kill, touchOpts);
      cleanups.push(() => {
        root.removeEventListener(type, kill, touchOpts);
        container.removeEventListener(type, kill, touchOpts);
      });
    }
    for (const type of menuEvents) {
      root.addEventListener(type, kill, captureOpts);
      container.addEventListener(type, kill, captureOpts);
      cleanups.push(() => {
        root.removeEventListener(type, kill, captureOpts);
        container.removeEventListener(type, kill, captureOpts);
      });
    }
    const onSelectionChange = (): void => {
      const selection = ownerDocument.getSelection?.();
      if (!selection || selection.rangeCount === 0 || selection.type === 'None')
        return;
      const anchor = selection.anchorNode;
      const focus = selection.focusNode;
      const inside = (node: Node | null): boolean => {
        if (!node) return false;
        if (root.contains(node) || container.contains(node)) return true;
        return (
          node instanceof Element && node.closest('.controller-shell') !== null
        );
      };
      if (inside(anchor) || inside(focus)) selection.removeAllRanges();
    };
    ownerDocument.addEventListener('selectionchange', onSelectionChange);
    cleanups.push(() =>
      ownerDocument.removeEventListener('selectionchange', onSelectionChange),
    );
    const onDocContextMenu = (event: Event): void => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (
        target.closest('.controller-shell') ||
        root.contains(target) ||
        container.contains(target)
      )
        event.preventDefault();
    };
    ownerDocument.addEventListener(
      'contextmenu',
      onDocContextMenu,
      captureOpts,
    );
    cleanups.push(() =>
      ownerDocument.removeEventListener(
        'contextmenu',
        onDocContextMenu,
        captureOpts,
      ),
    );
  }

  const applyOrientation = (
    orientation: Orientation,
    explicit?: Viewport,
  ): void => {
    const geometry = resolveLayout(
      layout,
      explicit ?? readViewport(composition, view),
      orientation,
    );
    root.dataset.orientation = orientation;
    root.classList.toggle('portrait-fallback', geometry.portraitFallback);
    applyResolvedGeometry(renderedSections, geometry);
  };
  applyOrientation(options.orientation ?? readOrientation(view, composition));

  const onViewportChange = (): void =>
    applyOrientation(readOrientation(view, composition));
  view?.addEventListener('resize', onViewportChange);
  view?.addEventListener('orientationchange', onViewportChange);

  const setGyroLocked = (target: 'leftStick' | 'rightStick' | null): void => {
    pointerInput?.setGyroLocked(target);
    for (const section of renderedSections) {
      for (const rc of section.controls) {
        if (rc.control.type === 'joystick' && rc.control.binding) {
          const isLocked = target !== null && rc.control.binding === target;
          rc.visual.classList.toggle('gyro-locked', isLocked);
          (rc.target ?? rc.visual).classList.toggle('gyro-locked', isLocked);
        }
      }
    }
  };

  const updateGyroThumb = (
    target: 'leftStick' | 'rightStick',
    x: number,
    y: number,
  ): void => {
    for (const section of renderedSections) {
      for (const rc of section.controls) {
        if (rc.control.binding === target && rc.control.type === 'joystick') {
          rc.visual.style.setProperty('--axis-x', `${x * 100}%`);
          rc.visual.style.setProperty('--axis-y', `${y * 100}%`);
        }
      }
    }
  };

  return {
    root,
    pointerInput,
    setOrientation: applyOrientation,
    setGyroLocked,
    updateGyroThumb,
    cancelPointers: () => pointerInput?.clear(),
    destroy: () => {
      pointerInput?.destroy();
      fallbackFullscreen?.cleanup();
      view?.removeEventListener('resize', onViewportChange);
      view?.removeEventListener('orientationchange', onViewportChange);
      for (const cleanup of cleanups) cleanup();
      root.remove();
    },
    update: (nextDocument: LayoutDocument, viewport?: Viewport) => {
      const next = validateLayout(nextDocument) ? nextDocument : DEFAULT_LAYOUT;
      const structuralChange = (() => {
        if (layout.sections.length !== next.sections.length) return true;
        for (let index = 0; index < layout.sections.length; index += 1) {
          const left = layout.sections[index];
          const right = next.sections[index];
          if (left.id !== right.id) return true;
          if (left.controls.length !== right.controls.length) return true;
          for (
            let controlIndex = 0;
            controlIndex < left.controls.length;
            controlIndex += 1
          ) {
            const leftControl = left.controls[controlIndex];
            const rightControl = right.controls[controlIndex];
            if (leftControl.id !== rightControl.id) return true;
            if (leftControl.type !== rightControl.type) return true;
            if (leftControl.shape !== rightControl.shape) return true;
            if (
              (leftControl as unknown as { hitShape?: string }).hitShape !==
              (rightControl as unknown as { hitShape?: string }).hitShape
            )
              return true;
            if (leftControl.label !== rightControl.label) return true;
            if (leftControl.binding !== rightControl.binding) return true;
            if (leftControl.parentId !== rightControl.parentId) return true;
            if (
              JSON.stringify(
                (leftControl as unknown as { bindings?: unknown }).bindings,
              ) !==
              JSON.stringify(
                (rightControl as unknown as { bindings?: unknown }).bindings,
              )
            )
              return true;
          }
        }
        return false;
      })();
      layout = next;
      root.dataset.layoutId = layout.id;
      if (structuralChange) {
        pointerInput?.destroy();
        const chromeEl = options.chrome;
        if (chromeEl) chromeEl.remove();
        composition.replaceChildren();
        renderedSections.length = 0;
        for (const section of layout.sections) {
          const sectionElement = ownerDocument.createElement('section');
          sectionElement.className = 'controller-section';
          sectionElement.dataset.sectionId = section.id;
          const renderedSection: RenderedSection = {
            sectionId: section.id,
            element: sectionElement,
            controls: [],
          };
          for (const control of section.controls) {
            const rendered = renderControl(ownerDocument, control, layout);
            if (!rendered) continue;
            renderedSection.controls.push(rendered);
            if (rendered.target) sectionElement.append(rendered.target);
            else sectionElement.append(rendered.visual);
          }
          renderedSections.push(renderedSection);
          composition.append(sectionElement);
        }
        if (interactive && pointerInput) {
          const visualById = new Map<string, HTMLElement>();
          for (const section of renderedSections) {
            for (const rc of section.controls) {
              if (rc.control.type !== 'hitzone')
                visualById.set(rc.control.id, rc.visual);
            }
          }
          for (const section of renderedSections) {
            for (const rc of section.controls) {
              if (!rc.target) continue;
              if (rc.control.type === 'hitzone') {
                const parent = layout.sections
                  .flatMap((candidate) => candidate.controls)
                  .find((candidate) => candidate.id === rc.control.parentId);
                if (!parent) continue;
                const parentVisual = visualById.get(parent.id);
                const effectiveControl = {
                  ...rc.control,
                  binding: parent.binding,
                  bindings: parent.bindings,
                } as Control;
                pointerInput.bind(
                  rc.target,
                  effectiveControl,
                  rc.visual,
                  parentVisual,
                );
              } else {
                pointerInput.bind(rc.target, rc.control, rc.visual);
              }
            }
          }
        }
        if (chromeEl && interactive) {
          const centerIndex = 1;
          renderedSections[centerIndex]?.element.append(chromeEl);
        }
      }
      const size = viewport ?? readViewport(composition, view);
      applyOrientation(
        size.width < size.height ? 'portrait' : 'landscape',
        size,
      );
    },
  };
}

function effectiveHitShape(control: Control): 'rect' | 'ellipse' {
  if (control.type === 'dpad') return 'rect';
  if (control.type === 'hitzone') {
    // Hitzones can be round per operator request; otherwise rect.
    // hitShape is forbidden on hitzone, but handle defensively.
    if ((control as unknown as { hitShape?: string }).hitShape === 'rect')
      return 'rect';
    return control.shape === 'round' ? 'ellipse' : 'rect';
  }
  if (control.type === 'label') return 'rect';
  if (control.hitShape === 'rect') return 'rect';
  if (control.shape === 'round') return 'ellipse';
  return 'rect';
}

function renderControl(
  document: Document,
  control: Control,
  layout: LayoutDocument,
): RenderedControl | undefined {
  if (control.type === 'label') {
    const label = document.createElement('span');
    label.className = 'controller-label';
    label.dataset.controlId = control.id;
    label.textContent = control.label;
    return { control, visual: label };
  }

  if (control.type === 'hitzone') {
    const parent = layout.sections
      .flatMap((section) => section.controls)
      .find((candidate) => candidate.id === control.parentId);
    const binding =
      (parent?.binding as Control['binding'] | undefined) ?? undefined;
    const filler = document.createElement('div');
    filler.className = 'controller-control';
    filler.dataset.controlId = control.id;
    if (binding) filler.dataset.command = binding;
    filler.classList.add('hit-only');
    filler.setAttribute('aria-hidden', 'true');
    const target = document.createElement('div');
    target.className = 'controller-hit-target';
    target.dataset.controlId = control.id;
    target.dataset.hitShape = effectiveHitShape(control);
    target.append(filler);
    return { control, target, visual: filler };
  }

  let visual: HTMLElement;
  if (control.type === 'dpad') {
    const dpad = document.createElement('div');
    dpad.className = 'controller-control controller-dpad';
    dpad.dataset.controlId = control.id;
    dpad.setAttribute('aria-label', control.label);
    const directions = ['up', 'right', 'down', 'left'] as const;
    for (const direction of directions) {
      const marker = document.createElement('span');
      marker.className = `dpad-direction dpad-${direction}`;
      marker.innerHTML = CHEVRON_SVG;
      marker.setAttribute('aria-hidden', 'true');
      dpad.append(marker);
    }
    visual = dpad;
  } else if (control.type === 'joystick') {
    const stick = document.createElement('button');
    stick.type = 'button';
    stick.className = `controller-control control-${control.type}`;
    stick.dataset.controlId = control.id;
    stick.dataset.shape = control.shape ?? 'rect';
    stick.dataset.command = control.binding ?? '';
    stick.setAttribute('aria-label', control.label);
    visual = stick;
  } else {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `controller-control control-${control.type}`;
    button.dataset.controlId = control.id;
    button.dataset.shape = control.shape ?? 'rect';
    button.dataset.command = control.binding ?? '';
    button.textContent = control.label;
    button.setAttribute('aria-label', control.label);
    if (control.type === 'button') button.setAttribute('aria-pressed', 'false');
    if (control.type === 'trigger') {
      button.setAttribute('aria-valuemin', '0');
      button.setAttribute('aria-valuemax', '255');
      button.setAttribute('aria-valuenow', '0');
    }
    visual = button;
  }

  const target = document.createElement('div');
  target.className = 'controller-hit-target';
  target.dataset.controlId = control.id;
  target.dataset.hitShape = effectiveHitShape(control);
  target.append(visual);
  return { control, target, visual };
}

function applyResolvedGeometry(
  sections: RenderedSection[],
  geometry: {
    sections: ResolvedSection[];
  },
): void {
  const sectionByID = new Map(
    geometry.sections.map((section) => [section.section.id, section]),
  );
  const controlByID = new Map<string, ResolvedControl>();
  for (const section of geometry.sections) {
    for (const control of section.controls)
      controlByID.set(control.control.id, control);
  }

  for (const renderedSection of sections) {
    const resolved = sectionByID.get(renderedSection.sectionId);
    if (!resolved) continue;
    setPixelRect(renderedSection.element, resolved.rect);
    for (const renderedControl of renderedSection.controls) {
      const resolvedControl = controlByID.get(renderedControl.control.id);
      if (!resolvedControl) continue;
      if (renderedControl.target) {
        setLocalRect(
          renderedControl.target,
          resolvedControl.hit,
          resolved.rect,
        );
        setLocalRect(
          renderedControl.visual,
          resolvedControl.visual,
          resolvedControl.hit,
        );
      } else
        setLocalRect(
          renderedControl.visual,
          resolvedControl.visual,
          resolved.rect,
        );
      applyDynamicSizing(renderedControl, resolvedControl.visual);
    }
  }
}

function applyDynamicSizing(rendered: RenderedControl, rect: PixelRect): void {
  const { control, visual } = rendered;
  if (
    control.type === 'hitzone' ||
    control.type === 'joystick' ||
    control.type === 'dpad'
  )
    return;
  const min = Math.min(rect.width, rect.height);
  const max = Math.max(rect.width, rect.height);
  visual.style.setProperty('--control-w', `${rect.width}px`);
  visual.style.setProperty('--control-h', `${rect.height}px`);
  visual.style.setProperty('--control-min', `${min}px`);
  visual.style.setProperty('--control-max', `${max}px`);
  const len = control.label ? [...control.label].length : 1;
  visual.style.setProperty('--label-len', String(Math.max(1, len)));
}

function setLocalRect(
  element: HTMLElement,
  rect: PixelRect,
  parent: PixelRect,
): void {
  setPixelRect(element, {
    left: rect.left - parent.left,
    top: rect.top - parent.top,
    width: rect.width,
    height: rect.height,
  });
}

function setPixelRect(element: HTMLElement, rect: PixelRect): void {
  element.style.left = `${rect.left}px`;
  element.style.top = `${rect.top}px`;
  element.style.width = `${rect.width}px`;
  element.style.height = `${rect.height}px`;
}

function readViewport(
  element: HTMLElement,
  view: Window | null,
): {
  width: number;
  height: number;
} {
  const rect = element.getBoundingClientRect();
  return {
    width: rect.width || element.clientWidth || view?.innerWidth || 0,
    height: rect.height || element.clientHeight || view?.innerHeight || 0,
  };
}

function readOrientation(
  view: Window | null,
  element: HTMLElement,
): Orientation {
  const viewport = readViewport(element, view);
  return viewport.width < viewport.height ? 'portrait' : 'landscape';
}
