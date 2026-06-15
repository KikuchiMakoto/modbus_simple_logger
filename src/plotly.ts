import type { ComponentType } from 'react';
import PlotlyCoreImport from 'plotly.js/lib/core';
import scatterglImport from 'plotly.js/lib/scattergl';
import factoryImport from 'react-plotly.js/factory';

// `plotly.js/lib/*` and `react-plotly.js/factory` are CommonJS modules. A CJS
// default import can arrive either as the value itself or wrapped as
// `{ default: value }`, and the shape differs between bundlers (esbuild in dev
// vs rolldown in the production build). Unwrap defensively so the chart works
// in both. (react-plotly.js's CJS/ESM interop is exactly this quirk.)
function interopDefault<T>(mod: T): T {
  if (mod && typeof mod === 'object') {
    const wrapped = mod as { default?: T };
    if (wrapped.default !== undefined) return wrapped.default;
  }
  return mod;
}

const Plotly = interopDefault(PlotlyCoreImport);
const scattergl = interopDefault(scatterglImport);
const createPlotlyComponent = interopDefault(factoryImport);

// ChartPanel renders exclusively with the WebGL `scattergl` trace, so we build a
// custom Plotly bundle from `plotly.js/lib/core` plus only that trace instead of
// importing the full `plotly.js` (every trace type, 3D, maps and finance
// charts). This trims several MB from the production bundle.
Plotly.register([scattergl]);

export const Plot: ComponentType<unknown> = createPlotlyComponent(Plotly);
