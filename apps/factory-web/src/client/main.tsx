import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { App } from "./app";
import "./styles.css";

type FactoryAppConfig = {
  factoryVersion?: string;
};

function readFactoryVersion(): string {
  const config = (window as Window & { __FACTORY_APP_CONFIG__?: FactoryAppConfig })
    .__FACTORY_APP_CONFIG__;
  const version = config?.factoryVersion;
  if (typeof version !== "string") {
    return "unknown";
  }
  const normalized = version.trim();
  return normalized.length > 0 ? normalized : "unknown";
}

const FACTORY_VERSION = readFactoryVersion();

const versionBadgeStyle: React.CSSProperties = {
  position: "fixed",
  right: "0.75rem",
  bottom: "0.5rem",
  padding: "0.2rem 0.45rem",
  borderRadius: "0.35rem",
  background: "rgba(17, 24, 39, 0.72)",
  color: "#e5e7eb",
  fontSize: "0.7rem",
  letterSpacing: "0.01em",
  lineHeight: 1.2,
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  zIndex: 9999
};

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      refetchOnWindowFocus: false
    }
  }
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
      <div style={versionBadgeStyle} aria-label="factory-version" title="factory version">
        version {FACTORY_VERSION}
      </div>
    </QueryClientProvider>
  </React.StrictMode>
);
