import { afterEach, describe, expect, it, vi } from 'vitest';
import { type DiagnosticsSummary, getDiagnostics } from './api';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getDiagnostics', () => {
  it('unwraps the summary from the diagnostics response', async () => {
    const summary: DiagnosticsSummary = {
      acceptedFrames: 1,
      rejectedFrames: 0,
      staleFrames: 0,
      watchdogCount: 0,
      p50: 1,
      p95: 2,
      p99: 3,
      max: 4,
      watchdogP50: 5,
      watchdogP95: 6,
      watchdogMax: 7,
      resources: [],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ summary, trace: [] }),
      }),
    );
    const result = await getDiagnostics();
    expect(result).toBe(summary);
  });

  it('rejects when the diagnostics endpoint fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        json: async () => ({ error: 'admin access is local to the host' }),
      }),
    );
    await expect(getDiagnostics()).rejects.toThrow(
      'admin access is local to the host',
    );
  });
});
