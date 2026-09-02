import { useEffect, useState } from 'react';
import type { RenderedLayout } from '@/controller/layout-renderer';

function getHostViewport(renderer?: RenderedLayout): {
  width: number;
  height: number;
} {
  if (renderer?.root) {
    const comp = renderer.root.querySelector(
      '.controller-composition',
    ) as HTMLElement | null;
    if (comp) {
      const r = comp.getBoundingClientRect();
      if (r.width > 2 && r.height > 2)
        return { width: r.width, height: r.height };
    }
    const hostEl = document.querySelector(
      '.controller-host',
    ) as HTMLElement | null;
    if (hostEl) {
      const r = hostEl.getBoundingClientRect();
      const cs = getComputedStyle(hostEl);
      const padL = parseFloat(cs.paddingLeft) || 0;
      const padR = parseFloat(cs.paddingRight) || 0;
      const padT = parseFloat(cs.paddingTop) || 0;
      const padB = parseFloat(cs.paddingBottom) || 0;
      return {
        width: Math.max(1, r.width - padL - padR),
        height: Math.max(1, r.height - padT - padB),
      };
    }
  }
  return { width: window.innerWidth, height: window.innerHeight };
}

function getHostOrigin(renderer?: RenderedLayout): { x: number; y: number } {
  if (renderer?.root) {
    const comp = renderer.root.querySelector(
      '.controller-composition',
    ) as HTMLElement | null;
    if (comp) {
      const r = comp.getBoundingClientRect();
      return { x: r.left, y: r.top };
    }
  }
  const hostEl = document.querySelector(
    '.controller-host',
  ) as HTMLElement | null;
  if (hostEl) {
    const r = hostEl.getBoundingClientRect();
    const cs = getComputedStyle(hostEl);
    return {
      x: r.left + (parseFloat(cs.paddingLeft) || 0),
      y: r.top + (parseFloat(cs.paddingTop) || 0),
    };
  }
  return { x: 0, y: 0 };
}

export function usePhoneViewport(renderer?: RenderedLayout) {
  const [viewport, setViewport] = useState(() => getHostViewport(renderer));
  const [hostOrigin, setHostOrigin] = useState(() => getHostOrigin(renderer));

  useEffect(() => {
    const compute = () => {
      let w = window.innerWidth;
      let h = window.innerHeight;
      if (renderer?.root) {
        const comp = renderer.root.querySelector(
          '.controller-composition',
        ) as HTMLElement | null;
        if (comp) {
          const r = comp.getBoundingClientRect();
          if (r.width > 2 && r.height > 2) {
            w = r.width;
            h = r.height;
          }
        } else {
          const hostEl = document.querySelector(
            '.controller-host',
          ) as HTMLElement | null;
          if (hostEl) {
            const r = hostEl.getBoundingClientRect();
            const cs = getComputedStyle(hostEl);
            const padL = parseFloat(cs.paddingLeft) || 0;
            const padR = parseFloat(cs.paddingRight) || 0;
            const padT = parseFloat(cs.paddingTop) || 0;
            const padB = parseFloat(cs.paddingBottom) || 0;
            w = Math.max(1, r.width - padL - padR);
            h = Math.max(1, r.height - padT - padB);
          }
        }
      }
      setViewport({ width: w, height: h });
    };
    compute();
    window.addEventListener('resize', compute);
    window.addEventListener('orientationchange', compute);
    const ro =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(compute)
        : null;
    const hostEl = document.querySelector('.controller-host');
    if (hostEl && ro) ro.observe(hostEl);
    const compEl = renderer?.root?.querySelector('.controller-composition');
    if (compEl && ro) ro.observe(compEl);
    return () => {
      window.removeEventListener('resize', compute);
      window.removeEventListener('orientationchange', compute);
      ro?.disconnect();
    };
  }, [renderer]);

  useEffect(() => {
    const computeOrigin = () => setHostOrigin(getHostOrigin(renderer));
    computeOrigin();
    window.addEventListener('resize', computeOrigin);
    window.addEventListener('orientationchange', computeOrigin);
    return () => {
      window.removeEventListener('resize', computeOrigin);
      window.removeEventListener('orientationchange', computeOrigin);
    };
  }, [renderer, viewport]);

  return { viewport, hostOrigin };
}
