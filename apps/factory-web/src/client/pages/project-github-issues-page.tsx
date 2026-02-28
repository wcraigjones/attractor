import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { listProjectGitHubIssues, reconcileProjectGitHub } from "../lib/api";
import { PageTitle } from "../components/layout/page-title";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";

export function ProjectGitHubIssuesPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId ?? "";
  const queryClient = useQueryClient();
  const [stateFilter, setStateFilter] = useState<"open" | "closed" | "all">("open");
  const [search, setSearch] = useState("");

  const issuesQuery = useQuery({
    queryKey: ["github-issues", projectId, stateFilter, search],
    queryFn: () => listProjectGitHubIssues(projectId, { state: stateFilter, q: search, limit: 200 }),
    enabled: projectId.length > 0
  });

  const reconcileMutation = useMutation({
    mutationFn: () => reconcileProjectGitHub(projectId),
    onSuccess: (result) => {
      toast.success(`Synced ${result.issuesSynced} issues and ${result.pullRequestsSynced} PRs`);
      void queryClient.invalidateQueries({ queryKey: ["github-issues", projectId] });
      void queryClient.invalidateQueries({ queryKey: ["github-pulls", projectId] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  });

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) {
      return issuesQuery.data ?? [];
    }
    return (issuesQuery.data ?? []).filter((issue) => {
      return (
        issue.title.toLowerCase().includes(needle) ||
        (issue.body ?? "").toLowerCase().includes(needle) ||
        issue.issueNumber.toString().includes(needle)
      );
    });
  }, [issuesQuery.data, search]);

  return (
    <div>
      <PageTitle
        title="GitHub Issues"
        description="Synchronized issues for this project repository."
        actions={
          <Button onClick={() => reconcileMutation.mutate()} disabled={reconcileMutation.isPending}>
            {reconcileMutation.isPending ? "Syncing..." : "Sync Now"}
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Issue Queue</CardTitle>
          <CardDescription>Select an issue to launch an attractor run.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-3 grid gap-2 md:grid-cols-2">
            <Select value={stateFilter} onValueChange={(value: "open" | "closed" | "all") => setStateFilter(value)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="open">open</SelectItem>
                <SelectItem value="closed">closed</SelectItem>
                <SelectItem value="all">all</SelectItem>
              </SelectContent>
            </Select>
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search issue number or title"
            />
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Issue</TableHead>
                <TableHead>State</TableHead>
                <TableHead>Runs</TableHead>
                <TableHead>PRs</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead>Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((issue) => (
                <TableRow key={issue.id}>
                  <TableCell>
                    <div className="space-y-1">
                      <p className="mono text-xs">#{issue.issueNumber}</p>
                      <p>{issue.title}</p>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={issue.state === "open" ? "success" : "secondary"}>{issue.state}</Badge>
                  </TableCell>
                  <TableCell>{issue.runCount ?? 0}</TableCell>
                  <TableCell>{issue.pullRequestCount ?? 0}</TableCell>
                  <TableCell>{new Date(issue.updatedAt).toLocaleString()}</TableCell>
                  <TableCell>
                    <Button asChild size="sm" variant="outline">
                      <Link to={`/projects/${projectId}/github/issues/${issue.issueNumber}`}>Open</Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {filtered.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">No issues match the selected filters.</p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
