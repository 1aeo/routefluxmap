/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly PUBLIC_DATA_URL?: string;
  readonly PUBLIC_DATA_URL_FALLBACK?: string;
  readonly PUBLIC_SITE_URL?: string;
  readonly PUBLIC_METRICS_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}