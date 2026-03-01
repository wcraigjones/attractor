import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "../components/ui/toast";

import { getGlobalSecretValues, listGlobalSecrets, listProviderSchemas, upsertGlobalSecret } from "../lib/api";
import { ARBITRARY_SECRET_PROVIDER, formatSecretProvider } from "../lib/secrets-view";
import type { GlobalSecret, ProviderSchema } from "../lib/types";
import { PageTitle } from "../components/layout/page-title";
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

function firstKeyMapping(keyMappings: Record<string, string>): [string, string] {
  return Object.entries(keyMappings)[0] ?? ["", ""];
}

function maskSecretValue(value: string): string {
  if (!value) {
    return "••••••••";
  }
  return "•".repeat(Math.min(Math.max(value.length, 8), 16));
}

export function GlobalSecretsPage() {
  const queryClient = useQueryClient();

  const schemasQuery = useQuery({ queryKey: ["provider-schemas"], queryFn: listProviderSchemas });
  const globalSecretsQuery = useQuery({ queryKey: ["global-secrets"], queryFn: listGlobalSecrets });

  const [provider, setProvider] = useState("openai");
  const [name, setName] = useState("global-openai");
  const [logicalKey, setLogicalKey] = useState("apiKey");
  const [secretKey, setSecretKey] = useState("openai_api_key");
  const [secretValue, setSecretValue] = useState("");
  const [editingSecretId, setEditingSecretId] = useState<string | null>(null);
  const [revealedBySecretId, setRevealedBySecretId] = useState<Record<string, boolean>>({});
  const [valuesBySecretId, setValuesBySecretId] = useState<Record<string, Record<string, string>>>({});
  const [loadingBySecretId, setLoadingBySecretId] = useState<Record<string, boolean>>({});

  const schemaByProvider = useMemo(() => {
    return Object.fromEntries((schemasQuery.data ?? []).map((schema) => [schema.provider, schema]));
  }, [schemasQuery.data]);

  const arbitraryProvider = provider === ARBITRARY_SECRET_PROVIDER;
  const currentSchema = schemaByProvider[provider];

  useEffect(() => {
    const firstSchema = schemasQuery.data?.[0];
    if (!firstSchema || provider === ARBITRARY_SECRET_PROVIDER || schemaByProvider[provider]) {
      return;
    }
    const firstKey = firstLogicalKey(firstSchema);
    setProvider(firstSchema.provider);
    setName(`global-${firstSchema.provider}`);
    setLogicalKey(firstKey);
    setSecretKey(defaultSecretKey(firstSchema, firstKey));
  }, [provider, schemaByProvider, schemasQuery.data]);

  const loadValues = async (secretId: string): Promise<Record<string, string> | null> => {
    setLoadingBySecretId((current) => ({ ...current, [secretId]: true }));
    try {
      const values = await getGlobalSecretValues(secretId);
      setValuesBySecretId((current) => ({ ...current, [secretId]: values }));
      return values;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
      return null;
    } finally {
      setLoadingBySecretId((current) => ({ ...current, [secretId]: false }));
    }
  };

  const toggleSecretVisibility = async (secret: GlobalSecret): Promise<void> => {
    if (revealedBySecretId[secret.id]) {
      setRevealedBySecretId((current) => ({ ...current, [secret.id]: false }));
      return;
    }

    let values: Record<string, string> | undefined = valuesBySecretId[secret.id];
    if (!values) {
      const loadedValues = await loadValues(secret.id);
      if (!loadedValues) {
        return;
      }
      values = loadedValues;
    }

    setRevealedBySecretId((current) => ({ ...current, [secret.id]: true }));
  };

  const beginEdit = async (secret: GlobalSecret): Promise<void> => {
    const [mappedLogicalKey, mappedSecretKey] = firstKeyMapping(secret.keyMappings);
    const schema = schemaByProvider[secret.provider];
    setEditingSecretId(secret.id);
    setName(secret.name);
    setProvider(secret.provider);

    if (secret.provider === ARBITRARY_SECRET_PROVIDER) {
      setLogicalKey("secret");
      setSecretKey(mappedSecretKey || mappedLogicalKey || "custom_secret");
    } else {
      const nextLogicalKey = mappedLogicalKey || firstLogicalKey(schema);
      setLogicalKey(nextLogicalKey);
      setSecretKey(mappedSecretKey || defaultSecretKey(schema, nextLogicalKey));
    }

    let values: Record<string, string> | undefined = valuesBySecretId[secret.id];
    if (!values) {
      const loadedValues = await loadValues(secret.id);
      if (loadedValues) {
        values = loadedValues;
      }
    }
    if (!values) {
      setSecretValue("");
      return;
    }

    const valueKey = mappedSecretKey || mappedLogicalKey || Object.keys(values)[0] || "";
    setSecretValue(valueKey ? values[valueKey] ?? "" : "");
  };

  const clearEdit = () => {
    setEditingSecretId(null);
    setSecretValue("");
  };

  const mutation = useMutation({
    mutationFn: () =>
      {
        const trimmedSecretKey = secretKey.trim();
        const keyMappings = arbitraryProvider
          ? { [trimmedSecretKey]: trimmedSecretKey }
          : { [logicalKey]: trimmedSecretKey };
        return upsertGlobalSecret({
          name: name.trim(),
          provider,
          keyMappings,
          values: { [trimmedSecretKey]: secretValue }
        });
    },
    onSuccess: () => {
      toast.success("Global secret saved");
      if (editingSecretId) {
        setValuesBySecretId((current) => {
          const next = { ...current };
          delete next[editingSecretId];
          return next;
        });
        setRevealedBySecretId((current) => ({ ...current, [editingSecretId]: false }));
      }
      setEditingSecretId(null);
      setSecretValue("");
      void queryClient.invalidateQueries({ queryKey: ["global-secrets"] });
      void queryClient.invalidateQueries({ queryKey: ["project-secrets"] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  });

  return (
    <div>
      <PageTitle
        title="Global Secrets"
        description="Shared across all projects. Supports provider-mapped and arbitrary key/value secrets."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{editingSecretId ? "Edit Global Secret" : "Global Secret"}</CardTitle>
            <CardDescription>Set default provider credentials or arbitrary secret keys for every project namespace.</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="grid gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                if (!secretValue.trim()) {
                  toast.error("Global secret value is required");
                  return;
                }
                if (!name.trim() || !secretKey.trim()) {
                  toast.error("Global secret name and key are required");
                  return;
                }
                if (!arbitraryProvider && !logicalKey.trim()) {
                  toast.error("Logical key is required for provider-mapped secrets");
                  return;
                }
                mutation.mutate();
              }}
            >
              <div className="space-y-1">
                <Label>Secret Name</Label>
                <Input value={name} onChange={(event) => setName(event.target.value)} />
              </div>

              <div className="space-y-1">
                <Label>Provider</Label>
                <Select
                  value={provider}
                  onValueChange={(nextProvider) => {
                    setEditingSecretId(null);
                    if (nextProvider === ARBITRARY_SECRET_PROVIDER) {
                      setProvider(nextProvider);
                      setName("global-custom");
                      setLogicalKey("secret");
                      setSecretKey("custom_secret");
                      return;
                    }
                    const schema = schemaByProvider[nextProvider];
                    const firstKey = firstLogicalKey(schema);
                    setProvider(nextProvider);
                    setName(`global-${nextProvider}`);
                    setLogicalKey(firstKey);
                    setSecretKey(defaultSecretKey(schema, firstKey));
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
                  <Input value={secretKey} onChange={(event) => setSecretKey(event.target.value)} />
                </div>
              ) : (
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-1">
                    <Label>Logical Key</Label>
                    <Select
                      value={logicalKey}
                      onValueChange={(nextLogicalKey) => {
                        setLogicalKey(nextLogicalKey);
                        setSecretKey(defaultSecretKey(currentSchema, nextLogicalKey));
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select key" />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.keys(currentSchema?.envByLogicalKey ?? {}).map((key) => (
                          <SelectItem key={key} value={key}>
                            {key}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1">
                    <Label>Secret Key</Label>
                    <Input value={secretKey} onChange={(event) => setSecretKey(event.target.value)} />
                  </div>
                </div>
              )}

              <div className="space-y-1">
                <Label>Secret Value</Label>
                <Input type="password" value={secretValue} onChange={(event) => setSecretValue(event.target.value)} />
              </div>

              <div className="flex items-center gap-2">
                <Button type="submit" disabled={mutation.isPending}>
                  {mutation.isPending ? "Saving..." : editingSecretId ? "Update Global Secret" : "Save Global Secret"}
                </Button>
                {editingSecretId ? (
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
            <CardTitle>Saved Global Secrets</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead>Secret Keys</TableHead>
                  <TableHead>Value</TableHead>
                  <TableHead>K8s Secret</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(globalSecretsQuery.data ?? []).map((secret) => {
                  const loadedValues = valuesBySecretId[secret.id] ?? {};
                  const mappedKeys = Array.from(new Set(Object.values(secret.keyMappings)));
                  const keys = mappedKeys.length > 0 ? mappedKeys : Object.keys(loadedValues);
                  const revealed = revealedBySecretId[secret.id] === true;
                  const loading = loadingBySecretId[secret.id] === true;

                  return (
                    <TableRow key={secret.id}>
                      <TableCell>{secret.name}</TableCell>
                      <TableCell>{formatSecretProvider(secret.provider)}</TableCell>
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
                      <TableCell className="mono text-xs">{secret.k8sSecretName}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            disabled={loading}
                            onClick={() => {
                              void toggleSecretVisibility(secret);
                            }}
                          >
                            {loading ? "Loading..." : revealed ? "Hide" : "Show"}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              void beginEdit(secret);
                            }}
                          >
                            Edit
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
