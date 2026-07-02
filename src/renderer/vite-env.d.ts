/// <reference types="vite/client" />

import type { CodePulseApi } from "../preload/codePulseApi";

declare global {
  interface Window {
    codePulse: CodePulseApi;
  }
}
