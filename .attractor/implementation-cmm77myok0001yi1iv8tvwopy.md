```diff
diff --git a/apps/factory-api/src/main.ts b/apps/factory-api/src/main.ts
--- a/apps/factory-api/src/main.ts
+++ b/apps/factory-api/src/main.ts
@@ -81,6 +81,7 @@ app.use((req, res, next) => {
 
 const PORT = Number(process.env.PORT ?? 8080);
 const HOST = process.env.HOST ?? "0.0.0.0";
+const FACTORY_VERSION = (process.env.FACTORY_VERSION ?? "").trim() || "unknown";
 const RUNNER_DEFAULT_IMAGE =
   process.env.RUNNER_IMAGE ?? "ghcr.io/wcraigjones/attractor-factory-runner:latest";
 const RUNNER_DEFAULT_SERVICE_ACCOUNT = process.env.RUNNER_SERVICE_ACCOUNT ?? "factory-runner";
@@ -1666,7 +1667,19 @@ function sendError(res: express.Response, status: number, error: string) {
 }
 
 app.get("/healthz", (_req, res) => {
-  res.json({ status: "ok", service: "factory-api", runnerImage: RUNNER_DEFAULT_IMAGE });
+  res.json({
+    status: "ok",
+    service: "factory-api",
+    version: FACTORY_VERSION,
+    runnerImage: RUNNER_DEFAULT_IMAGE
+  });
+});
+
+app.get("/api/status", (_req, res) => {
+  res.json({
+    status: "ok",
+    service: "factory-api",
+    version: FACTORY_VERSION
+  });
 });
 
 app.get("/api/models/providers", (_req, res) => {
diff --git a/apps/factory-web/src/client/main.tsx b/apps/factory-web/src/client/main.tsx
--- a/apps/factory-web/src/client/main.tsx
+++ b/apps/factory-web/src/client/main.tsx
@@ -8,6 +8,37 @@ import { Toaster } from "sonner";
 import { App } from "./app";
 import "./styles.css";
 
+type FactoryAppConfig = {
+  factoryVersion?: string;
+};
+
+function readFactoryVersion(): string {
+  const config = (window as Window & { __FACTORY_APP_CONFIG__?: FactoryAppConfig })
+    .__FACTORY_APP_CONFIG__;
+  const version = config?.factoryVersion;
+  if (typeof version !== "string") {
+    return "unknown";
+  }
+  const normalized = version.trim();
+  return normalized.length > 0 ? normalized : "unknown";
+}
+
+const FACTORY_VERSION = readFactoryVersion();
+
+const versionBadgeStyle: React.CSSProperties = {
+  position: "fixed",
+  right: "0.75rem",
+  bottom: "0.5rem",
+  padding: "0.2rem 0.45rem",
+  borderRadius: "0.35rem",
+  background: "rgba(17, 24, 39, 0.72)",
+  color: "#e5e7eb",
+  fontSize: "0.7rem",
+  letterSpacing: "0.01em",
+  lineHeight: 1.2,
+  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
+  zIndex: 9999
+};
+
 const queryClient = new QueryClient({
   defaultOptions: {
     queries: {
@@ -23,6 +54,12 @@ ReactDOM.createRoot(document.getElementById("root")!).render(
         <App />
       </BrowserRouter>
       <Toaster richColors position="top-right" />
+      <div style={versionBadgeStyle} aria-label="factory-version" title="factory version">
+        version {FACTORY_VERSION}
+      </div>
     </QueryClientProvider>
   </React.StrictMode>
 );
diff --git a/apps/factory-web/src/server/main.ts b/apps/factory-web/src/server/main.ts
--- a/apps/factory-web/src/server/main.ts
+++ b/apps/factory-web/src/server/main.ts
@@ -9,6 +9,7 @@ const app = express();
 const PORT = Number(process.env.PORT ?? 3000);
 const HOST = process.env.HOST ?? "0.0.0.0";
 const API_BASE_URL = process.env.API_BASE_URL ?? "/api";
+const FACTORY_VERSION = (process.env.FACTORY_VERSION ?? "").trim() || "unknown";
 
 const currentDir = resolve(fileURLToPath(new URL(".", import.meta.url)));
 const clientDist = resolve(currentDir, "../client");
@@ -15,12 +16,18 @@ const clientDist = resolve(currentDir, "../client");
 
 app.get("/healthz", (_req, res) => {
-  res.json({ status: "ok", service: "factory-web", apiBaseUrl: API_BASE_URL });
+  res.json({
+    status: "ok",
+    service: "factory-web",
+    version: FACTORY_VERSION,
+    apiBaseUrl: API_BASE_URL
+  });
 });
 
 app.get("/app-config.js", (_req, res) => {
   res.type("application/javascript");
-  res.send(`window.__FACTORY_APP_CONFIG__ = { apiBaseUrl: ${JSON.stringify(API_BASE_URL)} };`);
+  res.send(
+    `window.__FACTORY_APP_CONFIG__ = { apiBaseUrl: ${JSON.stringify(API_BASE_URL)}, factoryVersion: ${JSON.stringify(FACTORY_VERSION)} };`
+  );
 });
 
 if (existsSync(clientDist)) {
diff --git a/deploy/helm/factory-system/templates/core.yaml b/deploy/helm/factory-system/templates/core.yaml
--- a/deploy/helm/factory-system/templates/core.yaml
+++ b/deploy/helm/factory-system/templates/core.yaml
@@ -307,6 +307,8 @@ spec:
           env:
             - name: PORT
               value: {{ .Values.service.api.port | quote }}
+            - name: FACTORY_VERSION
+              value: {{ default "" .Values.global.factoryVersion | quote }}
             - name: REDIS_URL
               value: "redis://redis.{{ include "factory.namespace" . }}.svc.cluster.local:6379"
             - name: DATABASE_URL
@@ -383,6 +385,8 @@ spec:
           env:
             - name: PORT
               value: {{ .Values.service.web.port | quote }}
+            - name: FACTORY_VERSION
+              value: {{ default "" .Values.global.factoryVersion | quote }}
             - name: API_BASE_URL
               value: {{ .Values.web.apiBaseUrl | quote }}
           resources:
diff --git a/deploy/helm/factory-system/values.yaml b/deploy/helm/factory-system/values.yaml
--- a/deploy/helm/factory-system/values.yaml
+++ b/deploy/helm/factory-system/values.yaml
@@ -4,6 +4,7 @@ namespace: factory-system
 
 global:
   imagePullPolicy: IfNotPresent
+  factoryVersion: ""
 
 images:
   api:
```