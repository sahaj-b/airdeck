import { X } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useEffect, useRef, useState } from 'react';
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
  const [zoomed, setZoomed] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);
  const advertisedJoinURL = state.advertisedJoinURL;
  const displayedCode = state.code;

  // take the overlay to real fullscreen when it opens; the click that opened
  // it is still a valid user gesture, so this counts.
  useEffect(() => {
    if (!zoomed) return;
    const el = overlayRef.current;
    if (el?.requestFullscreen) {
      void el.requestFullscreen().catch(() => undefined);
    }
  }, [zoomed]);

  // close on Esc (and when the browser leaves fullscreen on its own)
  useEffect(() => {
    if (!zoomed) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setZoomed(false);
    };
    const onFullscreenChange = (): void => {
      if (!document.fullscreenElement) setZoomed(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('fullscreenchange', onFullscreenChange);
    };
  }, [zoomed]);

  function closeZoom(): void {
    setZoomed(false);
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
    }
  }

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
          <button
            type="button"
            onClick={() => setZoomed(true)}
            aria-label="Show the join QR code fullscreen"
            aria-expanded={zoomed}
            className="mx-auto grid aspect-square w-full max-w-[256px] place-items-center rounded-xl border bg-white p-2 transition focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none hover:ring-2 hover:ring-ring/60 md:mx-0"
          >
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
          </button>

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

      {zoomed && (
        <>
          {/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop dismiss is mouse-only by design */}
          <div
            ref={overlayRef}
            role="dialog"
            aria-modal="true"
            aria-label="Join QR code"
            onClick={closeZoom}
            className="fixed inset-0 z-50 grid place-items-center bg-black/85 p-6 backdrop-blur-sm"
          >
            <button
              type="button"
              onClick={closeZoom}
              aria-label="Close QR code"
              className="absolute top-4 right-4 grid size-10 place-items-center rounded-full bg-white/10 text-white transition hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none"
            >
              <X className="size-5" />
            </button>
            <div className="w-full max-w-[min(92vw,44rem)]">
              <div className="grid aspect-square w-full place-items-center rounded-2xl bg-white p-4">
                <QRCodeSVG
                  value={advertisedJoinURL}
                  size={512}
                  marginSize={2}
                  level="M"
                  bgColor="#ffffff"
                  fgColor="#07090d"
                  title={`Join Airdeck with ${advertisedJoinURL}`}
                  className="h-auto w-full"
                />
              </div>
              <p className="mt-6 text-center font-mono text-5xl font-bold tracking-[0.12em] text-white sm:text-6xl">
                {displayedCode}
              </p>
              <p className="mt-3 text-center text-base break-all text-white/70">
                {advertisedJoinURL}
              </p>
              <p className="mt-6 text-center text-xs text-white/50">
                Click anywhere to close
              </p>
            </div>
          </div>
        </>
      )}
    </Card>
  );
}
