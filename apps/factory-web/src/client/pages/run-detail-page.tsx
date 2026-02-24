import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { buildApiUrl, cancelRun, getRun, getRunArtifacts } from "../lib/api";
import type { RunEvent } from "../lib/types";
import { PageTitle } from "../components/layout/page-title";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";

function statusVariant(status: string): "success" | "secondary" | "destructive" | "warning" {
  if (status === "SUCCEEDED") {
    return "success";
  }
  if (status === "FAILED") {
    return "destructive";
  }
  if (status === "RUNNING") {
    return "warning";
  }
  return "secondary";
}

export function RunDetailPage() {
  const params = useParams<{ runId: string }>();
  const runId = params.runId ?? "";
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [streamEvents, setStreamEvents] = useState<RunEvent[]>([]);

  const runQuery = useQuery({
    queryKey: ["run", runId],
    queryFn: () => getRun(runId),
    enabled: runId.length > 0,
    refetchInterval: 7000
  });

  const artifactsQuery = useQuery({
    queryKey: ["run-artifacts", runId],
    queryFn: () => getRunArtifacts(runId),
    enabled: runId.length > 0,
    refetchInterval: 7000
  });

  const cancelMutation = useMutation({
    mutationFn: () => cancelRun(runId),
    onSuccess: () => {
      toast.success("Run cancel requested");
      void queryClient.invalidateQueries({ queryKey: ["run", runId] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  });

  const tab = searchParams.get("tab") ?? "overview";

  useEffect(() => {
    if (!runId) {
      return;
    }
    const source = new EventSource(buildApiUrl(`/api/runs/${runId}/events`));

    source.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data) as RunEvent;
        setStreamEvents((previous) => {
          if (previous.some((item) => item.id === parsed.id)) {
            return previous;
          }
          return [...previous, parsed];
        });
      } catch {
        // ignored for heartbeat and malformed events
      }
    };

    source.onerror = () => {
      source.close();
    };

    return () => {
      source.close();
    };
  }, [runId]);

  const mergedEvents = useMemo(() => {
    const byId = new Map<string, RunEvent>();
    for (const item of runQuery.data?.events ?? []) {
      byId.set(item.id, item);
    }
    for (const item of streamEvents) {
      byId.set(item.id, item);
    }
    return [...byId.values()].sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
  }, [runQuery.data?.events, streamEvents]);

  if (!runQuery.data) {
    return <p className="text-sm text-muted-foreground">Loading run...</p>;
  }

  const run = runQuery.data;

  return (
    <div>
      <PageTitle
        title={`Run ${run.id.slice(0, 12)}`}
        description={`${run.runType} on ${run.targetBranch}`}
        actions={
          <>
            <Badge variant={statusVariant(run.status)}>{run.status}</Badge>
            <Button
              variant="outline"
              onClick={() => {
                cancelMutation.mutate();
              }}
              disabled={cancelMutation.isPending || ["SUCCEEDED", "FAILED", "CANCELED", "TIMEOUT"].includes(run.status)}
            >
              Cancel Run
            </Button>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap gap-2">
        {[
          { key: "overview", label: "Overview" },
          { key: "events", label: "Events" },
          { key: "artifacts", label: "Artifacts" }
        ].map((item) => (
          <Button
            key={item.key}
            variant={tab === item.key ? "default" : "outline"}
            onClick={() => {
              const next = new URLSearchParams(searchParams);
              next.set("tab", item.key);
              setSearchParams(next, { replace: true });
            }}
          >
            {item.label}
          </Button>
        ))}
      </div>

      {tab === "overview" ? (
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Run Metadata</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p>
                <span className="text-muted-foreground">Type:</span> {run.runType}
              </p>
              <p>
                <span className="text-muted-foreground">Source branch:</span> <span className="mono">{run.sourceBranch}</span>
              </p>
              <p>
                <span className="text-muted-foreground">Target branch:</span> <span className="mono">{run.targetBranch}</span>
              </p>
              <p>
                <span className="text-muted-foreground">Spec bundle:</span> {run.specBundleId ?? "-"}
              </p>
              <p>
                <span className="text-muted-foreground">PR URL:</span>{" "}
                {run.prUrl ? (
                  <a href={run.prUrl} target="_blank" rel="noreferrer" className="text-primary underline">
                    Open PR
                  </a>
                ) : (
                  "-"
                )}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Timeline</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p>
                <span className="text-muted-foreground">Created:</span> {new Date(run.createdAt).toLocaleString()}
              </p>
              <p>
                <span className="text-muted-foreground">Started:</span>{" "}
                {run.startedAt ? new Date(run.startedAt).toLocaleString() : "-"}
              </p>
              <p>
                <span className="text-muted-foreground">Finished:</span>{" "}
                {run.finishedAt ? new Date(run.finishedAt).toLocaleString() : "-"}
              </p>
              {run.error ? (
                <p>
                  <span className="text-muted-foreground">Error:</span> {run.error}
                </p>
              ) : null}
            </CardContent>
          </Card>
        </div>
      ) : null}

      {tab === "events" ? (
        <Card>
          <CardHeader>
            <CardTitle>Live Event Stream</CardTitle>
            <CardDescription>SSE is merged with persisted run events for continuity.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="max-h-[60vh] overflow-auto rounded-md border border-border bg-background p-3">
              <pre className="text-xs">
                {mergedEvents
                  .map((event) => `${event.ts} ${event.type} ${JSON.stringify(event.payload)}`)
                  .join("\n")}
              </pre>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {tab === "artifacts" ? (
        <Card>
          <CardHeader>
            <CardTitle>Artifacts</CardTitle>
            <CardDescription>Open artifacts in the embedded editor route.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Key</TableHead>
                  <TableHead>Path</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead>Open</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(artifactsQuery.data?.artifacts ?? []).map((artifact) => (
                  <TableRow key={artifact.id}>
                    <TableCell>{artifact.key}</TableCell>
                    <TableCell className="mono text-xs">{artifact.path}</TableCell>
                    <TableCell>{artifact.sizeBytes ? `${artifact.sizeBytes.toLocaleString()} B` : "-"}</TableCell>
                    <TableCell>
                      <Button asChild size="sm" variant="outline">
                        <Link to={`/runs/${run.id}/artifacts/${artifact.id}`}>View</Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
