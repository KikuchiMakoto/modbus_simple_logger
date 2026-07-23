import PlotlyCoreImport from "plotly.js/lib/core";
import scatterglImport from "plotly.js/lib/scattergl";
import type { ComponentType } from "react";
import factoryImport from "react-plotly.js/factory";

// `plotly.js/lib/*` and `react-plotly.js/factory` are CommonJS modules. A CJS
// default import can arrive either as the value itself or wrapped as
// `{ default: value }`, and the shape differs between bundlers (esbuild in dev
// vs rolldown in the production build). Unwrap defensively so the chart works
// in both. (react-plotly.js's CJS/ESM interop is exactly this quirk.)
function interopDefault<T>(mod: T): T {
	if (mod && typeof mod === "object") {
		const wrapped = mod as { default?: T };
		if (wrapped.default !== undefined) return wrapped.default;
	}
	return mod;
}

const Plotly = interopDefault(PlotlyCoreImport);
const scattergl = interopDefault(scatterglImport);
const createPlotlyComponent = interopDefault(factoryImport);

Plotly.register([scattergl]);

// biome-ignore lint/suspicious/noExplicitAny: react-plotly.js factory type is unsound
export const Plot: ComponentType<any> = createPlotlyComponent(Plotly);
