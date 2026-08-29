import { cn } from '@/lib/utils';

export interface ControlOverlayProps {
  selected: boolean;
  hitOnly?: boolean;
  linked?: boolean;
  onToggleLink?: () => void;
  className?: string;
}

export function ControlOverlay({
  selected,
  hitOnly,
  linked,
  onToggleLink,
  className,
}: ControlOverlayProps) {
  if (!selected) return null;
  return (
    <div
      className={cn(
        'editor-control-overlay',
        hitOnly && 'editor-hit-only',
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
      {linked !== undefined && (
        <div className="editor-link-indicator">
          <span className="editor-link-badge">
            {linked ? '⛓️ Linked' : 'Detached'}
          </span>
          {onToggleLink && (
            <button
              type="button"
              className="editor-link-toggle"
              onClick={onToggleLink}
            >
              {linked ? 'Detach' : 'Link'}
            </button>
          )}
        </div>
      )}
      {hitOnly && <span className="editor-hitonly-badge">hitOnly</span>}
    </div>
  );
}
