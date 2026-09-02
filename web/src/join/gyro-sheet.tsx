import { ChevronLeftIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { Button } from '@/components/ui/button';
import { DualRange } from '@/components/ui/dual-range';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import type { GyroController, GyroStatus } from '@/controller/gyro/controller';
import type { settingsStore } from './settings-store';

type Store = typeof settingsStore;

interface GyroSheetProps {
  store: Store;
  gyro: GyroController | undefined;
  gyroStatus: GyroStatus;
  liveX: number;
  liveY: number;
  onBack: () => void;
}

export function GyroSheet({
  store,
  gyro,
  gyroStatus,
  liveX,
  liveY,
  onBack,
}: GyroSheetProps) {
  const gyroEnabled = useStore(store, (s) => s.gyroEnabled);
  const gyroTarget = useStore(store, (s) => s.gyroTarget);
  const gyroMode = useStore(store, (s) => s.gyroMode);
  const deadzoneX = useStore(store, (s) => s.deadzoneX);
  const maxAngleX = useStore(store, (s) => s.maxAngleX);
  const invertX = useStore(store, (s) => s.invertX);
  const deadzoneY = useStore(store, (s) => s.deadzoneY);
  const maxAngleY = useStore(store, (s) => s.maxAngleY);
  const invertY = useStore(store, (s) => s.invertY);

  const setGyroEnabled = useStore(store, (s) => s.setGyroEnabled);
  const setGyroTarget = useStore(store, (s) => s.setGyroTarget);
  const setGyroMode = useStore(store, (s) => s.setGyroMode);
  const setDeadzoneX = useStore(store, (s) => s.setDeadzoneX);
  const setDeadzoneY = useStore(store, (s) => s.setDeadzoneY);
  const setMaxAngleX = useStore(store, (s) => s.setMaxAngleX);
  const setMaxAngleY = useStore(store, (s) => s.setMaxAngleY);
  const setInvertX = useStore(store, (s) => s.setInvertX);
  const setInvertY = useStore(store, (s) => s.setInvertY);

  const [calibratedFlash, setCalibratedFlash] = useState(false);
  const calibTimer = useRef<number | undefined>(undefined);

  useEffect(
    () => () => {
      if (calibTimer.current) window.clearTimeout(calibTimer.current);
    },
    [],
  );

  const handleCalibrate = () => {
    gyro?.calibrate();
    setCalibratedFlash(true);
    if (calibTimer.current) window.clearTimeout(calibTimer.current);
    calibTimer.current = window.setTimeout(
      () => setCalibratedFlash(false),
      1200,
    );
  };

  const handleEnableToggle = async (next: boolean) => {
    if (next) {
      // permission request must be in same gesture tick — call synchronously
      if (gyro) {
        const ok = await gyro.requestPermission();
        if (!ok) return;
      }
      if (!isSecureContext) return;
    }
    setGyroEnabled(next);
  };

  const secureHint = !isSecureContext;
  const landscapeHint = gyroStatus === 'needs-landscape';
  const permissionDenied = gyroStatus === 'permission-denied';
  const unsupported = gyroStatus === 'unsupported';
  const disabled = !gyroEnabled;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onBack}
          aria-label="Back to settings"
        >
          <ChevronLeftIcon className="size-4" />
        </Button>
        <h3 className="text-sm font-semibold">Gyroscope</h3>
      </div>

      {secureHint && (
        <p className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2.5 text-xs font-medium text-amber-300">
          Gyro needs HTTPS — tilt controls require a secure connection
        </p>
      )}
      {permissionDenied && (
        <p className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2.5 text-xs font-medium text-destructive">
          Permission denied, enable in Settings &gt; Safari &gt; Motion &amp;
          Orientation Access
        </p>
      )}
      {unsupported && (
        <p className="rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-xs font-medium text-muted-foreground">
          Gyroscope not supported on this device, using touch only.
        </p>
      )}
      {landscapeHint && (
        <p className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2.5 text-xs font-medium text-amber-300">
          Rotate to landscape, portrait forces neutral
        </p>
      )}

      <div
        className={`flex items-center justify-between gap-3 rounded-xl border p-3 shadow-sm transition-colors ${gyroEnabled ? 'border-primary/20 bg-primary/10' : 'border-white/25 bg-card hover:border-white/40'}`}
      >
        <div className="flex flex-col gap-0.5">
          <Label
            htmlFor="gyro-enabled"
            className="text-sm font-semibold leading-none"
          >
            Enable gyro
          </Label>
          <span className="text-[11px] leading-none text-muted-foreground">
            Tilt to steer or aim
          </span>
        </div>
        <Switch
          id="gyro-enabled"
          checked={gyroEnabled}
          disabled={secureHint}
          onCheckedChange={(v) => void handleEnableToggle(v)}
        />
      </div>

      <div className="flex items-center justify-between gap-3">
        <Label className="shrink-0 text-sm font-medium">Target stick</Label>
        <Select
          value={gyroTarget}
          disabled={disabled}
          onValueChange={(v) =>
            v && setGyroTarget(v as 'leftStick' | 'rightStick')
          }
        >
          <SelectTrigger className="h-8 w-[calc(50%-4px)] shrink-0 gap-1.5 border-white/20 bg-white/[0.08] dark:bg-white/[0.08] pl-2.5 pr-2 backdrop-blur-sm shadow-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="leftStick">leftStick</SelectItem>
            <SelectItem value="rightStick">rightStick</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center justify-between gap-3">
        <Label className="shrink-0 text-sm font-medium">Mode</Label>
        <Select
          value={gyroMode}
          disabled={disabled}
          onValueChange={(v) => v && setGyroMode(v as 'steer' | 'aim')}
        >
          <SelectTrigger className="h-8 w-[calc(50%-4px)] shrink-0 gap-1.5 border-white/20 bg-white/[0.08] dark:bg-white/[0.08] pl-2.5 pr-2 backdrop-blur-sm shadow-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="steer">Steer</SelectItem>
            <SelectItem value="aim">Aim</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Deadzone / max */}
      {gyroMode === 'steer' ? (
        <div className="space-y-2">
          <Label>Deadzone / Max angle</Label>
          <DualRange
            deadzone={deadzoneX}
            maxAngle={maxAngleX}
            disabled={disabled}
            live={liveX}
            onDeadzoneChange={setDeadzoneX}
            onMaxChange={setMaxAngleX}
          />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>dz {(deadzoneX * 100).toFixed(0)}%</span>
            <span>max {maxAngleX}°</span>
          </div>
          <div className="flex items-center justify-between gap-3 pt-1">
            <Label htmlFor="invert-x" className="text-xs">
              Invert X
            </Label>
            <Switch
              id="invert-x"
              checked={invertX}
              disabled={disabled}
              onCheckedChange={setInvertX}
            />
          </div>
        </div>
      ) : (
        <>
          <div className="space-y-2">
            <Label>X — Deadzone / Max</Label>
            <DualRange
              deadzone={deadzoneX}
              maxAngle={maxAngleX}
              disabled={disabled}
              live={liveX}
              onDeadzoneChange={setDeadzoneX}
              onMaxChange={setMaxAngleX}
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>dz {(deadzoneX * 100).toFixed(0)}%</span>
              <span>max {maxAngleX}°</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="invert-x" className="text-xs">
                Invert X
              </Label>
              <Switch
                id="invert-x"
                checked={invertX}
                disabled={disabled}
                onCheckedChange={setInvertX}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Y — Deadzone / Max</Label>
            <DualRange
              deadzone={deadzoneY}
              maxAngle={maxAngleY}
              disabled={disabled}
              live={liveY}
              onDeadzoneChange={setDeadzoneY}
              onMaxChange={setMaxAngleY}
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>dz {(deadzoneY * 100).toFixed(0)}%</span>
              <span>max {maxAngleY}°</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="invert-y" className="text-xs">
                Invert Y
              </Label>
              <Switch
                id="invert-y"
                checked={invertY}
                disabled={disabled}
                onCheckedChange={setInvertY}
              />
            </div>
          </div>
        </>
      )}

      <Button
        variant="outline"
        className="w-full"
        disabled={disabled}
        onClick={handleCalibrate}
      >
        {calibratedFlash ? 'Calibrated ✓' : 'Calibrate'}
      </Button>

      {/* synthetic mini-stick preview */}
      <div className={`space-y-2 ${disabled ? 'opacity-50' : ''}`}>
        <Label>Preview</Label>
        <div className="flex items-center gap-4">
          <div className="relative size-20 rounded-full border bg-muted overflow-hidden shrink-0">
            <div
              className="absolute size-3 rounded-full bg-primary"
              style={{
                left: `calc(50% + ${liveX * 40}%)`,
                top: `calc(50% + ${liveY * 40}%)`,
                transform: 'translate(-50%, -50%)',
              }}
            />
            <div className="absolute inset-0 grid place-items-center pointer-events-none text-[10px] text-muted-foreground">
              {gyroMode === 'steer' ? 'Steer' : 'Aim'}
            </div>
          </div>
          <div className="flex-1 space-y-1 text-xs tabular-nums">
            <div>X: {liveX.toFixed(2)}</div>
            <div>Y: {liveY.toFixed(2)}</div>
            <div className="h-1 w-full bg-muted rounded">
              <div
                className="h-1 bg-primary rounded transition-none"
                style={{ width: `${((liveX + 1) / 2) * 100}%` }}
              />
            </div>
            {gyroMode === 'aim' && (
              <div className="h-1 w-full bg-muted rounded">
                <div
                  className="h-1 bg-primary rounded transition-none"
                  style={{ width: `${((liveY + 1) / 2) * 100}%` }}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
