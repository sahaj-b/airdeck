import { QRCodeSVG } from 'qrcode.react';
import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader } from '../../components/ui/card';
import type { AdminState } from '../../shared/contracts';

interface QRCardProps {
  state: AdminState;
}

export function QRCard({ state }: QRCardProps) {
  const [copyStatus, setCopyStatus] = useState<'idle' | 'success' | 'error'>(
    'idle',
  );
  // The host computes this exact /join?code=... URL; QR, copy, and the
  // displayed code all use that one value.
  const advertisedJoinURL = state.advertisedJoinURL;
  const displayedCode = state.code;

  async function copyURL(): Promise<void> {
    try {
      await navigator.clipboard.writeText(advertisedJoinURL);
      setCopyStatus('success');
    } catch {
      setCopyStatus('error');
    }
  }

  return (
    <Card className="qr-card">
      <CardHeader>
        <div className="eyebrow">Phone join</div>
        <h2>Scan to join</h2>
        <p>
          Use a phone on the same network. The code is a lightweight LAN room
          guard.
        </p>
      </CardHeader>
      <CardContent>
        <div className="qr-layout">
          <div className="qr-frame">
            <QRCodeSVG
              value={advertisedJoinURL}
              size={256}
              marginSize={4}
              level="M"
              bgColor="#ffffff"
              fgColor="#07090d"
              title={`Join Airdeck with ${advertisedJoinURL}`}
            />
          </div>
          <div className="join-details">
            <div className="code-block">
              <span>Session code</span>
              <strong>{displayedCode}</strong>
            </div>
            <div className="url-block">
              <span>Join URL</span>
              <code>{advertisedJoinURL}</code>
            </div>
            <div className="qr-actions">
              <Button type="button" onClick={() => void copyURL()}>
                Copy URL
              </Button>
            </div>
            <p className="action-status" role="status" aria-live="polite">
              {copyStatus === 'success' && 'URL copied.'}
              {copyStatus === 'error' &&
                'Copy failed. Select the URL manually.'}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
