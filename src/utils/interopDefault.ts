/**
 * Unwrap a CommonJS default import.
 *
 * A CJS default import arrives either as the value itself or wrapped as
 * `{ default: value }`, and which one you get differs between bundlers —
 * esbuild in dev vs rolldown in the production build — so the shape cannot be
 * assumed either way. React is the loud case: handed the wrapper, it renders
 * "Element type is invalid: … but got: object".
 *
 * Used by src/plotly.ts (`plotly.js/lib/*`, `react-plotly.js/factory`) and
 * components/CodeEditor.tsx (`react-simple-code-editor`). Any dependency
 * published as CJS — no `exports` map and no `module` field in its
 * package.json — needs this.
 */
export function interopDefault<T>(mod: T): T {
  if (mod && typeof mod === 'object') {
    const wrapped = mod as { default?: T };
    if (wrapped.default !== undefined) return wrapped.default;
  }
  return mod;
}
