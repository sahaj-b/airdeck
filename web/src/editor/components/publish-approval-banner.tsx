import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { type AdminStore, useAdminSnapshot } from '../../dashboard/admin-store';

export interface PublishApprovalBannerProps {
  store: AdminStore;
}

export function PublishApprovalBanner({ store }: PublishApprovalBannerProps) {
  const snapshot = useAdminSnapshot(store);
  const pendings = snapshot.pendingPublishes;
  const [busy, setBusy] = useState<string | null>(null);

  if (pendings.length === 0) return null;

  return (
    <div className="space-y-2">
      {pendings.map((pending) => (
        <Card key={pending.id} size="sm">
          <CardContent className="flex items-center gap-3 py-2">
            <span className="flex-1 text-sm">
              <strong>{pending.phoneName}</strong> wants to publish{' '}
              <em>
                {(pending.document as { name?: string }).name ?? 'a layout'}
              </em>
            </span>
            <Button
              type="button"
              size="sm"
              disabled={busy === pending.id}
              onClick={async () => {
                setBusy(pending.id);
                try {
                  await store.acceptPublishRequest(pending.id);
                } catch {
                  // error handled by store
                } finally {
                  setBusy(null);
                }
              }}
            >
              Accept
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy === pending.id}
              onClick={async () => {
                setBusy(pending.id);
                try {
                  await store.declinePublishRequest(pending.id);
                } catch {
                  // error handled by store
                } finally {
                  setBusy(null);
                }
              }}
            >
              Decline
            </Button>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
