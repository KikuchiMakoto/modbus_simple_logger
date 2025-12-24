declare module 'react-plotly.js';
declare module 'modbus-serial/utils/crc16' {
  function crc16(buffer: Buffer): number;
  export = crc16;
}
