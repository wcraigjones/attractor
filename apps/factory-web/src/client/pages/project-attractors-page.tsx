import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "../components/ui/toast";

import { createAttractor, getProjectAttractor, listAttractors } from "../lib/api";
import { buildProjectAttractorsViewRows, type AttractorRowStatus } from "../lib/attractors-view";
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

function statusVariant(status: AttractorRowStatus): "default" | "secondary" | "success" | "warning" {
  if (status === "Project") {
    return "default";
  }
  if (status === "Inherited") {
    return "success";
  }
  return "warning";
}

export function ProjectAttractorsPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId ?? "";
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [name, setName] = useState("");
  const [sourceLabel, setSourceLabel] = useState("");
  const [content, setContent] = useState(DEFAULT_DOT_TEMPLATE);
  const [defaultRunType, setDefaultRunType] = useState<"planning" | "implementation" | "task">("planning");
  const [modelProvider, setModelProvider] = useState("anthropic");
  const [modelId, setModelId] = useState("claude-sonnet-4-20250514");
  const [reasoningLevel, setReasoningLevel] = useState<"minimal" | "low" | "medium" | "high" | "xhigh">("high");
  const [description, setDescription] = useState("");

  const attractorsQuery = useQuery({
    queryKey: ["attractors", projectId],
    queryFn: () => listAttractors(projectId),
    enabled: projectId.length > 0
  });
  const effectiveRows = buildProjectAttractorsViewRows(attractorsQuery.data ?? []);

  const createMutation = useMutation({
    mutationFn: () =>
      createAttractor(projectId, {
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
        active: true
      }),
    onSuccess: () => {
      toast.success("Attractor saved");
      setName("");
      setDescription("");
      void queryClient.invalidateQueries({ queryKey: ["attractors", projectId] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  });

  const duplicateMutation = useMutation({
    mutationFn: async (input: { attractorId: string }) => {
      const detail = await getProjectAttractor(projectId, input.attractorId);
      if (!detail.content) {
        throw new Error("Cannot duplicate attractor with missing DOT content");
      }

      const existingNames = new Set((attractorsQuery.data ?? []).map((item) => item.name));
      const base = `${detail.attractor.name}-copy`;
      let nextName = base;
      let suffix = 2;
      while (existingNames.has(nextName)) {
        nextName = `${base}-${suffix}`;
        suffix += 1;
      }

      return createAttractor(projectId, {
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
      toast.success("Attractor duplicated");
      void queryClient.invalidateQueries({ queryKey: ["attractors", projectId] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  });

  return (
    <div>
      <PageTitle title="Project Attractors" description="Project attractors can override global attractors by name." />

      <div className="mb-4 flex items-center gap-2">
        <Badge variant="warning">Override Rule</Badge>
        <p className="text-sm text-muted-foreground">Global rows are muted when a project attractor uses the same name.</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[2fr,1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Effective Attractors</CardTitle>
            <CardDescription>Project rows first, then inherited global rows.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Source</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Storage Path</TableHead>
                  <TableHead>Version</TableHead>
                  <TableHead>Default Run</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Activity</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {effectiveRows.map((attractor) => (
                  <TableRow
                    key={attractor.id}
                    className={attractor.muted ? "bg-muted/20 text-muted-foreground hover:bg-muted/20" : undefined}
                  >
                    <TableCell>
                      <Badge variant={attractor.source === "project" ? "default" : "outline"}>
                        {attractor.source === "project" ? "Project" : "Global"}
                      </Badge>
                    </TableCell>
                    <TableCell>{attractor.name}</TableCell>
                    <TableCell className="mono text-xs">{attractor.location}</TableCell>
                    <TableCell>{attractor.contentVersion > 0 ? attractor.contentVersion : "-"}</TableCell>
                    <TableCell>{attractor.defaultRunType}</TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(attractor.status)}>{attractor.status}</Badge>
                      {!attractor.storageBacked ? <Badge variant="warning" className="ml-2">Legacy</Badge> : null}
                    </TableCell>
                    <TableCell>
                      <Badge variant={attractor.active ? "success" : "secondary"}>
                        {attractor.active ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        <Button asChild size="sm" variant="outline">
                          <Link to={`/projects/${projectId}/attractors/${attractor.attractorId}?tab=editor`}>Edit</Link>
                        </Button>
                        <Button asChild size="sm" variant="outline">
                          <Link to={`/projects/${projectId}/attractors/${attractor.attractorId}?tab=viewer`}>View</Link>
                        </Button>
                        <Button asChild size="sm" variant="outline">
                          <Link to={`/projects/${projectId}/attractors/${attractor.attractorId}?tab=viewer&panel=history`}>
                            History
                          </Link>
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            duplicateMutation.mutate({ attractorId: attractor.attractorId });
                          }}
                          disabled={duplicateMutation.isPending}
                        >
                          Duplicate
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!attractor.storageBacked || attractor.status === "Overridden" || !attractor.active}
                          onClick={() => {
                            navigate(`/projects/${projectId}/runs?attractorDefId=${attractor.attractorId}`);
                          }}
                        >
                          Run
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {effectiveRows.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">No project or global attractors have been configured yet.</p>
            ) : null}
            <p className="mt-3 text-sm text-muted-foreground">
              Legacy attractors without storage-backed content are read-only for new runs. Duplicate them to recreate as storage-backed definitions.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Create Attractor</CardTitle>
            <CardDescription>Add another attractor graph for this project.</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                if (!name.trim() || !content.trim() || !modelProvider.trim() || !modelId.trim()) {
                  toast.error("Name, DOT content, provider, and model are required");
                  return;
                }
                createMutation.mutate();
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
                <Label>Description</Label>
                <Textarea value={description} onChange={(event) => setDescription(event.target.value)} />
              </div>
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? "Saving..." : "Save Attractor"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
