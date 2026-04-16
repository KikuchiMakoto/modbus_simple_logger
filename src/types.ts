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
