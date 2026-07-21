import PlotlyCoreImport from "plotly.js/lib/core";
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
const createPlotlyComponent = interopDefault(factoryImport);

// `plotly.js/lib/core` includes the `scatter` trace type. We use only
// `scatter` (SVG) for all charts — no WebGL `scattergl` needed.
// biome-ignore lint/suspicious/noExplicitAny: react-plotly.js factory type is unsound
export const Plot: ComponentType<any> = createPlotlyComponent(Plotly);
