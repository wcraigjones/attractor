import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { listGlobalSecrets, listProviderSchemas, upsertGlobalSecret } from "../lib/api";
import { ARBITRARY_SECRET_PROVIDER, formatSecretProvider } from "../lib/secrets-view";
import type { ProviderSchema } from "../lib/types";
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

export function GlobalSecretsPage() {
  const queryClient = useQueryClient();

  const schemasQuery = useQuery({ queryKey: ["provider-schemas"], queryFn: listProviderSchemas });
  const globalSecretsQuery = useQuery({ queryKey: ["global-secrets"], queryFn: listGlobalSecrets });

  const [provider, setProvider] = useState("openai");
  const [name, setName] = useState("global-openai");
  const [logicalKey, setLogicalKey] = useState("apiKey");
  const [secretKey, setSecretKey] = useState("openai_api_key");
  const [secretValue, setSecretValue] = useState("");

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
            <CardTitle>Global Secret</CardTitle>
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

              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending ? "Saving..." : "Save Global Secret"}
              </Button>
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
                  <TableHead>K8s Secret</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(globalSecretsQuery.data ?? []).map((secret) => (
                  <TableRow key={secret.id}>
                    <TableCell>{secret.name}</TableCell>
                    <TableCell>{formatSecretProvider(secret.provider)}</TableCell>
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
