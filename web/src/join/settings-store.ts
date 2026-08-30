import { persist } from 'zustand/middleware';
import { createStore } from 'zustand/vanilla';

export interface SettingsState {
  vibrationMs: number;
  joystickPressMs: number;
  joystickEdgeMs: number;
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
  setJoystickPressMs: (v: number) => void;
  setJoystickEdgeMs: (v: number) => void;
  setRumble: (v: boolean) => void;
  setSound: (v: boolean) => void;
  setIgnoreCutout: (v: boolean) => void;
  setSkin: (id: string) => void;
  setGyroEnabled: (v: boolean) => void;
  setGyroTarget: (v: SettingsState['gyroTarget']) => void;
  setGyroMode: (v: SettingsState['gyroMode']) => void;
  setGyroCalib: (beta: number | null, gamma: number | null) => void;
  setDeadzoneX: (v: number) => void;
  setDeadzoneY: (v: number) => void;
  setMaxAngleX: (v: number) => void;
  setMaxAngleY: (v: number) => void;
  setInvertX: (v: boolean) => void;
  setInvertY: (v: boolean) => void;
}

export type SettingsStore = SettingsState & SettingsActions;

const DEFAULTS: SettingsState = {
  vibrationMs: 40,
  joystickPressMs: 35,
  joystickEdgeMs: 35,
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
      setJoystickPressMs: (joystickPressMs) => set({ joystickPressMs }),
      setJoystickEdgeMs: (joystickEdgeMs) => set({ joystickEdgeMs }),
      setRumble: (rumble) => set({ rumble }),
      setSound: (sound) => set({ sound }),
      setIgnoreCutout: (ignoreCutout) => set({ ignoreCutout }),
      setSkin: (skin) => set({ skin }),
      setGyroEnabled: (gyroEnabled) => set({ gyroEnabled }),
      setGyroTarget: (gyroTarget) => set({ gyroTarget }),
      setGyroMode: (gyroMode) => set({ gyroMode }),
      setGyroCalib: (gyroCalibBeta, gyroCalibGamma) =>
        set({ gyroCalibBeta, gyroCalibGamma }),
      setDeadzoneX: (deadzoneX) => set({ deadzoneX }),
      setDeadzoneY: (deadzoneY) => set({ deadzoneY }),
      setMaxAngleX: (maxAngleX) => set({ maxAngleX }),
      setMaxAngleY: (maxAngleY) => set({ maxAngleY }),
      setInvertX: (invertX) => set({ invertX }),
      setInvertY: (invertY) => set({ invertY }),
    }),
    {
      name: 'airdeck.settings.v1',
      version: 1,
    },
  ),
);
