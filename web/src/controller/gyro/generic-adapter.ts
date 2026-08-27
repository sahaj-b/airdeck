import type { GyroAdapter, GyroAdapterOptions } from './adapter';

type OrientationCtor = new (opts: {
  frequency: number;
  referenceFrame: string;
}) => {
  start(): void;
  stop(): void;
  addEventListener(type: string, cb: EventListener): void;
  removeEventListener(type: string, cb: EventListener): void;
  quaternion?: number[];
};

function getCtor<T>(name: string): T | undefined {
  try {
    const w = window as unknown as Record<string, unknown>;
    return w[name] as T | undefined;
  } catch {
    return undefined;
  }
}

export class GenericSensorAdapter implements GyroAdapter {
  private orientation: InstanceType<OrientationCtor> | undefined;

  constructor(private readonly options: GyroAdapterOptions) {}

  async start(): Promise<void> {
    const RelativeOrientationSensor = getCtor<OrientationCtor>(
      'RelativeOrientationSensor',
    );
    if (!RelativeOrientationSensor) {
      throw new Error('Generic Sensor API unavailable');
    }

    const sensor = new RelativeOrientationSensor({
      frequency: 60,
      referenceFrame: 'device',
    });

    const onReading = () => {
      const q = sensor.quaternion;
      if (q) this.emitFromQuat(q);
    };
    const onError = (ev: Event) => {
      const err =
        (ev as unknown as { error?: Error }).error ??
        new Error('orientation sensor error');
      this.options.onError(err);
    };
    sensor.addEventListener('reading', onReading as EventListener);
    sensor.addEventListener('error', onError as EventListener);
    sensor.start();
    this.orientation = sensor;
  }

  stop(): void {
    try {
      this.orientation?.stop();
    } catch {}
    this.orientation = undefined;
  }

  private emitFromQuat(quat: number[]): void {
    const [x, y, z, w] = quat;
    if (
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      !Number.isFinite(z) ||
      !Number.isFinite(w)
    )
      return;
    const sinr_cosp = 2 * (w * x + y * z);
    const cosr_cosp = 1 - 2 * (x * x + y * y);
    const roll = Math.atan2(sinr_cosp, cosr_cosp) * (180 / Math.PI);
    const sinp = 2 * (w * y - z * x);
    const pitch =
      Math.abs(sinp) >= 1
        ? Math.sign(sinp) * 90
        : Math.asin(sinp) * (180 / Math.PI);
    this.options.onReading({
      beta: pitch,
      gamma: roll,
      quat: [...quat],
      timestamp: Date.now(),
    });
  }
}
