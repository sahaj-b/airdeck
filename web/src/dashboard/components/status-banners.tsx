import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import type { AdminState } from '../../shared/contracts';

interface StatusBannersProps {
  state: AdminState;
  onGenerateCode: () => Promise<void>;
  onSetCustomCode: (code: string) => Promise<void>;
}

export function StatusBanners({
  state,
  onGenerateCode,
  onSetCustomCode,
}: StatusBannersProps) {
  const [customCode, setCustomCode] = useState('');
  const [busy, setBusy] = useState<'generate' | 'custom' | null>(null);
  const [customError, setCustomError] = useState<string | null>(null);

  const conflict = state.claimConflict ?? '';
  const offline = !state.centralReachable && conflict === '';

  function runGenerate(): void {
    setBusy('generate');
    void onGenerateCode()
      .catch(() => undefined)
      .finally(() => setBusy(null));
  }

  function runCustom(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const code = customCode.trim();
    if (!code) {
      setCustomError('Enter a code (4-24 letters and digits).');
      return;
    }
    setCustomError(null);
    setBusy('custom');
    void onSetCustomCode(code)
      .then(() => setCustomCode(''))
      .catch((error: unknown) => {
        setCustomError(
          error instanceof Error ? error.message : 'That code was rejected.',
        );
      })
      .finally(() => setBusy(null));
  }

  if (conflict !== '') {
    return (
      <div
        className="mb-6 space-y-3 rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm"
        role="alert"
      >
        <div>
          <div className="font-semibold text-destructive">
            Room code claimed elsewhere
          </div>
          <p className="mt-1 leading-relaxed text-destructive/90">
            {conflict} Local play keeps serving {state.code}. Remote joins stay
            dark until you pick a fresh code.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            disabled={busy !== null}
            onClick={runGenerate}
          >
            {busy === 'generate' ? 'Generating…' : 'Generate new code'}
          </Button>
          <form
            onSubmit={runCustom}
            className="flex flex-wrap items-center gap-2"
          >
            <Input
              value={customCode}
              onChange={(event) => {
                setCustomCode(event.target.value);
                setCustomError(null);
              }}
              placeholder="Custom code"
              autoComplete="off"
              spellCheck={false}
              maxLength={24}
              className="h-8 w-44 bg-background font-mono uppercase"
              aria-label="Custom room code"
            />
            <Button
              type="submit"
              size="sm"
              variant="outline"
              disabled={busy !== null}
            >
              {busy === 'custom' ? 'Saving…' : 'Use custom code'}
            </Button>
          </form>
        </div>
        {customError && (
          <p className="text-xs leading-relaxed text-destructive" role="alert">
            {customError}
          </p>
        )}
      </div>
    );
  }

  if (offline) {
    const lanOnly = state.config.lanOnly;
    return (
      <div
        className="mb-6 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-200"
        role="status"
      >
        <span className="font-semibold">
          {lanOnly ? 'LAN-only mode.' : 'Central is unreachable.'}
        </span>{' '}
        The QR shows the LAN URL with the same code. Phones on your WiFi can
        still join.
      </div>
    );
  }

  return null;
}
