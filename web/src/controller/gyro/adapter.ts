export interface GyroReading {
  beta: number;
  gamma: number;
  quat?: number[];
  timestamp: number;
}

export interface GyroAdapterOptions {
  onReading: (reading: GyroReading) => void;
  onError: (error: Error) => void;
}

export interface GyroAdapter {
  start(): Promise<void>;
  stop(): void;
  requestPermission?(): Promise<boolean>;
}
