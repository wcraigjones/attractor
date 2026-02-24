import express from "express";
import { existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const app = express();

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? "0.0.0.0";
const API_BASE_URL = process.env.API_BASE_URL ?? "/api";

const currentDir = resolve(fileURLToPath(new URL(".", import.meta.url)));
const clientDist = resolve(currentDir, "../client");

app.get("/healthz", (_req, res) => {
  res.json({ status: "ok", service: "factory-web", apiBaseUrl: API_BASE_URL });
});

app.get("/app-config.js", (_req, res) => {
  res.type("application/javascript");
  res.send(`window.__FACTORY_APP_CONFIG__ = { apiBaseUrl: ${JSON.stringify(API_BASE_URL)} };`);
});

if (existsSync(clientDist)) {
  app.use(
    express.static(clientDist, {
      index: false,
      maxAge: "1h"
    })
  );

  app.get(/.*/, (req, res, next) => {
    if (req.path.startsWith("/api")) {
      return next();
    }
    res.sendFile(join(clientDist, "index.html"));
  });
} else {
  app.get(/.*/, (_req, res) => {
    res.status(503).json({ error: "factory-web client assets are missing; run build first" });
  });
}

app.listen(PORT, HOST, () => {
  process.stdout.write(`factory-web listening on http://${HOST}:${PORT}\n`);
});
