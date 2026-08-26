import { Card, CardContent, CardHeader } from '../../components/ui/card';
import type { DiagnosticsSummary } from '../api';

interface DiagnosticsProps {
  diagnostics: DiagnosticsSummary | null;
}

export function Diagnostics({ diagnostics }: DiagnosticsProps) {
  return (
    <Card>
      <CardHeader>
        <div className="eyebrow">Local measurements</div>
        <h2>Diagnostics</h2>
        <p>
          Input timing is measured at the host. It is not a fixed end-to-end
          latency promise.
        </p>
      </CardHeader>
      <CardContent>
        {!diagnostics ? (
          <p className="muted">Diagnostics are unavailable.</p>
        ) : (
          <>
            <div className="metric-grid">
              <Metric
                label="Accepted frames"
                value={String(diagnostics.acceptedFrames)}
              />
              <Metric
                label="Rejected frames"
                value={String(diagnostics.rejectedFrames)}
              />
              <Metric
                label="Stale frames"
                value={String(diagnostics.staleFrames)}
              />
              <Metric
                label="Watchdogs"
                value={String(diagnostics.watchdogCount)}
              />
              <Metric
                label="p50 apply"
                value={formatDuration(diagnostics.p50)}
              />
              <Metric
                label="p95 apply"
                value={formatDuration(diagnostics.p95)}
              />
              <Metric
                label="p99 apply"
                value={formatDuration(diagnostics.p99)}
              />
              <Metric
                label="Maximum apply"
                value={formatDuration(diagnostics.max)}
              />
              <Metric
                label="Watchdog p95"
                value={formatDuration(diagnostics.watchdogP95)}
              />
              <Metric
                label="Watchdog max"
                value={formatDuration(diagnostics.watchdogMax)}
              />
            </div>
            <div className="resource-list">
              <h3>Resource samples</h3>
              {diagnostics.resources.length === 0 ? (
                <p className="muted">No resource samples yet.</p>
              ) : (
                <ul>
                  {diagnostics.resources
                    .slice(-5)
                    .reverse()
                    .map((sample) => (
                      <li key={sample.at}>
                        <span>{new Date(sample.at).toLocaleTimeString()}</span>
                        <span>{sample.players} players</span>
                        <span>{sample.goroutines} goroutines</span>
                        <span>{formatBytes(sample.memoryBytes)}</span>
                        <span>{sample.fileDescriptors} fds</span>
                      </li>
                    ))}
                </ul>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function formatDuration(nanos: number): string {
  if (!Number.isFinite(nanos) || nanos <= 0) return '0 ms';
  const milliseconds = nanos / 1_000_000;
  if (milliseconds < 1) return `${(milliseconds * 1000).toFixed(1)} µs`;
  return `${milliseconds < 10 ? milliseconds.toFixed(2) : milliseconds.toFixed(1)} ms`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}
