/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_VERSION: string;
  readonly VITE_APP_NAME: string;
  readonly VITE_PYODIDE_VERSION: string;
  // JSON map of package name -> installed version (see vite.config.ts).
  readonly VITE_DEP_VERSIONS: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
