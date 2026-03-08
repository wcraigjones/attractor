import { createApiServer } from "./server.js";
import { isAuthEnabled, resolveAuthConfig } from "@attractor/shared-auth";

const port = Number(process.env.PORT ?? 8080);
const host = process.env.HOST ?? "0.0.0.0";
const authConfig = resolveAuthConfig(process.env);

if (isAuthEnabled(authConfig)) {
  process.stdout.write(`Attractor API basic auth enabled for user ${authConfig.username}\n`);
}

const server = createApiServer(authConfig);
server.listen(port, host, () => {
  process.stdout.write(`Attractor API listening on http://${host}:${port}\n`);
});
