import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "../components/ui/toast";

import { createProject, listProjects } from "../lib/api";
import { PageTitle } from "../components/layout/page-title";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";

export function ProjectsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [namespace, setNamespace] = useState("");

  const query = useQuery({ queryKey: ["projects"], queryFn: listProjects });

  const search = searchParams.get("q") ?? "";

  const createMutation = useMutation({
    mutationFn: createProject,
    onSuccess: (project) => {
      toast.success(`Project ${project.name} created`);
      setName("");
      setNamespace("");
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  });

  const filteredProjects = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) {
      return query.data ?? [];
    }
    return (query.data ?? []).filter((project) => {
      return (
        project.name.toLowerCase().includes(needle) ||
        project.namespace.toLowerCase().includes(needle) ||
        (project.repoFullName ?? "").toLowerCase().includes(needle)
      );
    });
  }, [query.data, search]);

  return (
    <div>
      <PageTitle
        title="Projects"
        description="Create project namespaces and connect repositories."
        actions={
          <Button asChild variant="outline">
            <Link to="/setup">Setup Wizard</Link>
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[2fr,1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Project Registry</CardTitle>
            <CardDescription>Search and open project spaces.</CardDescription>
          </CardHeader>
          <CardContent>
            <Input
              value={search}
              onChange={(event) => {
                const next = event.target.value;
                const params = new URLSearchParams(searchParams);
                if (next.trim().length > 0) {
                  params.set("q", next);
                } else {
                  params.delete("q");
                }
                setSearchParams(params, { replace: true });
              }}
              placeholder="Search by name, namespace, or repo"
              className="mb-3"
            />
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Namespace</TableHead>
                  <TableHead>Repository</TableHead>
                  <TableHead className="w-[120px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredProjects.map((project) => (
                  <TableRow key={project.id}>
                    <TableCell>{project.name}</TableCell>
                    <TableCell className="mono text-xs">{project.namespace}</TableCell>
                    <TableCell>{project.repoFullName ?? "Not connected"}</TableCell>
                    <TableCell>
                      <Button asChild size="sm" variant="outline">
                        <Link to={`/projects/${project.id}`}>Open</Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {filteredProjects.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">No projects match your search.</p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Create Project</CardTitle>
            <CardDescription>
              Namespace defaults to <span className="mono">factory-proj-slug</span> when blank.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                if (name.trim().length < 2) {
                  toast.error("Project name must be at least 2 characters");
                  return;
                }
                createMutation.mutate({
                  name: name.trim(),
                  namespace: namespace.trim().length > 0 ? namespace.trim() : undefined
                });
              }}
            >
              <div className="space-y-1">
                <Label htmlFor="project-name">Project Name</Label>
                <Input id="project-name" value={name} onChange={(event) => setName(event.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="project-namespace">Namespace (optional)</Label>
                <Input
                  id="project-namespace"
                  value={namespace}
                  onChange={(event) => setNamespace(event.target.value)}
                />
              </div>
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? "Creating..." : "Create Project"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
