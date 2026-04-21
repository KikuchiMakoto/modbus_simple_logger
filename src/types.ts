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
  timestamp: number;
  aiRaw: number[];
  aiPhysical: number[];
  aiVoltage: number[];
};

export type SerialParity = 'none' | 'odd' | 'even';

export type SerialSettings = {
  baudRate: number;
  dataBits: 7 | 8;
  stopBits: 1 | 2;
  parity: SerialParity;
};

export type ModbusPrecision = 'normal' | 'extended';

export type VoltageDisplayMode =
  | 'hx711_mv_per_v'
  | 'hx711_micro_strain'
  | 'ads1115_10v'
  | 'ads1115_6_114v'
  | 'ads1115_4_096v'
  | 'ads1115_2_048v'
  | 'ads1115_1_024v'
  | 'ads1115_512mv'
  | 'ads1115_256mv';

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
  getFile(): Promise<File>;
  createWritable(): Promise<FileSystemWritableFileStream>;
}

declare global {
  interface Window {
    showSaveFilePicker(options?: SaveFilePickerOptions): Promise<FileSystemFileHandle>;
    showOpenFilePicker(options?: OpenFilePickerOptions): Promise<FileSystemFileHandle[]>;
  }
}
