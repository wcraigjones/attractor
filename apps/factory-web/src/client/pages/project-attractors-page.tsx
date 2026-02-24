import { useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { createAttractor, listAttractors } from "../lib/api";
import { PageTitle } from "../components/layout/page-title";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { Textarea } from "../components/ui/textarea";

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
      <PageTitle title="Attractors" description="Register multiple attractor graph files per project." />

      <div className="grid gap-4 lg:grid-cols-[2fr,1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Attractor Registry</CardTitle>
            <CardDescription>Paths are repo-relative graph files.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Path</TableHead>
                  <TableHead>Default Run</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(attractorsQuery.data ?? []).map((attractor) => (
                  <TableRow key={attractor.id}>
                    <TableCell>{attractor.name}</TableCell>
                    <TableCell className="mono text-xs">{attractor.repoPath}</TableCell>
                    <TableCell>{attractor.defaultRunType}</TableCell>
                    <TableCell>
                      <Badge variant={attractor.active ? "success" : "secondary"}>
                        {attractor.active ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
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
