import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "../components/ui/toast";

import { getGlobalAttractor, listGlobalAttractors, upsertGlobalAttractor } from "../lib/api";
import { PageTitle } from "../components/layout/page-title";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { Textarea } from "../components/ui/textarea";

const DEFAULT_DOT_TEMPLATE = `digraph attractor {
  start [shape=Mdiamond, type="start", label="Start"];
  done [shape=Msquare, type="exit", label="Done"];
  start -> done;
}`;

export function GlobalAttractorsPage() {
  const queryClient = useQueryClient();

  const [name, setName] = useState("global-self-bootstrap");
  const [sourceLabel, setSourceLabel] = useState("");
  const [content, setContent] = useState(DEFAULT_DOT_TEMPLATE);
  const [defaultRunType, setDefaultRunType] = useState<"planning" | "implementation" | "task">("planning");
  const [modelProvider, setModelProvider] = useState("anthropic");
  const [modelId, setModelId] = useState("claude-sonnet-4-20250514");
  const [reasoningLevel, setReasoningLevel] = useState<"minimal" | "low" | "medium" | "high" | "xhigh">("high");
  const [description, setDescription] = useState("");
  const [active, setActive] = useState(true);

  const globalAttractorsQuery = useQuery({
    queryKey: ["global-attractors"],
    queryFn: listGlobalAttractors
  });

  const mutation = useMutation({
    mutationFn: () =>
      upsertGlobalAttractor({
        name: name.trim(),
        content,
        ...(sourceLabel.trim().length > 0 ? { repoPath: sourceLabel.trim() } : {}),
        defaultRunType,
        modelConfig: {
          provider: modelProvider.trim(),
          modelId: modelId.trim(),
          reasoningLevel,
          temperature: 0.2
        },
        description: description.trim().length > 0 ? description.trim() : undefined,
        active
      }),
    onSuccess: () => {
      toast.success("Global attractor saved");
      void queryClient.invalidateQueries({ queryKey: ["global-attractors"] });
      void queryClient.invalidateQueries({ queryKey: ["attractors"] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  });

  const duplicateMutation = useMutation({
    mutationFn: async (input: { attractorId: string }) => {
      const detail = await getGlobalAttractor(input.attractorId);
      if (!detail.content) {
        throw new Error("Cannot duplicate global attractor with missing DOT content");
      }

      const existingNames = new Set((globalAttractorsQuery.data ?? []).map((item) => item.name));
      const base = `${detail.attractor.name}-copy`;
      let nextName = base;
      let suffix = 2;
      while (existingNames.has(nextName)) {
        nextName = `${base}-${suffix}`;
        suffix += 1;
      }

      return upsertGlobalAttractor({
        name: nextName,
        content: detail.content,
        ...(detail.attractor.repoPath ? { repoPath: detail.attractor.repoPath } : {}),
        defaultRunType: detail.attractor.defaultRunType,
        modelConfig:
          detail.attractor.modelConfig ?? {
            provider: modelProvider.trim(),
            modelId: modelId.trim(),
            reasoningLevel,
            temperature: 0.2
          },
        ...(detail.attractor.description ? { description: detail.attractor.description } : {}),
        active: detail.attractor.active
      });
    },
    onSuccess: () => {
      toast.success("Global attractor duplicated");
      void queryClient.invalidateQueries({ queryKey: ["global-attractors"] });
      void queryClient.invalidateQueries({ queryKey: ["attractors"] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  });

  return (
    <div>
      <PageTitle
        title="Global Attractors"
        description="Shared across all projects. Project attractors with the same name override global attractors."
      />

      <div className="grid gap-4 lg:grid-cols-[1fr,2fr]">
        <Card>
          <CardHeader>
            <CardTitle>Global Attractor</CardTitle>
            <CardDescription>Save a default attractor definition for all projects.</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                if (!name.trim() || !content.trim() || !modelProvider.trim() || !modelId.trim()) {
                  toast.error("Global attractor name, DOT content, provider, and model are required");
                  return;
                }
                mutation.mutate();
              }}
            >
              <div className="space-y-1">
                <Label>Name</Label>
                <Input value={name} onChange={(event) => setName(event.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Source Label (optional)</Label>
                <Input
                  value={sourceLabel}
                  onChange={(event) => setSourceLabel(event.target.value)}
                  placeholder="factory/self-bootstrap.dot"
                />
              </div>
              <div className="space-y-1">
                <Label>DOT Content</Label>
                <Textarea
                  value={content}
                  onChange={(event) => setContent(event.target.value)}
                  className="min-h-[220px] font-mono text-xs"
                />
              </div>
              <div className="space-y-1">
                <Label>Default Run Type</Label>
                <Select value={defaultRunType} onValueChange={(value: "planning" | "implementation" | "task") => setDefaultRunType(value)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="planning">planning</SelectItem>
                    <SelectItem value="implementation">implementation</SelectItem>
                    <SelectItem value="task">task</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Model Provider</Label>
                <Input value={modelProvider} onChange={(event) => setModelProvider(event.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Model ID</Label>
                <Input value={modelId} onChange={(event) => setModelId(event.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Reasoning</Label>
                <Select
                  value={reasoningLevel}
                  onValueChange={(value: "minimal" | "low" | "medium" | "high" | "xhigh") => setReasoningLevel(value)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="minimal">minimal</SelectItem>
                    <SelectItem value="low">low</SelectItem>
                    <SelectItem value="medium">medium</SelectItem>
                    <SelectItem value="high">high</SelectItem>
                    <SelectItem value="xhigh">xhigh</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Status</Label>
                <Select value={active ? "active" : "inactive"} onValueChange={(value) => setActive(value === "active")}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Description</Label>
                <Textarea value={description} onChange={(event) => setDescription(event.target.value)} />
              </div>
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending ? "Saving..." : "Save Global Attractor"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Saved Global Attractors</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Storage Path</TableHead>
                  <TableHead>Version</TableHead>
                  <TableHead>Default Run</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(globalAttractorsQuery.data ?? []).map((attractor) => (
                  <TableRow key={attractor.id}>
                    <TableCell>{attractor.name}</TableCell>
                    <TableCell className="mono text-xs">{attractor.contentPath ?? attractor.repoPath ?? "-"}</TableCell>
                    <TableCell>{attractor.contentVersion > 0 ? attractor.contentVersion : "-"}</TableCell>
                    <TableCell>{attractor.defaultRunType}</TableCell>
                    <TableCell>
                      <Badge variant={attractor.active ? "success" : "secondary"}>
                        {attractor.active ? "Active" : "Inactive"}
                      </Badge>
                      {!attractor.contentPath ? <Badge variant="warning" className="ml-2">Legacy</Badge> : null}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        <Button asChild size="sm" variant="outline">
                          <Link to={`/attractors/global/${attractor.id}?tab=editor`}>Edit</Link>
                        </Button>
                        <Button asChild size="sm" variant="outline">
                          <Link to={`/attractors/global/${attractor.id}?tab=viewer`}>View</Link>
                        </Button>
                        <Button asChild size="sm" variant="outline">
                          <Link to={`/attractors/global/${attractor.id}?tab=viewer&panel=history`}>History</Link>
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            duplicateMutation.mutate({ attractorId: attractor.id });
                          }}
                          disabled={duplicateMutation.isPending}
                        >
                          Duplicate
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <p className="mt-3 text-sm text-muted-foreground">
              Legacy attractors without storage-backed content are visible for compatibility, but new runs require storage-backed content.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
