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
};

export type AoChannel = {
  id: number;
  voltage: number;
  label: string;
};

export type PollingRateOption = {
  label: string;
  valueMs: number;
};

export type DataPoint = {
  timestamp: number;
  ai: number[];
};

export type SerialParity = 'none' | 'odd' | 'even';

export type SerialSettings = {
  baudRate: number;
  dataBits: 7 | 8;
  stopBits: 1 | 2;
  parity: SerialParity;
};
