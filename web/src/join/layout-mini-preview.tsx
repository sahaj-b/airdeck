import { useMemo } from 'react';
import { resolveLayout } from '../controller/layout-resolver';
import type { ControlType, LayoutDocument } from '../shared/layout';

const PREVIEW_VIEWPORT = { width: 320, height: 140 };

const DPAD_CLIP =
  'polygon(30% 0%, 70% 0%, 70% 30%, 100% 30%, 100% 70%, 70% 70%, 70% 100%, 30% 100%, 30% 70%, 0% 70%, 0% 30%, 30% 30%)';

interface PreviewBox {
  id: string;
  left: number;
  top: number;
  width: number;
  height: number;
  round: boolean;
  kind: ControlType;
}

function previewBoxClass(kind: ControlType): string {
  if (kind === 'label')
    return 'absolute border border-dashed border-[#4d5560] bg-transparent';
  if (kind === 'joystick')
    return 'absolute border border-[#5b6470] bg-[#343b44]';
  return 'absolute border border-[#4d5560] bg-[#2e343c]';
}

export function LayoutMiniPreview({ doc }: { doc: LayoutDocument }) {
  const boxes = useMemo(() => {
    const resolved = resolveLayout(doc, PREVIEW_VIEWPORT, 'landscape');
    const boxes: PreviewBox[] = [];
    for (const section of resolved.sections) {
      for (const c of section.controls) {
        if (c.control.type === 'hitzone') continue;
        const v = c.visual;
        boxes.push({
          id: c.control.id,
          left: (v.left / PREVIEW_VIEWPORT.width) * 100,
          top: (v.top / PREVIEW_VIEWPORT.height) * 100,
          width: Math.max(1.5, (v.width / PREVIEW_VIEWPORT.width) * 100),
          height: Math.max(4, (v.height / PREVIEW_VIEWPORT.height) * 100),
          round: c.control.shape === 'round',
          kind: c.control.type,
        });
      }
    }
    return boxes;
  }, [doc]);

  return (
    <span
      aria-hidden="true"
      className="relative block w-full overflow-hidden rounded-md border border-white/10 bg-black/40"
      style={{ aspectRatio: '320 / 140' }}
    >
      {boxes.map((b) => {
        const style = {
          left: `${b.left}%`,
          top: `${b.top}%`,
          width: `${b.width}%`,
          height: `${b.height}%`,
        };
        if (b.kind === 'dpad') {
          return (
            <span
              key={b.id}
              className="absolute bg-[#343b44]"
              style={{ ...style, clipPath: DPAD_CLIP }}
            />
          );
        }
        return (
          <span
            key={b.id}
            className={previewBoxClass(b.kind)}
            style={{
              ...style,
              borderRadius: b.round ? '9999px' : '2px',
            }}
          >
            {b.kind === 'joystick' && (
              <span className="absolute top-1/2 left-1/2 size-[28%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#7d8794]" />
            )}
          </span>
        );
      })}
    </span>
  );
}

export function LayoutMiniSkeleton() {
  return (
    <span
      aria-hidden="true"
      className="block w-full animate-pulse rounded-md border border-white/10 bg-white/[0.05]"
      style={{ aspectRatio: '320 / 140' }}
    />
  );
}
