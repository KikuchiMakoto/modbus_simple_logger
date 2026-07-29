import type { ComponentType } from 'react';
import PlotlyCoreImport from 'plotly.js/lib/core';
import scatterglImport from 'plotly.js/lib/scattergl';
import factoryImport from 'react-plotly.js/factory';
// `plotly.js/lib/*` and `react-plotly.js/factory` are CommonJS modules, so the
// default import needs unwrapping — see the helper for why it is not optional.
import { interopDefault } from './utils/interopDefault';

const Plotly = interopDefault(PlotlyCoreImport);
const scattergl = interopDefault(scatterglImport);
const createPlotlyComponent = interopDefault(factoryImport);

// ChartPanel renders exclusively with the WebGL `scattergl` trace, so we build a
// custom Plotly bundle from `plotly.js/lib/core` plus only that trace instead of
// importing the full `plotly.js` (every trace type, 3D, maps and finance
// charts). This trims several MB from the production bundle.
Plotly.register([scattergl]);

export const Plot: ComponentType<unknown> = createPlotlyComponent(Plotly);
