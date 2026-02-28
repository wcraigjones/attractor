import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import {
  connectProjectRepo,
  listEnvironments,
  listAttractors,
  listProjectRuns,
  listProjects,
  listProjectSecrets,
  setProjectDefaultEnvironment
} from "../lib/api";
import { buildEffectiveAttractors } from "../lib/attractors-view";
import { getInactiveDefaultEnvironment, listActiveEnvironments } from "../lib/environments-view";
import { PageTitle } from "../components/layout/page-title";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";

export function ProjectOverviewPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId ?? "";
  const queryClient = useQueryClient();

  const [installationId, setInstallationId] = useState("");
  const [repoFullName, setRepoFullName] = useState("");
  const [defaultBranch, setDefaultBranch] = useState("main");
  const [selectedDefaultEnvironmentId, setSelectedDefaultEnvironmentId] = useState("");

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
  const environmentsQuery = useQuery({
    queryKey: ["environments"],
    queryFn: listEnvironments
  });

  const project = useMemo(
    () => projectsQuery.data?.find((candidate) => candidate.id === projectId),
    [projectsQuery.data, projectId]
  );
  const effectiveAttractorCount = useMemo(
    () => buildEffectiveAttractors(attractorsQuery.data ?? []).length,
    [attractorsQuery.data]
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
  const setDefaultEnvironmentMutation = useMutation({
    mutationFn: (environmentId: string) => setProjectDefaultEnvironment(projectId, environmentId),
    onSuccess: () => {
      toast.success("Default environment updated");
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
      void queryClient.invalidateQueries({ queryKey: ["project-runs", projectId] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  });

  const defaultEnvironment = (environmentsQuery.data ?? []).find(
    (environment) => environment.id === project?.defaultEnvironmentId
  );
  const activeEnvironments = listActiveEnvironments(environmentsQuery.data ?? []);
  const inactiveDefaultEnvironment = getInactiveDefaultEnvironment(project, environmentsQuery.data ?? []);
  const effectiveDefaultEnvironmentId =
    selectedDefaultEnvironmentId || (defaultEnvironment?.active ? defaultEnvironment.id : "");

  if (!project) {
    return <p className="text-sm text-muted-foreground">Project not found.</p>;
  }

  return (
    <div>
      <PageTitle
        title={project.name}
        description={`Namespace: ${project.namespace}`}
        actions={
          <div className="flex gap-2">
            <Button asChild variant="outline">
              <Link to={`/projects/${project.id}/environments`}>Manage Environments</Link>
            </Button>
            <Button asChild variant="outline">
              <Link to={`/projects/${project.id}/runs`}>Start Run</Link>
            </Button>
          </div>
        }
      />

      {inactiveDefaultEnvironment ? (
        <Card className="mb-4 border-destructive/60">
          <CardHeader>
            <CardTitle className="text-destructive">Default environment is inactive</CardTitle>
            <CardDescription>
              <span className="mono">{inactiveDefaultEnvironment.name}</span> is inactive. Select an active environment below.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}

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
            <CardTitle>{effectiveAttractorCount}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Project Secrets</CardDescription>
            <CardTitle>{secretsQuery.data?.length ?? 0}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Default Environment</CardDescription>
            <CardTitle>{defaultEnvironment?.name ?? "Not configured"}</CardTitle>
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
            <p>
              <span className="text-muted-foreground">Environment:</span> {defaultEnvironment?.name ?? "-"}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Execution Environment</CardTitle>
            <CardDescription>Select the default runtime environment for new runs.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <Label>Default Environment</Label>
              <Select
                value={effectiveDefaultEnvironmentId || undefined}
                onValueChange={setSelectedDefaultEnvironmentId}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select environment" />
                </SelectTrigger>
                <SelectContent>
                  {activeEnvironments.map((environment) => (
                    <SelectItem key={environment.id} value={environment.id}>
                      {environment.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              onClick={() => {
                if (!effectiveDefaultEnvironmentId) {
                  toast.error("Select an environment first");
                  return;
                }
                setDefaultEnvironmentMutation.mutate(effectiveDefaultEnvironmentId);
              }}
              disabled={setDefaultEnvironmentMutation.isPending || !effectiveDefaultEnvironmentId}
            >
              {setDefaultEnvironmentMutation.isPending ? "Saving..." : "Save Default Environment"}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
