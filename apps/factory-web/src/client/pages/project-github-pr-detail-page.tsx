import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import { getProjectGitHubPull } from "../lib/api";
import { PageTitle } from "../components/layout/page-title";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";

export function ProjectGitHubPrDetailPage() {
  const params = useParams<{ projectId: string; prNumber: string }>();
  const projectId = params.projectId ?? "";
  const prNumber = Number.parseInt(params.prNumber ?? "", 10);

  const pullQuery = useQuery({
    queryKey: ["github-pull", projectId, prNumber],
    queryFn: () => getProjectGitHubPull(projectId, prNumber),
    enabled: projectId.length > 0 && Number.isInteger(prNumber) && prNumber > 0
  });

  if (!pullQuery.data) {
    return <p className="text-sm text-muted-foreground">Loading pull request...</p>;
  }

  const row = pullQuery.data.pull;
  const pull = row.pullRequest;
  return (
    <div>
      <PageTitle
        title={`PR #${pull.prNumber}`}
        description={pull.title}
        actions={
          <Button asChild variant="outline">
            <a href={pull.url} target="_blank" rel="noreferrer">Open in GitHub</a>
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[2fr,1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Read-Only Review Pack</CardTitle>
            <CardDescription>
              This PR has no linked attractor run artifacts yet. Use GitHub diff and metadata for manual review.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={row.risk === "high" ? "destructive" : row.risk === "medium" ? "warning" : "secondary"}>
                {row.risk}
              </Badge>
              <Badge variant={row.reviewStatus === "Completed" ? "success" : row.reviewStatus === "Overdue" ? "destructive" : "secondary"}>
                {row.reviewStatus}
              </Badge>
              <Badge variant="outline">Head SHA {pull.headSha.slice(0, 12)}</Badge>
              <Badge variant="outline">Due {new Date(row.dueAt).toLocaleString()}</Badge>
            </div>
            <p className="whitespace-pre-wrap rounded-md border border-border bg-muted/30 p-3">
              {pull.body?.trim() || "No PR body provided."}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Actions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {row.openPackPath ? (
              <Button asChild className="w-full">
                <Link to={row.openPackPath}>Open Linked Run Pack</Link>
              </Button>
            ) : null}
            <Button asChild variant="outline" className="w-full">
              <a href={pull.url} target="_blank" rel="noreferrer">Review in GitHub</a>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
