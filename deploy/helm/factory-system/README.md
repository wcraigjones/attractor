# factory-system Helm chart

Installs the local Kubernetes control plane stack for Attractor Factory in `factory-system`:

- `factory-api`
- `factory-web`
- `factory-runner-controller`
- `postgres`
- `redis`
- `minio`

## Render templates

```bash
helm template factory-system ./deploy/helm/factory-system \
  -f ./deploy/helm/factory-system/values.local-orbstack.yaml
```

## Install locally (OrbStack)

```bash
helm upgrade --install factory-system ./deploy/helm/factory-system \
  --namespace factory-system --create-namespace \
  -f ./deploy/helm/factory-system/values.local-orbstack.yaml
```

## Uninstall

```bash
helm uninstall factory-system --namespace factory-system
```
