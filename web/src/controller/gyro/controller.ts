import type { StoreApi } from 'zustand';
import type { SettingsStore } from '../../join/settings-store';
import type { InputStateStore } from '../state';
import type { GyroAdapter, GyroReading } from './adapter';
import { FallbackAdapter } from './fallback-adapter';
import { GenericSensorAdapter } from './generic-adapter';
import { tiltDeltaToStick } from './math';

export type GyroStatus =
  | 'idle'
  | 'active'
  | 'needs-https'
  | 'needs-landscape'
  | 'permission-denied'
  | 'unsupported'
  | 'error';

export interface GyroControllerOptions {
  getIsLandscape: () => boolean;
  onVisualUpdate?: (target: string, x: number, y: number) => void;
  onStatusChange?: (status: GyroStatus, message?: string) => void;
}

export class GyroController {
  private adapter: GyroAdapter | undefined;
  private latest: GyroReading | undefined;
  private status: GyroStatus = 'idle';
  private unsubscribe: (() => void) | undefined;
  private currentSource: string | undefined;

  constructor(
    private readonly state: InputStateStore,
    private readonly store: StoreApi<SettingsStore>,
    private readonly opts: GyroControllerOptions,
  ) {
    this.unsubscribe = this.store.subscribe(
      (s: SettingsStore, prev: SettingsStore) => {
        if (s.gyroEnabled !== prev.gyroEnabled) {
          if (s.gyroEnabled) void this.startAdapter();
          else this.stopAdapter();
        }
        if (s.gyroTarget !== prev.gyroTarget && this.currentSource) {
          this.state.clearSource(`gyro:${prev.gyroTarget}`);
        }
      },
    );

    if (this.store.getState().gyroEnabled) void this.startAdapter();

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.onVisibility);
      window.addEventListener('pagehide', this.onHidden);
    }
  }

  destroy(): void {
    this.unsubscribe?.();
    this.stopAdapter();
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.onVisibility);
      window.removeEventListener('pagehide', this.onHidden);
    }
  }

  async requestPermission(): Promise<boolean> {
    try {
      const DOE = DeviceOrientationEvent as unknown as {
        requestPermission?: () => Promise<string>;
      };
      const DME = DeviceMotionEvent as unknown as {
        requestPermission?: () => Promise<string>;
      };
      let needPermission = false;
      let granted = true;
      if (typeof DOE.requestPermission === 'function') {
        needPermission = true;
        if ((await DOE.requestPermission()) !== 'granted') granted = false;
      }
      if (typeof DME.requestPermission === 'function') {
        needPermission = true;
        if ((await DME.requestPermission()) !== 'granted') granted = false;
      }
      if (!needPermission) return true;
      if (!granted) this.setStatus('permission-denied');
      return granted;
    } catch (e) {
      const err = e as DOMException;
      if (err?.name === 'NotAllowedError') this.setStatus('permission-denied');
      return false;
    }
  }

  calibrate(): void {
    if (!this.latest) return;
    const { beta, gamma } = this.latest;
    this.store.getState().setGyroCalib(beta, gamma);
  }

  handleVisibilityHidden(): void {
    this.onHidden();
  }

  private readonly onVisibility = (): void => {
    if (document.visibilityState === 'hidden') this.onHidden();
  };

  private readonly onHidden = (): void => {
    const target = this.store.getState().gyroTarget;
    this.state.clearSource(`gyro:${target}`);
    const other = target === 'leftStick' ? 'rightStick' : 'leftStick';
    this.state.clearSource(`gyro:${other}`);
  };

  private setStatus(status: GyroStatus, message?: string): void {
    this.status = status;
    this.opts.onStatusChange?.(status, message);
  }

  private async startAdapter(): Promise<void> {
    if (!window.isSecureContext) {
      this.setStatus('needs-https', 'Gyro needs HTTPS');
      return;
    }

    this.stopAdapter();

    const onReading = (reading: GyroReading) => {
      this.latest = reading;
      const st = this.store.getState();
      if (st.gyroCalibBeta == null || st.gyroCalibGamma == null) {
        st.setGyroCalib(reading.beta, reading.gamma);
      }
      this.handleReading(reading);
    };

    const onError = (err: Error) => {
      if (this.adapter instanceof GenericSensorAdapter) {
        this.adapter.stop();
        this.adapter = new FallbackAdapter({
          onReading,
          onError: (e) => this.setStatus('error', e.message),
        });
        void this.adapter
          .start()
          .catch((e: Error) => this.setStatus('error', e.message));
      } else {
        this.setStatus('error', err.message);
      }
    };

    const generic = new GenericSensorAdapter({ onReading, onError });
    try {
      await generic.start();
      this.adapter = generic;
      this.setStatus('active');
    } catch {
      const fallback = new FallbackAdapter({
        onReading,
        onError: (e) => this.setStatus('error', e.message),
      });
      try {
        await fallback.start();
        this.adapter = fallback;
        this.setStatus('active');
      } catch (e) {
        this.setStatus('unsupported', (e as Error).message);
      }
    }
  }

  private stopAdapter(): void {
    const st = this.store.getState();
    const src = this.currentSource ?? `gyro:${st.gyroTarget}`;
    this.state.clearSource(src);
    const other = st.gyroTarget === 'leftStick' ? 'rightStick' : 'leftStick';
    this.state.clearSource(`gyro:${other}`);
    this.currentSource = undefined;
    try {
      this.adapter?.stop();
    } catch {}
    this.adapter = undefined;
    if (!this.store.getState().gyroEnabled) this.setStatus('idle');
  }

  private handleReading(reading: GyroReading): void {
    const s = this.store.getState();
    if (!s.gyroEnabled) return;

    const target = s.gyroTarget;
    const source = `gyro:${target}`;
    this.currentSource = source;

    if (!this.opts.getIsLandscape()) {
      this.setStatus('needs-landscape', 'Rotate to landscape');
      this.state.setStick(source, target, 0, 0);
      this.opts.onVisualUpdate?.(target, 0, 0);
      return;
    }
    if (this.status === 'needs-landscape') this.setStatus('active');

    const calibBeta = s.gyroCalibBeta ?? reading.beta;
    const calibGamma = s.gyroCalibGamma ?? reading.gamma;
    const deltaGamma = reading.gamma - calibGamma;
    const deltaBeta = reading.beta - calibBeta;

    const x = tiltDeltaToStick(deltaGamma, s.deadzoneX, s.maxAngleX, s.invertX);
    const y =
      s.gyroMode === 'steer'
        ? 0
        : tiltDeltaToStick(deltaBeta, s.deadzoneY, s.maxAngleY, s.invertY);

    this.state.setStick(source, target, x, y);
    this.opts.onVisualUpdate?.(target, x, y);
  }
}
