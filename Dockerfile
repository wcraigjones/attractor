FROM node:22-bookworm-slim

WORKDIR /workspace

RUN apt-get update \
  && apt-get install -y --no-install-recommends git openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY apps/factory-api/package.json apps/factory-api/package.json
COPY apps/factory-web/package.json apps/factory-web/package.json
COPY apps/factory-runner-controller/package.json apps/factory-runner-controller/package.json
COPY apps/factory-runner/package.json apps/factory-runner/package.json
COPY packages/shared-types/package.json packages/shared-types/package.json
COPY packages/shared-k8s/package.json packages/shared-k8s/package.json

RUN npm ci

COPY . .

RUN npm run prisma:generate && npm run build

ENV NODE_ENV=production

CMD ["node", "apps/factory-api/dist/main.js"]
