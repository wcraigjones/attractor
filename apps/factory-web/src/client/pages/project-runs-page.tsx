import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "../components/ui/toast";

import {
  createRun,
  listAttractors,
  listEnvironments,
  listProjects,
  listProjectRuns
} from "../lib/api";
import { buildEffectiveAttractors } from "../lib/attractors-view";
import { getInactiveDefaultEnvironment, listActiveEnvironments } from "../lib/environments-view";
import type { RunType } from "../lib/types";
import { PageTitle } from "../components/layout/page-title";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";

const RUN_STATUSES = ["all", "QUEUED", "RUNNING", "SUCCEEDED", "FAILED", "CANCELED", "TIMEOUT"] as const;
const PROJECT_DEFAULT_ENVIRONMENT = "__project_default__";

export function ProjectRunsPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId ?? "";
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  const [runType, setRunType] = useState<RunType>("planning");
  const [attractorDefId, setAttractorDefId] = useState("");
  const [sourceBranch, setSourceBranch] = useState("main");
  const [targetBranch, setTargetBranch] = useState("attractor/new-run");
  const [specBundleId, setSpecBundleId] = useState("");
  const [environmentSelection, setEnvironmentSelection] = useState(PROJECT_DEFAULT_ENVIRONMENT);

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
  const projectsQuery = useQuery({ queryKey: ["projects"], queryFn: listProjects });
  const environmentsQuery = useQuery({
    queryKey: ["environments"],
    queryFn: listEnvironments
  });
  const effectiveAttractors = useMemo(
    () => buildEffectiveAttractors(attractorsQuery.data ?? []),
    [attractorsQuery.data]
  );
  const selectedAttractor = useMemo(
    () => effectiveAttractors.find((item) => item.id === attractorDefId) ?? null,
    [attractorDefId, effectiveAttractors]
  );
  const project = useMemo(
    () => (projectsQuery.data ?? []).find((candidate) => candidate.id === projectId),
    [projectId, projectsQuery.data]
  );
  const defaultEnvironment = useMemo(
    () =>
      (environmentsQuery.data ?? []).find(
        (environment) => environment.id === project?.defaultEnvironmentId
      ),
    [environmentsQuery.data, project?.defaultEnvironmentId]
  );
  const activeEnvironments = useMemo(
    () => listActiveEnvironments(environmentsQuery.data ?? []),
    [environmentsQuery.data]
  );
  const inactiveDefaultEnvironment = useMemo(
    () => getInactiveDefaultEnvironment(project, environmentsQuery.data ?? []),
    [environmentsQuery.data, project]
  );

  const statusFilter = searchParams.get("status") ?? "all";
  const runTypeFilter = searchParams.get("runType") ?? "all";
  const branchFilter = searchParams.get("branch") ?? "";
  const attractorFromQuery = searchParams.get("attractorDefId") ?? "";

  useEffect(() => {
    if (!attractorFromQuery) {
      return;
    }
    const target = effectiveAttractors.find((item) => item.id === attractorFromQuery);
    if (!target || !target.contentPath) {
      return;
    }
    setAttractorDefId(attractorFromQuery);
  }, [attractorFromQuery, effectiveAttractors]);

  const filteredRuns = useMemo(() => {
    return (runsQuery.data ?? []).filter((run) => {
      if (statusFilter !== "all" && run.status !== statusFilter) {
        return false;
      }
      if (runTypeFilter !== "all" && run.runType !== runTypeFilter) {
        return false;
      }
      if (branchFilter.trim().length > 0) {
        const needle = branchFilter.toLowerCase();
        return (
          run.sourceBranch.toLowerCase().includes(needle) || run.targetBranch.toLowerCase().includes(needle)
        );
      }
      return true;
    });
  }, [branchFilter, runTypeFilter, runsQuery.data, statusFilter]);

  const createRunMutation = useMutation({
    mutationFn: () => {
      if (!attractorDefId) {
        throw new Error("Attractor definition is required");
      }
      if (!selectedAttractor?.modelConfig?.provider || !selectedAttractor?.modelConfig?.modelId) {
        throw new Error("Selected attractor is missing model configuration");
      }

      return createRun({
        projectId,
        attractorDefId,
        ...(environmentSelection !== PROJECT_DEFAULT_ENVIRONMENT
          ? { environmentId: environmentSelection }
          : {}),
        runType,
        sourceBranch,
        targetBranch: runType === "task" ? sourceBranch : targetBranch,
        ...(runType === "implementation" && specBundleId.trim().length > 0
          ? { specBundleId: specBundleId.trim() }
          : {})
      });
    },
    onSuccess: (payload) => {
      toast.success(`Run queued: ${payload.runId}`);
      void queryClient.invalidateQueries({ queryKey: ["project-runs", projectId] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  });

  const statusVariant = (status: string): "success" | "secondary" | "destructive" | "warning" => {
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
  };

  return (
    <div>
      <PageTitle
        title="Runs"
        description="Launch planning or implementation runs and monitor history."
        actions={
          <Button asChild variant="outline">
            <Link to={`/projects/${projectId}/environments`}>Manage Environments</Link>
          </Button>
        }
      />

      {inactiveDefaultEnvironment ? (
        <Card className="mb-4 border-destructive/60">
          <CardHeader>
            <CardTitle className="text-destructive">Project default environment is inactive</CardTitle>
            <CardDescription>
              Default <span className="mono">{inactiveDefaultEnvironment.name}</span> is inactive. Select a specific active environment for this run or update project defaults.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[2fr,1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Run History</CardTitle>
            <CardDescription>Filters are URL-synced for sharable deep links.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="mb-3 grid gap-2 md:grid-cols-3">
              <Select
                value={statusFilter}
                onValueChange={(value) => {
                  const next = new URLSearchParams(searchParams);
                  if (value === "all") {
                    next.delete("status");
                  } else {
                    next.set("status", value);
                  }
                  setSearchParams(next, { replace: true });
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  {RUN_STATUSES.map((status) => (
                    <SelectItem key={status} value={status}>
                      {status}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={runTypeFilter}
                onValueChange={(value) => {
                  const next = new URLSearchParams(searchParams);
                  if (value === "all") {
                    next.delete("runType");
                  } else {
                    next.set("runType", value);
                  }
                  setSearchParams(next, { replace: true });
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Run type" />
                </SelectTrigger>
                <SelectContent>
                  {[
                    { label: "all", value: "all" },
                    { label: "planning", value: "planning" },
                    { label: "implementation", value: "implementation" },
                    { label: "task", value: "task" }
                  ].map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Input
                value={branchFilter}
                onChange={(event) => {
                  const next = new URLSearchParams(searchParams);
                  const branch = event.target.value;
                  if (branch.trim().length > 0) {
                    next.set("branch", branch);
                  } else {
                    next.delete("branch");
                  }
                  setSearchParams(next, { replace: true });
                }}
                placeholder="Filter source or target branch"
              />
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Run</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Target</TableHead>
                  <TableHead>Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRuns.map((run) => (
                  <TableRow key={run.id}>
                    <TableCell className="mono text-xs">{run.id.slice(0, 12)}</TableCell>
                    <TableCell>{run.runType}</TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(run.status)}>{run.status}</Badge>
                    </TableCell>
                    <TableCell className="mono text-xs">{run.sourceBranch}</TableCell>
                    <TableCell className="mono text-xs">{run.targetBranch}</TableCell>
                    <TableCell>
                      <Button asChild variant="outline" size="sm">
                        <Link to={`/runs/${run.id}`}>Open</Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Launch Run</CardTitle>
            <CardDescription>One pod per run, branch-isolated in the project namespace.</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                createRunMutation.mutate();
              }}
            >
              <div className="space-y-1">
                <Label>Attractor</Label>
                <Select
                  value={attractorDefId.length > 0 ? attractorDefId : undefined}
                  onValueChange={(value) => {
                    setAttractorDefId(value);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select attractor" />
                  </SelectTrigger>
                  <SelectContent>
                    {effectiveAttractors.map((attractor) => (
                      <SelectItem key={attractor.id} value={attractor.id} disabled={!attractor.contentPath || !attractor.active}>
                        {attractor.scope === "PROJECT" ? attractor.name : `${attractor.name} (global)`}
                        {!attractor.contentPath ? " (legacy: recreate)" : ""}
                        {!attractor.active ? " (inactive)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Run Type</Label>
                <Select value={runType} onValueChange={(value: RunType) => setRunType(value)}>
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
                <Label>Environment</Label>
                <Select value={environmentSelection} onValueChange={setEnvironmentSelection}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={PROJECT_DEFAULT_ENVIRONMENT}>
                      {defaultEnvironment ? `Project default (${defaultEnvironment.name})` : "Project default"}
                    </SelectItem>
                    {activeEnvironments.map((environment) => (
                      <SelectItem key={environment.id} value={environment.id}>
                        {environment.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Model (from Attractor)</Label>
                <Input
                  value={
                    selectedAttractor?.modelConfig
                      ? `${selectedAttractor.modelConfig.provider} / ${selectedAttractor.modelConfig.modelId}`
                      : ""
                  }
                  placeholder="Select an attractor with model config"
                  disabled
                />
              </div>
              <div className="space-y-1">
                <Label>Source Branch</Label>
                <Input value={sourceBranch} onChange={(event) => setSourceBranch(event.target.value)} />
              </div>
              {runType === "task" ? null : (
                <div className="space-y-1">
                  <Label>Target Branch</Label>
                  <Input value={targetBranch} onChange={(event) => setTargetBranch(event.target.value)} />
                </div>
              )}
              {runType === "implementation" ? (
                <div className="space-y-1">
                  <Label>Spec Bundle ID</Label>
                  <Input value={specBundleId} onChange={(event) => setSpecBundleId(event.target.value)} />
                </div>
              ) : null}
              <Button type="submit" disabled={createRunMutation.isPending}>
                {createRunMutation.isPending ? "Queueing..." : "Queue Run"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
