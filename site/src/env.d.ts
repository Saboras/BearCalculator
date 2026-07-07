/// <reference types="astro/client" />

/*
  DIRECTUS_TOKEN is the build-only read token (Story 4.3), read via process.env
  in Astro v6 (non-PUBLIC_ vars are Node process vars, never import.meta.env).
  The project has no @types/node, so declare the minimal surface we use here
  rather than pull in a new dependency.
*/
declare namespace NodeJS {
  interface ProcessEnv {
    readonly DIRECTUS_TOKEN?: string;
  }
}
declare const process: { env: NodeJS.ProcessEnv };
