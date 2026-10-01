/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Game server for the static client build (wss://demos.colyseus.cloud/one-prompt-game); unset in dev. */
  readonly VITE_SERVER_URL?: string;
}
