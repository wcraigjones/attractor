import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import { listProjects, listProviders, listProjectRuns } from "../lib/api";
import { PageTitle } from "../components/layout/page-title";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";

export function DashboardPage() {
  const projectsQuery = useQuery({ queryKey: ["projects"], queryFn: listProjects });
  const providersQuery = useQuery({ queryKey: ["providers"], queryFn: listProviders });
  const latestProjectId = projectsQuery.data?.[0]?.id;
  const recentRunsQuery = useQuery({
    queryKey: ["project-runs", latestProjectId],
    queryFn: () => listProjectRuns(latestProjectId ?? ""),
    enabled: Boolean(latestProjectId)
  });

  return (
    <div>
      <PageTitle
        title="Dashboard"
        description="System snapshot with quick entry points into projects and runs."
        actions={
          <Button asChild>
            <Link to="/setup">Start Setup Wizard</Link>
          </Button>
        }
      />

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardDescription>Projects</CardDescription>
            <CardTitle>{projectsQuery.data?.length ?? 0}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Providers Available</CardDescription>
            <CardTitle>{providersQuery.data?.length ?? 0}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Latest Project Runs</CardDescription>
            <CardTitle>{recentRunsQuery.data?.length ?? 0}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Recent Runs</CardTitle>
            <CardDescription>Most recent run records from the newest project.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {(recentRunsQuery.data ?? []).slice(0, 8).map((run) => (
              <Link
                key={run.id}
                to={`/runs/${run.id}`}
                className="flex items-center justify-between rounded-md border border-border bg-background p-3 text-sm hover:bg-muted"
              >
                <span className="mono text-xs">{run.id.slice(0, 12)}</span>
                <div className="flex items-center gap-2">
                  <Badge variant={run.status === "SUCCEEDED" ? "success" : run.status === "FAILED" ? "destructive" : "secondary"}>
                    {run.status}
                  </Badge>
                  <span className="text-muted-foreground">{run.runType}</span>
                </div>
              </Link>
            ))}
            {recentRunsQuery.data?.length ? null : (
              <p className="text-sm text-muted-foreground">No runs yet. Launch one from a project run page.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
            <CardDescription>Jump directly to core workflows.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2">
            <Button asChild variant="outline">
              <Link to="/projects">Manage Projects</Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/setup">Setup Wizard</Link>
            </Button>
            <Button asChild variant="outline">
              <Link to={latestProjectId ? `/projects/${latestProjectId}/secrets` : "/projects"}>Manage Secrets</Link>
            </Button>
            <Button asChild variant="outline">
              <Link to={latestProjectId ? `/projects/${latestProjectId}/attractors` : "/projects"}>Manage Attractors</Link>
            </Button>
            <Button asChild variant="outline">
              <Link to={latestProjectId ? `/projects/${latestProjectId}/runs` : "/projects"}>Start Runs</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
