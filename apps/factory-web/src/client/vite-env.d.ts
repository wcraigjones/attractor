/// <reference types="vite/client" />

declare global {
  interface Window {
    __FACTORY_APP_CONFIG__?: {
      apiBaseUrl?: string;
    };
  }
}

export {};
