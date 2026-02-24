import express from "express";

const app = express();
const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? "0.0.0.0";
const API_BASE_URL = process.env.API_BASE_URL ?? "http://localhost:8080";

app.get("/healthz", (_req, res) => {
  res.json({ status: "ok", service: "factory-web", apiBaseUrl: API_BASE_URL });
});

app.get("/", (_req, res) => {
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.end(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Attractor Factory</title>
    <style>
      :root {
        --bg: #f4f6ef;
        --ink: #19222d;
        --accent: #2f6f5e;
        --paper: #ffffff;
      }
      body {
        margin: 0;
        font-family: "IBM Plex Sans", "Avenir Next", sans-serif;
        background: radial-gradient(circle at top left, #ffffff, var(--bg));
        color: var(--ink);
      }
      main {
        max-width: 960px;
        margin: 2rem auto;
        padding: 1.5rem;
        background: var(--paper);
        border: 1px solid #d5dfd4;
        border-radius: 14px;
        box-shadow: 0 10px 30px rgba(25, 34, 45, 0.08);
      }
      h1 { margin-top: 0; }
      button {
        border: 0;
        background: var(--accent);
        color: #fff;
        padding: 0.6rem 1rem;
        border-radius: 10px;
        cursor: pointer;
      }
      pre {
        background: #0f1720;
        color: #d8e3f0;
        padding: 1rem;
        border-radius: 10px;
        overflow: auto;
        min-height: 8rem;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Attractor Factory (MVP)</h1>
      <p>Web control surface connected to <code>${API_BASE_URL}</code>.</p>
      <p>This MVP UI exposes a quick model-catalog check and leaves full workflow screens for the next increments.</p>
      <button id="loadProviders">Load Model Providers</button>
      <pre id="output">Ready.</pre>
    </main>
    <script>
      const output = document.getElementById('output');
      document.getElementById('loadProviders').addEventListener('click', async () => {
        output.textContent = 'Loading...';
        try {
          const response = await fetch('${API_BASE_URL}/api/models/providers');
          const payload = await response.json();
          output.textContent = JSON.stringify(payload, null, 2);
        } catch (error) {
          output.textContent = String(error);
        }
      });
    </script>
  </body>
</html>`);
});

app.listen(PORT, HOST, () => {
  process.stdout.write(`factory-web listening on http://${HOST}:${PORT}\n`);
});
