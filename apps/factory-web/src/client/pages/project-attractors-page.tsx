import { useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { createAttractor, listAttractors } from "../lib/api";
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
  const queryClient = useQueryClient();

  const [name, setName] = useState("");
  const [repoPath, setRepoPath] = useState("factory/self-bootstrap.dot");
  const [defaultRunType, setDefaultRunType] = useState<"planning" | "implementation">("planning");
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
        repoPath: repoPath.trim(),
        defaultRunType,
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
                  <TableHead>Path</TableHead>
                  <TableHead>Default Run</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Activity</TableHead>
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
                    <TableCell className="mono text-xs">{attractor.repoPath}</TableCell>
                    <TableCell>{attractor.defaultRunType}</TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(attractor.status)}>{attractor.status}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={attractor.active ? "success" : "secondary"}>
                        {attractor.active ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {effectiveRows.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">No project or global attractors have been configured yet.</p>
            ) : null}
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
                if (!name.trim() || !repoPath.trim()) {
                  toast.error("Name and repository path are required");
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
                <Label>Repo Path</Label>
                <Input value={repoPath} onChange={(event) => setRepoPath(event.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Default Run Type</Label>
                <Select value={defaultRunType} onValueChange={(value: "planning" | "implementation") => setDefaultRunType(value)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="planning">planning</SelectItem>
                    <SelectItem value="implementation">implementation</SelectItem>
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
