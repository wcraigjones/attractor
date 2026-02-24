import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { listModelsForProvider, listModelProviders } from "../llm/model-catalog.js";

export interface ApiRouteResult {
  status: number;
  body: unknown;
}

function toJsonResponse(result: ApiRouteResult, res: ServerResponse): void {
  res.statusCode = result.status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(result.body));
}

export function routeApiRequest(method: string, requestUrl: string): ApiRouteResult {
  const url = new URL(requestUrl, "http://localhost");
  const path = url.pathname;

  if (method !== "GET") {
    return {
      status: 405,
      body: { error: "Method not allowed" }
    };
  }

  if (path === "/api/models/providers") {
    return {
      status: 200,
      body: {
        providers: listModelProviders()
      }
    };
  }

  if (path === "/api/models") {
    const provider = url.searchParams.get("provider");
    if (!provider) {
      return {
        status: 400,
        body: { error: "provider query parameter is required" }
      };
    }

    const providers = listModelProviders();
    if (!providers.includes(provider)) {
      return {
        status: 404,
        body: { error: `Unknown provider: ${provider}` }
      };
    }

    return {
      status: 200,
      body: {
        provider,
        models: listModelsForProvider(provider)
      }
    };
  }

  return {
    status: 404,
    body: { error: "Not found" }
  };
}

export function handleApiRequest(req: IncomingMessage, res: ServerResponse): void {
  const method = req.method ?? "GET";
  const requestUrl = req.url ?? "/";
  toJsonResponse(routeApiRequest(method, requestUrl), res);
}

export function createApiServer() {
  return createServer(handleApiRequest);
}
