import { persist } from 'zustand/middleware';
import { createStore } from 'zustand/vanilla';

export interface SettingsState {
  vibrationMs: number;
  rumble: boolean;
  sound: boolean;
  ignoreCutout: boolean;
  skin: string;
  gyroEnabled: boolean;
  gyroTarget: 'leftStick' | 'rightStick';
  gyroMode: 'steer' | 'aim';
  deadzoneX: number;
  maxAngleX: number;
  invertX: boolean;
  deadzoneY: number;
  maxAngleY: number;
  invertY: boolean;
  gyroCalibBeta: number | null;
  gyroCalibGamma: number | null;
}

export interface SettingsActions {
  setVibrationMs: (v: number) => void;
  setRumble: (v: boolean) => void;
  setSound: (v: boolean) => void;
  setIgnoreCutout: (v: boolean) => void;
  setSkin: (id: string) => void;
  setGyroEnabled: (v: boolean) => void;
  setGyroTarget: (v: SettingsState['gyroTarget']) => void;
  setGyroMode: (v: SettingsState['gyroMode']) => void;
  setGyroCalib: (beta: number | null, gamma: number | null) => void;
}

export type SettingsStore = SettingsState & SettingsActions;

const DEFAULTS: SettingsState = {
  vibrationMs: 40,
  rumble: true,
  sound: false,
  ignoreCutout: true,
  skin: 'airdeck',
  gyroEnabled: false,
  gyroTarget: 'leftStick',
  gyroMode: 'steer',
  deadzoneX: 0.08,
  maxAngleX: 35,
  invertX: false,
  deadzoneY: 0.08,
  maxAngleY: 35,
  invertY: false,
  gyroCalibBeta: null,
  gyroCalibGamma: null,
};

export const settingsStore = createStore<SettingsStore>()(
  persist(
    (set) => ({
      ...DEFAULTS,
      setVibrationMs: (vibrationMs) => set({ vibrationMs }),
      setRumble: (rumble) => set({ rumble }),
      setSound: (sound) => set({ sound }),
      setIgnoreCutout: (ignoreCutout) => set({ ignoreCutout }),
      setSkin: (skin) => set({ skin }),
      setGyroEnabled: (gyroEnabled) => set({ gyroEnabled }),
      setGyroTarget: (gyroTarget) => set({ gyroTarget }),
      setGyroMode: (gyroMode) => set({ gyroMode }),
      setGyroCalib: (gyroCalibBeta, gyroCalibGamma) =>
        set({ gyroCalibBeta, gyroCalibGamma }),
    }),
    {
      name: 'airdeck.settings.v1',
      version: 1,
    },
  ),
);
