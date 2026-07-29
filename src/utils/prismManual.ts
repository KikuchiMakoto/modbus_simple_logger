// Prism's core, evaluated and published on the global — imported for these two
// side effects ALONE, and only by utils/prism.ts, which imports it before any
// grammar.
//
// Prism's grammar files (`prismjs/components/prism-*.js`) are plain scripts that
// assign to a BARE `Prism` global; nothing in them imports the core. That global
// is published by the core itself, which is CommonJS — and a bundler is free to
// wrap CJS in a factory that runs on first require rather than in place. In the
// production build it does exactly that, so the grammars, emitted as eager
// top-level statements, ran before anything had required the core:
//
//     Uncaught ReferenceError: Prism is not defined
//
// and the app died at load with a white page. Dev never showed it: esbuild's
// dep pre-bundling evaluates the core in place.
//
// Requiring the core HERE forces the factory to run at this module's position —
// ahead of every grammar — and the explicit assignment means the grammars find
// the global no matter what the bundler decided to do with the core's own
// `globalThis.Prism = …` line. Both of those only hold while this module and the
// grammars end up in the same chunk, which is why vite.config.ts keeps prismjs
// out of the vendor chunk. Do not "simplify" either half away.
import Prism from 'prismjs';

// `manual` is read by the core as it initialises, so it has to be on the global
// before the import above — hence the assignment order below is the reverse of
// what it looks like it should be: the core has already run, and this only
// stops the DOMContentLoaded pass that walks the document for
// `code[class*="language-"]`. Nothing in this app is highlighted that way (the
// editor calls Prism.highlight() itself), so the walk is pure startup cost.
const globalPrism = globalThis as unknown as { Prism?: unknown };
globalPrism.Prism = Prism;
Prism.manual = true;

export {};
