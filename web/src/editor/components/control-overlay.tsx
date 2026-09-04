import { cn } from '@/lib/utils';

export interface ControlOverlayProps {
  selected: boolean;
  isHitzone?: boolean;
  className?: string;
}

export function ControlOverlay({
  selected,
  isHitzone,
  className,
}: ControlOverlayProps) {
  if (!selected) return null;
  return (
    <div
      className={cn(
        'editor-control-overlay',
        isHitzone && 'editor-hit-only',
        className,
      )}
    >
      <div className="editor-selection-frame" />
      <div className="editor-handles">
        <span className="editor-handle editor-handle-tl" />
        <span className="editor-handle editor-handle-tr" />
        <span className="editor-handle editor-handle-bl" />
        <span className="editor-handle editor-handle-br" />
      </div>
    </div>
  );
}
