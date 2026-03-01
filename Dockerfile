FROM node:22-bookworm-slim

WORKDIR /workspace

ARG KUBECTL_VERSION=v1.32.2
ARG HELM_VERSION=v3.17.0

RUN apt-get update \
  && apt-get install -y --no-install-recommends git openssl ca-certificates curl jq unzip awscli tar \
  && rm -rf /var/lib/apt/lists/*

RUN curl -fsSLo /usr/local/bin/kubectl "https://dl.k8s.io/release/${KUBECTL_VERSION}/bin/linux/amd64/kubectl" \
  && chmod +x /usr/local/bin/kubectl \
  && curl -fsSLo /tmp/helm.tgz "https://get.helm.sh/helm-${HELM_VERSION}-linux-amd64.tar.gz" \
  && tar -xzf /tmp/helm.tgz -C /tmp \
  && mv /tmp/linux-amd64/helm /usr/local/bin/helm \
  && chmod +x /usr/local/bin/helm \
  && rm -rf /tmp/helm.tgz /tmp/linux-amd64

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
