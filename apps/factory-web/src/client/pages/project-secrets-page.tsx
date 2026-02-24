import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import {
  listGlobalSecrets,
  listProjectSecrets,
  listProviderSchemas,
  upsertGlobalSecret,
  upsertProjectSecret
} from "../lib/api";
import type { ProviderSchema } from "../lib/types";
import { PageTitle } from "../components/layout/page-title";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";

function firstLogicalKey(schema: ProviderSchema | undefined): string {
  if (!schema) {
    return "";
  }
  if ((schema.requiredAll?.length ?? 0) > 0) {
    return schema.requiredAll?.[0] ?? "";
  }
  if ((schema.requiredAny?.length ?? 0) > 0) {
    return schema.requiredAny?.[0] ?? "";
  }
  return Object.keys(schema.envByLogicalKey ?? {})[0] ?? "";
}

function defaultSecretKey(schema: ProviderSchema | undefined, logicalKey: string): string {
  if (!schema || !logicalKey) {
    return "";
  }
  const envName = schema.envByLogicalKey[logicalKey] ?? logicalKey;
  return envName.toLowerCase();
}

export function ProjectSecretsPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId ?? "";
  const queryClient = useQueryClient();

  const schemasQuery = useQuery({ queryKey: ["provider-schemas"], queryFn: listProviderSchemas });
  const projectSecretsQuery = useQuery({
    queryKey: ["project-secrets", projectId],
    queryFn: () => listProjectSecrets(projectId),
    enabled: projectId.length > 0
  });
  const globalSecretsQuery = useQuery({ queryKey: ["global-secrets"], queryFn: listGlobalSecrets });

  const [projectProvider, setProjectProvider] = useState("openai");
  const [projectName, setProjectName] = useState("llm-openai");
  const [projectLogicalKey, setProjectLogicalKey] = useState("apiKey");
  const [projectSecretKey, setProjectSecretKey] = useState("openai_api_key");
  const [projectSecretValue, setProjectSecretValue] = useState("");

  const [globalProvider, setGlobalProvider] = useState("openai");
  const [globalName, setGlobalName] = useState("global-openai");
  const [globalLogicalKey, setGlobalLogicalKey] = useState("apiKey");
  const [globalSecretKey, setGlobalSecretKey] = useState("openai_api_key");
  const [globalSecretValue, setGlobalSecretValue] = useState("");

  const schemaByProvider = useMemo(() => {
    return Object.fromEntries((schemasQuery.data ?? []).map((schema) => [schema.provider, schema]));
  }, [schemasQuery.data]);

  const currentProjectSchema = schemaByProvider[projectProvider];
  const currentGlobalSchema = schemaByProvider[globalProvider];

  useEffect(() => {
    const firstSchema = schemasQuery.data?.[0];
    if (!firstSchema) {
      return;
    }

    if (!schemaByProvider[projectProvider]) {
      const logicalKey = firstLogicalKey(firstSchema);
      setProjectProvider(firstSchema.provider);
      setProjectName(`llm-${firstSchema.provider}`);
      setProjectLogicalKey(logicalKey);
      setProjectSecretKey(defaultSecretKey(firstSchema, logicalKey));
    }

    if (!schemaByProvider[globalProvider]) {
      const logicalKey = firstLogicalKey(firstSchema);
      setGlobalProvider(firstSchema.provider);
      setGlobalName(`global-${firstSchema.provider}`);
      setGlobalLogicalKey(logicalKey);
      setGlobalSecretKey(defaultSecretKey(firstSchema, logicalKey));
    }
  }, [globalProvider, projectProvider, schemaByProvider, schemasQuery.data]);

  const projectMutation = useMutation({
    mutationFn: () =>
      upsertProjectSecret(projectId, {
        name: projectName.trim(),
        provider: projectProvider,
        keyMappings: { [projectLogicalKey]: projectSecretKey.trim() },
        values: { [projectSecretKey.trim()]: projectSecretValue }
      }),
    onSuccess: () => {
      toast.success("Project secret saved");
      setProjectSecretValue("");
      void queryClient.invalidateQueries({ queryKey: ["project-secrets", projectId] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  });

  const globalMutation = useMutation({
    mutationFn: () =>
      upsertGlobalSecret({
        name: globalName.trim(),
        provider: globalProvider,
        keyMappings: { [globalLogicalKey]: globalSecretKey.trim() },
        values: { [globalSecretKey.trim()]: globalSecretValue }
      }),
    onSuccess: () => {
      toast.success("Global secret saved");
      setGlobalSecretValue("");
      void queryClient.invalidateQueries({ queryKey: ["global-secrets"] });
      void queryClient.invalidateQueries({ queryKey: ["project-secrets", projectId] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  });

  return (
    <div>
      <PageTitle
        title="Secrets"
        description="Global secrets apply to every project namespace. Project secrets override globals for the same provider."
      />

      <div className="mb-4 flex items-center gap-2">
        <Badge variant="warning">Override Rule</Badge>
        <p className="text-sm text-muted-foreground">
          If both global and project secret exist for one provider, run pods use the project-scoped secret.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Project Secret</CardTitle>
            <CardDescription>Stored in project namespace and used first for provider auth.</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="grid gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                if (!projectSecretValue.trim()) {
                  toast.error("Project secret value is required");
                  return;
                }
                if (!projectName.trim() || !projectLogicalKey.trim() || !projectSecretKey.trim()) {
                  toast.error("Project secret name, logical key, and key are required");
                  return;
                }
                projectMutation.mutate();
              }}
            >
              <div className="space-y-1">
                <Label>Secret Name</Label>
                <Input value={projectName} onChange={(event) => setProjectName(event.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Provider</Label>
                <Select
                  value={projectProvider}
                  onValueChange={(provider) => {
                    const schema = schemaByProvider[provider];
                    const logicalKey = firstLogicalKey(schema);
                    setProjectProvider(provider);
                    setProjectName(`llm-${provider}`);
                    setProjectLogicalKey(logicalKey);
                    setProjectSecretKey(defaultSecretKey(schema, logicalKey));
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select provider" />
                  </SelectTrigger>
                  <SelectContent>
                    {(schemasQuery.data ?? []).map((schema) => (
                      <SelectItem key={schema.provider} value={schema.provider}>
                        {schema.provider}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1">
                  <Label>Logical Key</Label>
                  <Select
                    value={projectLogicalKey}
                    onValueChange={(logicalKey) => {
                      setProjectLogicalKey(logicalKey);
                      setProjectSecretKey(defaultSecretKey(currentProjectSchema, logicalKey));
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select key" />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.keys(currentProjectSchema?.envByLogicalKey ?? {}).map((key) => (
                        <SelectItem key={key} value={key}>
                          {key}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Secret Key</Label>
                  <Input value={projectSecretKey} onChange={(event) => setProjectSecretKey(event.target.value)} />
                </div>
              </div>
              <div className="space-y-1">
                <Label>Secret Value</Label>
                <Input
                  type="password"
                  value={projectSecretValue}
                  onChange={(event) => setProjectSecretValue(event.target.value)}
                />
              </div>
              <Button type="submit" disabled={projectMutation.isPending}>
                {projectMutation.isPending ? "Saving..." : "Save Project Secret"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Global Secret</CardTitle>
            <CardDescription>Shared across all projects. Good for default provider credentials.</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="grid gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                if (!globalSecretValue.trim()) {
                  toast.error("Global secret value is required");
                  return;
                }
                if (!globalName.trim() || !globalLogicalKey.trim() || !globalSecretKey.trim()) {
                  toast.error("Global secret name, logical key, and key are required");
                  return;
                }
                globalMutation.mutate();
              }}
            >
              <div className="space-y-1">
                <Label>Secret Name</Label>
                <Input value={globalName} onChange={(event) => setGlobalName(event.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Provider</Label>
                <Select
                  value={globalProvider}
                  onValueChange={(provider) => {
                    const schema = schemaByProvider[provider];
                    const logicalKey = firstLogicalKey(schema);
                    setGlobalProvider(provider);
                    setGlobalName(`global-${provider}`);
                    setGlobalLogicalKey(logicalKey);
                    setGlobalSecretKey(defaultSecretKey(schema, logicalKey));
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select provider" />
                  </SelectTrigger>
                  <SelectContent>
                    {(schemasQuery.data ?? []).map((schema) => (
                      <SelectItem key={schema.provider} value={schema.provider}>
                        {schema.provider}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1">
                  <Label>Logical Key</Label>
                  <Select
                    value={globalLogicalKey}
                    onValueChange={(logicalKey) => {
                      setGlobalLogicalKey(logicalKey);
                      setGlobalSecretKey(defaultSecretKey(currentGlobalSchema, logicalKey));
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select key" />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.keys(currentGlobalSchema?.envByLogicalKey ?? {}).map((key) => (
                        <SelectItem key={key} value={key}>
                          {key}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Secret Key</Label>
                  <Input value={globalSecretKey} onChange={(event) => setGlobalSecretKey(event.target.value)} />
                </div>
              </div>
              <div className="space-y-1">
                <Label>Secret Value</Label>
                <Input
                  type="password"
                  value={globalSecretValue}
                  onChange={(event) => setGlobalSecretValue(event.target.value)}
                />
              </div>
              <Button type="submit" disabled={globalMutation.isPending}>
                {globalMutation.isPending ? "Saving..." : "Save Global Secret"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Project Secrets</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead>K8s Secret</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(projectSecretsQuery.data ?? []).map((secret) => (
                  <TableRow key={secret.id}>
                    <TableCell>{secret.name}</TableCell>
                    <TableCell>{secret.provider}</TableCell>
                    <TableCell className="mono text-xs">{secret.k8sSecretName}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Global Secrets</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead>K8s Secret</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(globalSecretsQuery.data ?? []).map((secret) => (
                  <TableRow key={secret.id}>
                    <TableCell>{secret.name}</TableCell>
                    <TableCell>{secret.provider}</TableCell>
                    <TableCell className="mono text-xs">{secret.k8sSecretName}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
