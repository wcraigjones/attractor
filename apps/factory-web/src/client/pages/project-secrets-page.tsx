import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "../components/ui/toast";

import {
  getGlobalSecretValues,
  getProjectSecretValues,
  listGlobalSecrets,
  listProjectSecrets,
  listProviderSchemas,
  upsertProjectSecret
} from "../lib/api";
import {
  ARBITRARY_SECRET_PROVIDER,
  buildProjectSecretsViewRows,
  formatSecretProvider,
  type SecretRowStatus,
  type SecretViewRow
} from "../lib/secrets-view";
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

function statusVariant(status: SecretRowStatus): "default" | "secondary" | "success" | "warning" {
  if (status === "Project") {
    return "default";
  }
  if (status === "Inherited") {
    return "success";
  }
  if (status === "Partially Overridden") {
    return "warning";
  }
  return "secondary";
}

function firstKeyMapping(keyMappings: Record<string, string>): [string, string] {
  return Object.entries(keyMappings)[0] ?? ["", ""];
}

function maskSecretValue(value: string): string {
  if (!value) {
    return "••••••••";
  }
  return "•".repeat(Math.min(Math.max(value.length, 8), 16));
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
  const [editingProjectSecretId, setEditingProjectSecretId] = useState<string | null>(null);
  const [revealedByRowId, setRevealedByRowId] = useState<Record<string, boolean>>({});
  const [valuesByRowId, setValuesByRowId] = useState<Record<string, Record<string, string>>>({});
  const [loadingByRowId, setLoadingByRowId] = useState<Record<string, boolean>>({});

  const schemaByProvider = useMemo(() => {
    return Object.fromEntries((schemasQuery.data ?? []).map((schema) => [schema.provider, schema]));
  }, [schemasQuery.data]);

  const arbitraryProvider = projectProvider === ARBITRARY_SECRET_PROVIDER;
  const currentProjectSchema = schemaByProvider[projectProvider];

  const effectiveRows = useMemo(
    () => buildProjectSecretsViewRows(projectSecretsQuery.data ?? [], globalSecretsQuery.data ?? []),
    [globalSecretsQuery.data, projectSecretsQuery.data]
  );

  useEffect(() => {
    const firstSchema = schemasQuery.data?.[0];
    if (!firstSchema || projectProvider === ARBITRARY_SECRET_PROVIDER || schemaByProvider[projectProvider]) {
      return;
    }

    const logicalKey = firstLogicalKey(firstSchema);
    setProjectProvider(firstSchema.provider);
    setProjectName(`llm-${firstSchema.provider}`);
    setProjectLogicalKey(logicalKey);
    setProjectSecretKey(defaultSecretKey(firstSchema, logicalKey));
  }, [projectProvider, schemaByProvider, schemasQuery.data]);

  const loadValues = async (row: SecretViewRow): Promise<Record<string, string> | null> => {
    setLoadingByRowId((current) => ({ ...current, [row.id]: true }));
    try {
      const values =
        row.source === "project"
          ? await getProjectSecretValues(projectId, row.secretId)
          : await getGlobalSecretValues(row.secretId);
      setValuesByRowId((current) => ({ ...current, [row.id]: values }));
      return values;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
      return null;
    } finally {
      setLoadingByRowId((current) => ({ ...current, [row.id]: false }));
    }
  };

  const toggleRowVisibility = async (row: SecretViewRow): Promise<void> => {
    if (revealedByRowId[row.id]) {
      setRevealedByRowId((current) => ({ ...current, [row.id]: false }));
      return;
    }

    let values: Record<string, string> | undefined = valuesByRowId[row.id];
    if (!values) {
      const loadedValues = await loadValues(row);
      if (!loadedValues) {
        return;
      }
      values = loadedValues;
    }

    setRevealedByRowId((current) => ({ ...current, [row.id]: true }));
  };

  const beginEdit = async (row: SecretViewRow): Promise<void> => {
    if (row.source !== "project") {
      return;
    }

    const [mappedLogicalKey, mappedSecretKey] = firstKeyMapping(row.keyMappings);
    const schema = schemaByProvider[row.provider];
    setEditingProjectSecretId(row.secretId);
    setProjectProvider(row.provider);
    setProjectName(row.name);

    if (row.provider === ARBITRARY_SECRET_PROVIDER) {
      setProjectLogicalKey("secret");
      setProjectSecretKey(mappedSecretKey || mappedLogicalKey || "custom_secret");
    } else {
      const nextLogicalKey = mappedLogicalKey || firstLogicalKey(schema);
      setProjectLogicalKey(nextLogicalKey);
      setProjectSecretKey(mappedSecretKey || defaultSecretKey(schema, nextLogicalKey));
    }

    let values: Record<string, string> | undefined = valuesByRowId[row.id];
    if (!values) {
      const loadedValues = await loadValues(row);
      if (loadedValues) {
        values = loadedValues;
      }
    }
    if (!values) {
      setProjectSecretValue("");
      return;
    }

    const valueKey = mappedSecretKey || mappedLogicalKey || Object.keys(values)[0] || "";
    setProjectSecretValue(valueKey ? values[valueKey] ?? "" : "");
  };

  const clearEdit = () => {
    setEditingProjectSecretId(null);
    setProjectSecretValue("");
  };

  const projectMutation = useMutation({
    mutationFn: () =>
      {
        const trimmedSecretKey = projectSecretKey.trim();
        const keyMappings = arbitraryProvider
          ? { [trimmedSecretKey]: trimmedSecretKey }
          : { [projectLogicalKey]: trimmedSecretKey };
        return upsertProjectSecret(projectId, {
          name: projectName.trim(),
          provider: projectProvider,
          keyMappings,
          values: { [trimmedSecretKey]: projectSecretValue }
        });
      },
    onSuccess: () => {
      toast.success("Project secret saved");
      if (editingProjectSecretId) {
        const rowId = `project:${editingProjectSecretId}`;
        setValuesByRowId((current) => {
          const next = { ...current };
          delete next[rowId];
          return next;
        });
        setRevealedByRowId((current) => ({ ...current, [rowId]: false }));
      }
      setEditingProjectSecretId(null);
      setProjectSecretValue("");
      void queryClient.invalidateQueries({ queryKey: ["project-secrets", projectId] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  });

  return (
    <div>
      <PageTitle
        title="Project Secrets"
        description="Project secrets support provider-mapped and arbitrary key/value entries."
      />

      <div className="mb-4 flex items-center gap-2">
        <Badge variant="warning">Override Rule</Badge>
        <p className="text-sm text-muted-foreground">
          Inherited global rows are muted when project secrets overlap on mapped keys.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr,2fr]">
        <Card>
          <CardHeader>
            <CardTitle>{editingProjectSecretId ? "Edit Project Secret" : "Project Secret"}</CardTitle>
            <CardDescription>Stored in project namespace and used first for provider auth and custom config.</CardDescription>
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
                if (!projectName.trim() || !projectSecretKey.trim()) {
                  toast.error("Project secret name and key are required");
                  return;
                }
                if (!arbitraryProvider && !projectLogicalKey.trim()) {
                  toast.error("Logical key is required for provider-mapped secrets");
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
                    setEditingProjectSecretId(null);
                    if (provider === ARBITRARY_SECRET_PROVIDER) {
                      setProjectProvider(provider);
                      setProjectName("project-custom");
                      setProjectLogicalKey("secret");
                      setProjectSecretKey("custom_secret");
                      return;
                    }
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
                    <SelectItem value={ARBITRARY_SECRET_PROVIDER}>arbitrary</SelectItem>
                    {(schemasQuery.data ?? []).map((schema) => (
                      <SelectItem key={schema.provider} value={schema.provider}>
                        {schema.provider}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {arbitraryProvider ? (
                <div className="space-y-1">
                  <Label>Secret Key</Label>
                  <Input value={projectSecretKey} onChange={(event) => setProjectSecretKey(event.target.value)} />
                </div>
              ) : (
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
              )}
              <div className="space-y-1">
                <Label>Secret Value</Label>
                <Input
                  type="password"
                  value={projectSecretValue}
                  onChange={(event) => setProjectSecretValue(event.target.value)}
                />
              </div>
              <div className="flex items-center gap-2">
                <Button type="submit" disabled={projectMutation.isPending}>
                  {projectMutation.isPending ? "Saving..." : editingProjectSecretId ? "Update Project Secret" : "Save Project Secret"}
                </Button>
                {editingProjectSecretId ? (
                  <Button type="button" variant="outline" onClick={clearEdit}>
                    Cancel Edit
                  </Button>
                ) : null}
              </div>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Effective Secrets</CardTitle>
            <CardDescription>
              Project secrets are listed first. Global secrets appear as inherited rows and are muted when overridden.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Source</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Secret Keys</TableHead>
                  <TableHead>Value</TableHead>
                  <TableHead>K8s Secret</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {effectiveRows.map((row) => {
                  const loadedValues = valuesByRowId[row.id] ?? {};
                  const mappedKeys = Array.from(new Set(Object.values(row.keyMappings)));
                  const keys = mappedKeys.length > 0 ? mappedKeys : Object.keys(loadedValues);
                  const revealed = revealedByRowId[row.id] === true;
                  const loading = loadingByRowId[row.id] === true;

                  return (
                    <TableRow
                      key={row.id}
                      className={row.muted ? "bg-muted/20 text-muted-foreground hover:bg-muted/20" : undefined}
                    >
                      <TableCell>
                        <Badge variant={row.source === "project" ? "default" : "outline"}>
                          {row.source === "project" ? "Project" : "Global"}
                        </Badge>
                      </TableCell>
                      <TableCell>{row.name}</TableCell>
                      <TableCell>{formatSecretProvider(row.provider)}</TableCell>
                      <TableCell>
                        <Badge variant={statusVariant(row.status)}>{row.status}</Badge>
                      </TableCell>
                      <TableCell className="mono text-xs">
                        {keys.length > 0 ? keys.join(", ") : <span className="text-muted-foreground">none</span>}
                      </TableCell>
                      <TableCell className="mono text-xs">
                        {keys.length === 0 ? (
                          <span className="text-muted-foreground">No mapped keys</span>
                        ) : (
                          keys.map((key) => {
                            const value = loadedValues[key] ?? "";
                            return (
                              <div key={key}>
                                {key}: {revealed ? value || "(empty)" : maskSecretValue(value)}
                              </div>
                            );
                          })
                        )}
                      </TableCell>
                      <TableCell className="mono text-xs">{row.k8sSecretName}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            disabled={loading}
                            onClick={() => {
                              void toggleRowVisibility(row);
                            }}
                          >
                            {loading ? "Loading..." : revealed ? "Hide" : "Show"}
                          </Button>
                          {row.source === "project" ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                void beginEdit(row);
                              }}
                            >
                              Edit
                            </Button>
                          ) : (
                            <span className="text-xs text-muted-foreground">Global</span>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            {effectiveRows.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">No project or global secrets have been configured yet.</p>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
