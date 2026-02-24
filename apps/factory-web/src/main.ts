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
        --bg0: #f3f8f2;
        --bg1: #eef4ec;
        --ink: #1f2a2d;
        --muted: #6b7e84;
        --ok: #1f8f60;
        --accent: #0f766e;
        --card: #ffffff;
        --line: #d6e2da;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: "IBM Plex Sans", "Avenir Next", sans-serif;
        color: var(--ink);
        background:
          radial-gradient(circle at 10% 0%, #fff 0%, transparent 40%),
          radial-gradient(circle at 100% 0%, #d8eee7 0%, transparent 30%),
          linear-gradient(180deg, var(--bg0), var(--bg1));
      }
      .container {
        width: min(1180px, 95vw);
        margin: 1.2rem auto 2rem;
        display: grid;
        grid-template-columns: repeat(12, 1fr);
        gap: 12px;
      }
      .card {
        background: var(--card);
        border: 1px solid var(--line);
        border-radius: 14px;
        padding: 14px;
        box-shadow: 0 8px 30px rgba(15, 30, 35, 0.06);
      }
      .span-4 { grid-column: span 4; }
      .span-6 { grid-column: span 6; }
      .span-8 { grid-column: span 8; }
      .span-12 { grid-column: span 12; }
      h1 { margin: 0 0 0.5rem 0; font-size: 1.3rem; }
      h2 { margin: 0 0 0.5rem 0; font-size: 1rem; }
      .muted { color: var(--muted); font-size: 0.9rem; }
      label { font-size: 0.82rem; color: var(--muted); display: block; margin-top: 8px; }
      input, select, textarea, button {
        width: 100%;
        margin-top: 4px;
        padding: 8px 10px;
        border-radius: 9px;
        border: 1px solid #cfded3;
        font: inherit;
      }
      textarea { min-height: 84px; resize: vertical; }
      button {
        background: var(--accent);
        color: #fff;
        border: 0;
        cursor: pointer;
        margin-top: 12px;
      }
      button.secondary {
        background: #2d3f48;
      }
      .row {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
      }
      pre {
        margin: 0;
        min-height: 190px;
        max-height: 420px;
        overflow: auto;
        background: #0b151e;
        color: #d2dfef;
        border-radius: 10px;
        padding: 10px;
        font-size: 0.8rem;
      }
      ul { margin: 0; padding-left: 1.1rem; max-height: 280px; overflow: auto; }
      .tag {
        display: inline-block;
        background: #e9f5f2;
        border: 1px solid #c9e6dd;
        border-radius: 999px;
        padding: 3px 8px;
        font-size: 0.72rem;
        color: #155b53;
      }
      @media (max-width: 920px) {
        .span-4, .span-6, .span-8 { grid-column: span 12; }
        .row { grid-template-columns: 1fr; }
      }
    </style>
  </head>
  <body>
    <div class="container">
      <section class="card span-12">
        <h1>Attractor Factory Control Plane</h1>
        <p class="muted">API: <code>${API_BASE_URL}</code> <span class="tag">OrbStack MVP</span></p>
      </section>

      <section class="card span-4">
        <h2>Self Bootstrap</h2>
        <label>Repo Full Name
          <input id="selfRepo" placeholder="owner/repo" value="wcraigjones/attractor" />
        </label>
        <label>Default Branch
          <input id="selfBranch" value="main" />
        </label>
        <label>Attractor Path
          <input id="selfAttractorPath" value="factory/self-bootstrap.dot" />
        </label>
        <button id="bootstrapSelf">Create/Update Self Project</button>
      </section>

      <section class="card span-4">
        <h2>Model Catalog</h2>
        <button id="loadProviders" class="secondary">Load Providers</button>
        <label>Provider
          <select id="providerSelect"></select>
        </label>
        <button id="loadModels" class="secondary">Load Models</button>
        <ul id="modelList"></ul>
      </section>

      <section class="card span-4">
        <h2>Projects</h2>
        <button id="refreshProjects" class="secondary">Refresh Projects</button>
        <label>Project
          <select id="projectSelect"></select>
        </label>
        <button id="refreshAttractors" class="secondary">Load Attractors</button>
        <label>Attractor
          <select id="attractorSelect"></select>
        </label>
      </section>

      <section class="card span-8">
        <h2>Create Run</h2>
        <div class="row">
          <label>Run Type
            <select id="runType">
              <option value="planning">planning</option>
              <option value="implementation">implementation</option>
            </select>
          </label>
          <label>Model Provider
            <input id="runProvider" value="anthropic" />
          </label>
          <label>Model ID
            <input id="runModelId" value="claude-sonnet-4-20250514" />
          </label>
          <label>Reasoning Level
            <select id="runReasoning">
              <option value="high" selected>high</option>
              <option value="medium">medium</option>
              <option value="low">low</option>
              <option value="minimal">minimal</option>
              <option value="xhigh">xhigh</option>
            </select>
          </label>
          <label>Source Branch
            <input id="runSourceBranch" value="main" />
          </label>
          <label>Target Branch
            <input id="runTargetBranch" value="attractor/self-run" />
          </label>
          <label>Spec Bundle ID (implementation only)
            <input id="runSpecBundleId" placeholder="spec bundle id" />
          </label>
          <label>Temperature
            <input id="runTemperature" value="0.2" />
          </label>
        </div>
        <button id="createRun">Queue Run</button>
        <button id="selfIterate" class="secondary">Queue Implementation From Latest Plan</button>
      </section>

      <section class="card span-4">
        <h2>Run Stream</h2>
        <label>Run ID
          <input id="runId" placeholder="run id" />
        </label>
        <button id="watchRun" class="secondary">Watch SSE</button>
        <button id="cancelRun" class="secondary">Cancel Run</button>
      </section>

      <section class="card span-12">
        <h2>Output</h2>
        <pre id="output">Ready.</pre>
      </section>
    </div>

    <script>
      const API_BASE = '${API_BASE_URL}';
      const output = document.getElementById('output');
      const providerSelect = document.getElementById('providerSelect');
      const modelList = document.getElementById('modelList');
      const projectSelect = document.getElementById('projectSelect');
      const attractorSelect = document.getElementById('attractorSelect');
      const runIdInput = document.getElementById('runId');

      let eventSource = null;

      const log = (data) => {
        output.textContent = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
      };

      async function api(path, options = {}) {
        const response = await fetch(API_BASE + path, {
          headers: { 'content-type': 'application/json' },
          ...options
        });
        const json = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(json.error || response.statusText);
        }
        return json;
      }

      async function loadProviders() {
        const payload = await api('/api/models/providers');
        providerSelect.innerHTML = '';
        for (const p of payload.providers) {
          const opt = document.createElement('option');
          opt.value = p;
          opt.textContent = p;
          providerSelect.appendChild(opt);
        }
        log(payload);
      }

      async function loadModels() {
        if (!providerSelect.value) {
          throw new Error('Select provider first');
        }
        const payload = await api('/api/models?provider=' + encodeURIComponent(providerSelect.value));
        modelList.innerHTML = '';
        for (const model of payload.models) {
          const li = document.createElement('li');
          li.textContent = model.id + ' (' + model.api + ')';
          modelList.appendChild(li);
        }
        log(payload);
      }

      async function refreshProjects() {
        const payload = await api('/api/projects');
        projectSelect.innerHTML = '';
        for (const project of payload.projects) {
          const opt = document.createElement('option');
          opt.value = project.id;
          opt.textContent = project.name + ' (' + project.namespace + ')';
          projectSelect.appendChild(opt);
        }
        log(payload);
      }

      async function refreshAttractors() {
        if (!projectSelect.value) {
          throw new Error('Select project first');
        }
        const payload = await api('/api/projects/' + projectSelect.value + '/attractors');
        attractorSelect.innerHTML = '';
        for (const attractor of payload.attractors) {
          const opt = document.createElement('option');
          opt.value = attractor.id;
          opt.textContent = attractor.name + ' (' + attractor.repoPath + ')';
          attractorSelect.appendChild(opt);
        }
        log(payload);
      }

      document.getElementById('bootstrapSelf').addEventListener('click', async () => {
        try {
          const payload = await api('/api/bootstrap/self', {
            method: 'POST',
            body: JSON.stringify({
              repoFullName: document.getElementById('selfRepo').value,
              defaultBranch: document.getElementById('selfBranch').value,
              attractorPath: document.getElementById('selfAttractorPath').value
            })
          });
          runIdInput.value = '';
          await refreshProjects();
          await refreshAttractors();
          log(payload);
        } catch (error) {
          log(String(error));
        }
      });

      document.getElementById('loadProviders').addEventListener('click', async () => {
        try { await loadProviders(); } catch (error) { log(String(error)); }
      });

      document.getElementById('loadModels').addEventListener('click', async () => {
        try { await loadModels(); } catch (error) { log(String(error)); }
      });

      document.getElementById('refreshProjects').addEventListener('click', async () => {
        try { await refreshProjects(); } catch (error) { log(String(error)); }
      });

      document.getElementById('refreshAttractors').addEventListener('click', async () => {
        try { await refreshAttractors(); } catch (error) { log(String(error)); }
      });

      document.getElementById('createRun').addEventListener('click', async () => {
        try {
          if (!projectSelect.value || !attractorSelect.value) {
            throw new Error('Project and attractor are required');
          }

          const runType = document.getElementById('runType').value;
          const body = {
            projectId: projectSelect.value,
            attractorDefId: attractorSelect.value,
            runType,
            sourceBranch: document.getElementById('runSourceBranch').value,
            targetBranch: document.getElementById('runTargetBranch').value,
            modelConfig: {
              provider: document.getElementById('runProvider').value,
              modelId: document.getElementById('runModelId').value,
              reasoningLevel: document.getElementById('runReasoning').value,
              temperature: Number(document.getElementById('runTemperature').value)
            }
          };

          const specBundleId = document.getElementById('runSpecBundleId').value;
          if (runType === 'implementation' && specBundleId) {
            body.specBundleId = specBundleId;
          }

          const payload = await api('/api/runs', {
            method: 'POST',
            body: JSON.stringify(body)
          });
          runIdInput.value = payload.runId;
          log(payload);
        } catch (error) {
          log(String(error));
        }
      });

      document.getElementById('selfIterate').addEventListener('click', async () => {
        try {
          if (!projectSelect.value || !attractorSelect.value) {
            throw new Error('Project and attractor are required');
          }

          const payload = await api('/api/projects/' + projectSelect.value + '/self-iterate', {
            method: 'POST',
            body: JSON.stringify({
              attractorDefId: attractorSelect.value,
              sourceBranch: document.getElementById('runSourceBranch').value,
              targetBranch: document.getElementById('runTargetBranch').value,
              modelConfig: {
                provider: document.getElementById('runProvider').value,
                modelId: document.getElementById('runModelId').value,
                reasoningLevel: document.getElementById('runReasoning').value,
                temperature: Number(document.getElementById('runTemperature').value)
              }
            })
          });
          runIdInput.value = payload.runId;
          log(payload);
        } catch (error) {
          log(String(error));
        }
      });

      document.getElementById('watchRun').addEventListener('click', async () => {
        if (!runIdInput.value) {
          log('Run ID required');
          return;
        }

        if (eventSource) {
          eventSource.close();
        }

        eventSource = new EventSource(API_BASE + '/api/runs/' + runIdInput.value + '/events');
        eventSource.onmessage = (event) => {
          const line = event.data;
          output.textContent += '\\n' + line;
          output.scrollTop = output.scrollHeight;
        };
        eventSource.onerror = () => {
          output.textContent += '\\n[SSE disconnected]';
        };
      });

      document.getElementById('cancelRun').addEventListener('click', async () => {
        try {
          if (!runIdInput.value) {
            throw new Error('Run ID required');
          }
          const payload = await api('/api/runs/' + runIdInput.value + '/cancel', { method: 'POST' });
          log(payload);
        } catch (error) {
          log(String(error));
        }
      });

      (async () => {
        try {
          await loadProviders();
          await refreshProjects();
          if (projectSelect.value) {
            await refreshAttractors();
          }
        } catch (error) {
          log(String(error));
        }
      })();
    </script>
  </body>
</html>`);
});

app.listen(PORT, HOST, () => {
  process.stdout.write(`factory-web listening on http://${HOST}:${PORT}\n`);
});
