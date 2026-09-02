import { ChevronLeftIcon, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { MountOptions } from './settings-island';

interface ManageLayoutsSheetProps {
  opts: MountOptions;
  onBack: () => void;
}

export function ManageLayoutsSheet({ opts, onBack }: ManageLayoutsSheetProps) {
  const personalLayouts = opts.personalLayouts ?? [];
  const selectedId = opts.selectedLayout;
  const publishState = opts.publishState ?? null;
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onBack}
          aria-label="Back to settings"
        >
          <ChevronLeftIcon className="size-4" />
        </Button>
        <h3 className="text-sm font-semibold">Manage my layouts</h3>
        {personalLayouts.length > 0 && (
          <span className="ml-auto text-xs text-muted-foreground tabular-nums">
            {personalLayouts.length} saved
          </span>
        )}
      </div>

      {publishState && (
        <div className="rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs">
          <p className="font-medium leading-relaxed">
            Publishing &apos;{publishState.name}&apos; — waiting for host
            approval... {publishState.remaining}s
          </p>
          <div className="mt-2 flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => opts.onCancelPublish?.()}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {personalLayouts.length === 0 ? (
        <div className="rounded-lg border border-dashed border-white/10 bg-white/[0.03] px-4 py-8 text-center">
          <p className="text-sm font-medium">No personal edits yet</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Tap{' '}
            <span className="inline-flex relative items-center gap-1 mt-1 top-0.5  font-medium text-foreground">
              <Pencil className="size-3" /> Edit current layout
            </span>{' '}
            to create a personalized copy.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {personalLayouts.map((pl) => {
            const isSelected = pl.id === selectedId;
            const isRenaming = renameId === pl.id;
            return (
              <div
                key={pl.id}
                className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-2 ${isSelected ? 'border-violet-500/25 bg-violet-500/10' : 'border-white/10 bg-white/5'}`}
              >
                {isRenaming ? (
                  <div className="flex min-w-0 flex-1 items-center gap-1">
                    <Input
                      className="h-7 flex-1 text-xs"
                      autoFocus
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          opts.onRenamePersonal?.(pl.id, renameValue);
                          setRenameId(null);
                        }
                        if (e.key === 'Escape') setRenameId(null);
                      }}
                      placeholder="Layout name"
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-xs shrink-0"
                      onClick={() => {
                        opts.onRenamePersonal?.(pl.id, renameValue);
                        setRenameId(null);
                      }}
                    >
                      Ok
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs shrink-0"
                      onClick={() => setRenameId(null)}
                    >
                      ✕
                    </Button>
                  </div>
                ) : (
                  <>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium leading-none">
                        {pl.name}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        onClick={() => opts.onEditPersonal?.(pl.id)}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        onClick={() => {
                          setRenameId(pl.id);
                          setRenameValue(pl.name);
                        }}
                      >
                        Rename
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        onClick={() => opts.onPublishPersonal?.(pl.id)}
                        disabled={!!publishState}
                      >
                        Publish
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="size-7 shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
                        aria-label={`Delete ${pl.name}`}
                        onClick={() => opts.onDeletePersonal?.(pl.id)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      <p className="pt-1 text-xs leading-relaxed text-muted-foreground">
        Personal edits are stored locally on this device. Publish sends a copy
        to the host for approval.
      </p>
    </div>
  );
}
