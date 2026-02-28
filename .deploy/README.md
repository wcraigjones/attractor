# Deployment Runbooks

This folder documents how Attractor Factory is deployed in two contexts:

1. Local development on Kubernetes (current implementation, supported now)
2. Production on AWS ECS (target architecture and migration plan)

Files:

- [Local K8s](/Users/wcj/Projects/attractor/.deploy/local-k8s.md)
- [Production ECS](/Users/wcj/Projects/attractor/.deploy/production-ecs.md)

Status summary:

- Local K8s: implemented and script-driven via Helm + OrbStack.
- ECS production: feasible, but requires runner-controller orchestration changes because current controller is Kubernetes Job-native.
