import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  authenticateBasicHeader,
  buildWwwAuthenticateHeader,
  isAuthEnabled,
  resolveAuthConfig,
  type AuthConfig,
  type AuthEnabledConfig
} from "@attractor/shared-auth";

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

function sendAuthRequired(res: ServerResponse, config: AuthEnabledConfig): void {
  res.statusCode = 401;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("WWW-Authenticate", buildWwwAuthenticateHeader(config));
  res.end(JSON.stringify({ error: "authentication required" }));
}

export function routeApiRequest(method: string, requestUrl: string): ApiRouteResult {
  const url = new URL(requestUrl, "http://localhost");
  const path = url.pathname;

  if (path === "/healthz") {
    return {
      status: 200,
      body: {
        status: "ok",
        service: "attractor-api"
      }
    };
  }

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

export function handleApiRequest(
  req: IncomingMessage,
  res: ServerResponse,
  authConfig: AuthConfig = resolveAuthConfig(process.env)
): void {
  const method = req.method ?? "GET";
  const requestUrl = req.url ?? "/";
  const url = new URL(requestUrl, "http://localhost");
  const isPublicHealthCheck = method === "GET" && url.pathname === "/healthz";

  if (isAuthEnabled(authConfig) && !isPublicHealthCheck) {
    const principal = authenticateBasicHeader(req.headers.authorization, authConfig);
    if (!principal) {
      sendAuthRequired(res, authConfig);
      return;
    }
  }

  toJsonResponse(routeApiRequest(method, requestUrl), res);
}

export function createApiServer(authConfig: AuthConfig = resolveAuthConfig(process.env)) {
  return createServer((req, res) => handleApiRequest(req, res, authConfig));
}
