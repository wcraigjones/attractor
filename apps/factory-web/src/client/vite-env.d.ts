/// <reference types="vite/client" />

declare global {
  interface Window {
    __FACTORY_APP_CONFIG__?: {
      apiBaseUrl?: string;
    };
    __toast?: {
      success: (message: string) => void;
      error: (message: string) => void;
    };
  }
}

export {};
