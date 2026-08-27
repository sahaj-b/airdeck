import { QRCodeSVG } from 'qrcode.react';
import { useState } from 'react';
import { Button } from '../../components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '../../components/ui/card';
import type { AdminState } from '../../shared/contracts';

interface QRCardProps {
  state: AdminState;
}

export function QRCard({ state }: QRCardProps) {
  const [copyStatus, setCopyStatus] = useState<'idle' | 'success' | 'error'>(
    'idle',
  );
  const advertisedJoinURL = state.advertisedJoinURL;
  const displayedCode = state.code;

  async function copyURL(): Promise<void> {
    try {
      await navigator.clipboard.writeText(advertisedJoinURL);
      setCopyStatus('success');
      setTimeout(() => setCopyStatus('idle'), 2000);
    } catch {
      setCopyStatus('error');
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Scan to join</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid items-center gap-6 md:grid-cols-[256px_1fr]">
          <div className="grid aspect-square w-full max-w-[256px] place-items-center rounded-xl border bg-white p-2 mx-auto md:mx-0">
            <QRCodeSVG
              value={advertisedJoinURL}
              size={240}
              marginSize={1}
              level="M"
              bgColor="#ffffff"
              fgColor="#07090d"
              title={`Join Airdeck with ${advertisedJoinURL}`}
              className="h-auto w-full"
            />
          </div>

          <div className="min-w-0 space-y-5">
            <div>
              <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Session code
              </div>
              <div className="font-mono text-4xl font-bold tracking-[0.12em] text-foreground sm:text-5xl">
                {displayedCode}
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Join URL
              </div>
              <code className="block rounded-md bg-muted px-3 py-2 text-xs break-all text-muted-foreground">
                {advertisedJoinURL}
              </code>
            </div>

            <div className="flex items-center gap-3">
              <Button type="button" onClick={() => void copyURL()}>
                Copy URL
              </Button>
              <span
                className="min-h-5 text-xs font-medium text-emerald-600 dark:text-emerald-400"
                role="status"
                aria-live="polite"
              >
                {copyStatus === 'success' && 'URL copied.'}
                {copyStatus === 'error' &&
                  'Copy failed. Select the URL manually.'}
              </span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
