// Prism's auto-highlight, off — imported for this side effect ALONE, and only
// by utils/prism.ts, which imports it before prismjs itself.
//
// prism-core reads `window.Prism.manual` while it initialises (that is the only
// moment it is read) and otherwise registers a DOMContentLoaded handler that
// walks the whole document looking for `code[class*="language-"]`. Nothing in
// this app is highlighted that way — the editor calls Prism.highlight() itself —
// so the walk is pure startup cost on a page that is already doing a lot at
// mount.
//
// It has to be its own module because ES imports are hoisted: the assignment
// could not run before `import 'prismjs'` if both lived in one file.
// Cast rather than a `declare global` for window.Prism: @types/prismjs already
// declares the global as the fully initialised namespace, and this partial
// stand-in — which exists for the handful of milliseconds before prism-core
// replaces it — cannot satisfy that type.
(window as unknown as { Prism?: { manual?: boolean } }).Prism = { manual: true };

export {};
