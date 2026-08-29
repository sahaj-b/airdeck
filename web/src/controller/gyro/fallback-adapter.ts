import type { GyroAdapter, GyroAdapterOptions, GyroReading } from './adapter';

export class FallbackAdapter implements GyroAdapter {
  private handler: ((event: DeviceOrientationEvent) => void) | undefined;
  private lastEmit = 0;

  constructor(private readonly options: GyroAdapterOptions) {}

  async start(): Promise<void> {
    const onOrientation = (event: DeviceOrientationEvent) => {
      const now = Date.now();
      if (now - this.lastEmit < 16) return;
      this.lastEmit = now;
      const beta = event.beta;
      const gamma = event.gamma;
      if (beta == null || gamma == null) return;
      const reading: GyroReading = {
        beta,
        gamma,
        quat: undefined,
        timestamp: now,
      };
      this.options.onReading(reading);
    };

    this.handler = onOrientation;
    window.addEventListener('deviceorientation', onOrientation, true);
  }

  stop(): void {
    if (this.handler)
      window.removeEventListener('deviceorientation', this.handler, true);
    this.handler = undefined;
  }
}
