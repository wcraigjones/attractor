import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { listGlobalAttractors, upsertGlobalAttractor } from "../lib/api";
import { PageTitle } from "../components/layout/page-title";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { Textarea } from "../components/ui/textarea";

export function GlobalAttractorsPage() {
  const queryClient = useQueryClient();

  const [name, setName] = useState("global-self-bootstrap");
  const [repoPath, setRepoPath] = useState("factory/self-bootstrap.dot");
  const [defaultRunType, setDefaultRunType] = useState<"planning" | "implementation" | "task">("planning");
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
        repoPath: repoPath.trim(),
        defaultRunType,
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
                if (!name.trim() || !repoPath.trim()) {
                  toast.error("Global attractor name and repository path are required");
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
                <Label>Repo Path</Label>
                <Input value={repoPath} onChange={(event) => setRepoPath(event.target.value)} />
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
                  <TableHead>Repo Path</TableHead>
                  <TableHead>Default Run</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(globalAttractorsQuery.data ?? []).map((attractor) => (
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
      </div>
    </div>
  );
}
