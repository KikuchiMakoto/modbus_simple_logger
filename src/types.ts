export type AiCalibration = {
  a: number;
  b: number;
  c: number;
};

export type AiChannel = {
  id: number;
  raw: number;
  physical: number;
  label: string;
  status: 'normal' | 'warning' | 'danger';
  voltage: number;       // mV/V for HX711 (0-7), V for ADS1115 (8-15)
  microStrain: number;   // μɛ for HX711 (0-7), 0 for ADS1115 (8-15)
};

export type AoChannel = {
  id: number;
  raw: number;
  physical: number;
  label: string;
};

export type PollingRateOption = {
  label: string;
  valueMs: number;
};

export type DataPoint = {
  seq: number;
  timestamp: number;
  aiRaw: Float32Array;
  aiPhysical: Float32Array;
};

export type SerialParity = 'none' | 'odd' | 'even';

export type SerialSettings = {
  baudRate: number;
  dataBits: 7 | 8;
  stopBits: 1 | 2;
  parity: SerialParity;
};

export type ModbusPrecision = 'normal' | 'extended';

export type VoltageMode =
  | 'unknown'
  | 'hx711_mv_per_v'
  | 'hx711_micro_strain'
  | 'ads1115_10v'
  | 'ads1115_6144mv'
  | 'ads1115_4096mv'
  | 'ads1115_2048mv'
  | 'ads1115_1024mv'
  | 'ads1115_512mv'
  | 'ads1115_256mv';

export const VOLTAGE_MODES: { value: VoltageMode; label: string; unit: string }[] = [
  { value: 'unknown', label: 'Unknown', unit: '' },
  { value: 'hx711_mv_per_v', label: 'HX711 (mV/V)', unit: 'mV/V' },
  { value: 'hx711_micro_strain', label: 'HX711 (με)', unit: 'με' },
  { value: 'ads1115_10v', label: 'ADS1115 (10 V)', unit: 'V' },
  { value: 'ads1115_6144mv', label: 'ADS1115 (6.144 V)', unit: 'V' },
  { value: 'ads1115_4096mv', label: 'ADS1115 (4.096 V)', unit: 'V' },
  { value: 'ads1115_2048mv', label: 'ADS1115 (2.048 V)', unit: 'V' },
  { value: 'ads1115_1024mv', label: 'ADS1115 (1.024 V)', unit: 'V' },
  { value: 'ads1115_512mv', label: 'ADS1115 (512 mV)', unit: 'mV' },
  { value: 'ads1115_256mv', label: 'ADS1115 (256 mV)', unit: 'mV' },
];

export const DEFAULT_VOLTAGE_CONFIG: VoltageMode[] = Array.from({ length: 16 }, (_, i) =>
  i < 8 ? 'hx711_mv_per_v' : 'ads1115_6144mv',
);

// File System Access API types
export interface FilePickerAcceptType {
  description?: string;
  accept: Record<string, string[]>;
}

export interface SaveFilePickerOptions {
  suggestedName?: string;
  types?: FilePickerAcceptType[];
}

export interface OpenFilePickerOptions {
  types?: FilePickerAcceptType[];
  multiple?: boolean;
}

export interface FileSystemFileHandle {
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<FileSystemWritableFileStream>;
}

declare global {
  interface Window {
    showSaveFilePicker(options?: SaveFilePickerOptions): Promise<FileSystemFileHandle>;
    showOpenFilePicker(options?: OpenFilePickerOptions): Promise<FileSystemFileHandle[]>;
  }
}
