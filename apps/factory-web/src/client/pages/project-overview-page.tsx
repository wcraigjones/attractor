import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import {
  connectProjectRepo,
  listAttractors,
  listProjectRuns,
  listProjects,
  listProjectSecrets
} from "../lib/api";
import { PageTitle } from "../components/layout/page-title";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";

export function ProjectOverviewPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId ?? "";
  const queryClient = useQueryClient();

  const [installationId, setInstallationId] = useState("");
  const [repoFullName, setRepoFullName] = useState("");
  const [defaultBranch, setDefaultBranch] = useState("main");

  const projectsQuery = useQuery({ queryKey: ["projects"], queryFn: listProjects });
  const runsQuery = useQuery({
    queryKey: ["project-runs", projectId],
    queryFn: () => listProjectRuns(projectId),
    enabled: projectId.length > 0
  });
  const attractorsQuery = useQuery({
    queryKey: ["attractors", projectId],
    queryFn: () => listAttractors(projectId),
    enabled: projectId.length > 0
  });
  const secretsQuery = useQuery({
    queryKey: ["project-secrets", projectId],
    queryFn: () => listProjectSecrets(projectId),
    enabled: projectId.length > 0
  });

  const project = useMemo(
    () => projectsQuery.data?.find((candidate) => candidate.id === projectId),
    [projectsQuery.data, projectId]
  );

  const connectMutation = useMutation({
    mutationFn: (input: { installationId: string; repoFullName: string; defaultBranch: string }) =>
      connectProjectRepo(projectId, input),
    onSuccess: () => {
      toast.success("Repository connection saved");
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  });

  if (!project) {
    return <p className="text-sm text-muted-foreground">Project not found.</p>;
  }

  return (
    <div>
      <PageTitle
        title={project.name}
        description={`Namespace: ${project.namespace}`}
        actions={
          <Button asChild variant="outline">
            <Link to={`/projects/${project.id}/runs`}>Start Run</Link>
          </Button>
        }
      />

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardDescription>Runs</CardDescription>
            <CardTitle>{runsQuery.data?.length ?? 0}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Attractors</CardDescription>
            <CardTitle>{attractorsQuery.data?.length ?? 0}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Project Secrets</CardDescription>
            <CardTitle>{secretsQuery.data?.length ?? 0}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-[2fr,1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Repository Connection</CardTitle>
            <CardDescription>GitHub App installation metadata for branch + PR operations.</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="grid gap-3 md:grid-cols-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (!installationId.trim() || !repoFullName.trim() || !defaultBranch.trim()) {
                  toast.error("Installation ID, repository, and default branch are required");
                  return;
                }
                connectMutation.mutate({
                  installationId: installationId.trim(),
                  repoFullName: repoFullName.trim(),
                  defaultBranch: defaultBranch.trim()
                });
              }}
            >
              <div className="space-y-1">
                <Label htmlFor="installation-id">Installation ID</Label>
                <Input
                  id="installation-id"
                  value={installationId}
                  onChange={(event) => setInstallationId(event.target.value)}
                  placeholder={project.githubInstallationId ?? "123456"}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="repo-name">Repository</Label>
                <Input
                  id="repo-name"
                  value={repoFullName}
                  onChange={(event) => setRepoFullName(event.target.value)}
                  placeholder={project.repoFullName ?? "owner/repo"}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="default-branch">Default Branch</Label>
                <Input
                  id="default-branch"
                  value={defaultBranch}
                  onChange={(event) => setDefaultBranch(event.target.value)}
                  placeholder={project.defaultBranch ?? "main"}
                />
              </div>
              <div className="flex items-end">
                <Button type="submit" disabled={connectMutation.isPending}>
                  {connectMutation.isPending ? "Saving..." : "Save Connection"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Context</CardTitle>
            <CardDescription>Current project metadata.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>
              <span className="text-muted-foreground">Repo:</span> {project.repoFullName ?? "Not connected"}
            </p>
            <p>
              <span className="text-muted-foreground">Default branch:</span> {project.defaultBranch ?? "-"}
            </p>
            <p>
              <span className="text-muted-foreground">GitHub installation:</span> {project.githubInstallationId ?? "-"}
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
