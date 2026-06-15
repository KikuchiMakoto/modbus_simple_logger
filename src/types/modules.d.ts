/// <reference types="vite/client" />

declare module 'react-plotly.js';

// Custom minimal Plotly bundle (see src/plotly.ts). Only the submodules the
// chart actually needs are imported so the full plotly.js — 3D, maps, finance
// and every SVG trace — never reaches the bundle. These submodules ship no
// type declarations, so they are described loosely here.
declare module 'plotly.js/lib/core' {
  interface PlotlyCore {
    register: (modules: unknown[]) => void;
  }
  const Plotly: PlotlyCore;
  export default Plotly;
}

declare module 'plotly.js/lib/scattergl' {
  const trace: unknown;
  export default trace;
}

declare module 'react-plotly.js/factory' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const createPlotlyComponent: (plotly: unknown) => import('react').ComponentType<any>;
  export default createPlotlyComponent;
}

interface ImportMetaEnv {
  readonly VITE_APP_VERSION: string;
  readonly VITE_APP_NAME: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
