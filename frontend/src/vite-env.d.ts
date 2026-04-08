/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Optional API origin for production builds (e.g. http://localhost:4111). */
  readonly VITE_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
