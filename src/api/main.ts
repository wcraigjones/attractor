import { createApiServer } from "./server.js";

const port = Number(process.env.PORT ?? 8080);
const host = process.env.HOST ?? "0.0.0.0";

const server = createApiServer();
server.listen(port, host, () => {
  process.stdout.write(`Attractor API listening on http://${host}:${port}\n`);
});
