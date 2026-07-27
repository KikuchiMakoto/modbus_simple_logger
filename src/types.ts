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
  param: Float32Array;
};

export type SerialParity = 'none' | 'odd' | 'even';

export type SerialSettings = {
  baudRate: number;
  dataBits: 7 | 8;
  stopBits: 1 | 2;
  parity: SerialParity;
};

/** The register map actually in use on the wire. Always one of the two. */
export type ModbusPrecision = 'normal' | 'extended';

/**
 * What the user picked in Connection Config. 'auto' is a preference, not a
 * mode: it is resolved to a ModbusPrecision once, at connect, and everything
 * downstream (polling, TSV column formatting, the readout) only ever sees the
 * resolved value. Keeping the two types apart is what stops 'auto' from
 * leaking into code that must know which map it is reading.
 */
export type ModbusPrecisionSetting = ModbusPrecision | 'auto';

export type VoltageMode =
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

/**
 * Synchronous OPFS access handle, used by the TSV writer worker for the crash
 * recovery mirror. @types/wicg-file-system-access predates it, and it is
 * deliberately absent from the picked-file path: createSyncAccessHandle() is
 * available on OPFS files only, and only inside a Worker.
 */
export interface FileSystemSyncAccessHandle {
  read(buffer: BufferSource, options?: { at?: number }): number;
  write(buffer: BufferSource, options?: { at?: number }): number;
  truncate(newSize: number): void;
  getSize(): number;
  flush(): void;
  close(): void;
}

declare global {
  interface Window {
    showSaveFilePicker(options?: SaveFilePickerOptions): Promise<FileSystemFileHandle>;
    showOpenFilePicker(options?: OpenFilePickerOptions): Promise<FileSystemFileHandle[]>;
  }

  interface FileSystemFileHandle {
    createSyncAccessHandle(): Promise<FileSystemSyncAccessHandle>;
  }
}
