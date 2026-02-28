import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import {
  getProjectGitHubIssue,
  launchIssueRun,
  listEnvironments,
  listModels,
  listProviders
} from "../lib/api";
import type { RunType } from "../lib/types";
import { PageTitle } from "../components/layout/page-title";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";

const PROJECT_DEFAULT_ENVIRONMENT = "__project_default__";

export function ProjectGitHubIssueDetailPage() {
  const params = useParams<{ projectId: string; issueNumber: string }>();
  const navigate = useNavigate();
  const projectId = params.projectId ?? "";
  const issueNumber = Number.parseInt(params.issueNumber ?? "", 10);
  const [provider, setProvider] = useState("openai");
  const [modelId, setModelId] = useState("");
  const [runType, setRunType] = useState<RunType>("implementation");
  const [attractorDefId, setAttractorDefId] = useState("");
  const [sourceBranch, setSourceBranch] = useState("main");
  const [targetBranch, setTargetBranch] = useState("");
  const [specBundleId, setSpecBundleId] = useState("");
  const [environmentSelection, setEnvironmentSelection] = useState(PROJECT_DEFAULT_ENVIRONMENT);

  const detailQuery = useQuery({
    queryKey: ["github-issue", projectId, issueNumber],
    queryFn: () => getProjectGitHubIssue(projectId, issueNumber),
    enabled: projectId.length > 0 && Number.isInteger(issueNumber) && issueNumber > 0
  });
  const providersQuery = useQuery({ queryKey: ["providers"], queryFn: listProviders });
  const modelsQuery = useQuery({
    queryKey: ["models", provider],
    queryFn: () => listModels(provider),
    enabled: provider.length > 0
  });
  const environmentsQuery = useQuery({
    queryKey: ["environments"],
    queryFn: listEnvironments
  });

  useEffect(() => {
    if (!detailQuery.data) {
      return;
    }
    if (!attractorDefId && detailQuery.data.launchDefaults.attractorOptions.length > 0) {
      setAttractorDefId(detailQuery.data.launchDefaults.attractorOptions[0]?.id ?? "");
    }
    if (!targetBranch) {
      setTargetBranch(detailQuery.data.launchDefaults.targetBranch);
    }
    if (sourceBranch === "main") {
      setSourceBranch(detailQuery.data.launchDefaults.sourceBranch);
    }
  }, [attractorDefId, detailQuery.data, sourceBranch, targetBranch]);

  const launchMutation = useMutation({
    mutationFn: () =>
      launchIssueRun(projectId, issueNumber, {
        attractorDefId,
        ...(environmentSelection !== PROJECT_DEFAULT_ENVIRONMENT
          ? { environmentId: environmentSelection }
          : {}),
        runType,
        sourceBranch,
        targetBranch,
        ...(specBundleId.trim().length > 0 ? { specBundleId: specBundleId.trim() } : {}),
        modelConfig: {
          provider,
          modelId,
          reasoningLevel: "high",
          temperature: 0.2
        }
      }),
    onSuccess: (payload) => {
      toast.success(`Run queued: ${payload.runId}`);
      navigate(`/runs/${payload.runId}`);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  });

  const linkedRuns = useMemo(() => detailQuery.data?.runs ?? [], [detailQuery.data?.runs]);
  const linkedPullRequests = useMemo(() => detailQuery.data?.pullRequests ?? [], [detailQuery.data?.pullRequests]);

  if (!detailQuery.data) {
    return <p className="text-sm text-muted-foreground">Loading issue...</p>;
  }

  const issue = detailQuery.data.issue;

  return (
    <div>
      <PageTitle
        title={`Issue #${issue.issueNumber}`}
        description={issue.title}
        actions={
          <Button asChild variant="outline">
            <a href={issue.url} target="_blank" rel="noreferrer">Open in GitHub</a>
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[2fr,1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Issue Context</CardTitle>
            <CardDescription>Synced issue details used to prefill attractor launch.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-center gap-2">
              <Badge variant={issue.state === "open" ? "success" : "secondary"}>{issue.state}</Badge>
              <Badge variant="outline">Updated {new Date(issue.updatedAt).toLocaleString()}</Badge>
            </div>
            <p className="whitespace-pre-wrap rounded-md border border-border bg-muted/30 p-3">
              {issue.body?.trim() ? issue.body : "No issue body provided."}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Run Attractor</CardTitle>
            <CardDescription>Prefilled launch form for this issue.</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                if (!attractorDefId || !modelId) {
                  toast.error("Attractor and model are required");
                  return;
                }
                launchMutation.mutate();
              }}
            >
              <div className="space-y-1">
                <Label>Attractor</Label>
                <Select value={attractorDefId || undefined} onValueChange={setAttractorDefId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select attractor" />
                  </SelectTrigger>
                  <SelectContent>
                    {detailQuery.data.launchDefaults.attractorOptions.map((attractor) => (
                      <SelectItem key={attractor.id} value={attractor.id}>
                        {attractor.name}
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
                    <SelectItem value={PROJECT_DEFAULT_ENVIRONMENT}>Project default</SelectItem>
                    {(environmentsQuery.data ?? []).map((environment) => (
                      <SelectItem key={environment.id} value={environment.id}>
                        {environment.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label>Provider</Label>
                <Select
                  value={provider}
                  onValueChange={(value) => {
                    setProvider(value);
                    setModelId("");
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select provider" />
                  </SelectTrigger>
                  <SelectContent>
                    {(providersQuery.data ?? []).map((item) => (
                      <SelectItem key={item} value={item}>
                        {item}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label>Model</Label>
                <Select value={modelId || undefined} onValueChange={setModelId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select model" />
                  </SelectTrigger>
                  <SelectContent>
                    {(modelsQuery.data ?? []).map((model) => (
                      <SelectItem key={model.id} value={model.id}>
                        {model.id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label>Source Branch</Label>
                <Input value={sourceBranch} onChange={(event) => setSourceBranch(event.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Target Branch</Label>
                <Input value={targetBranch} onChange={(event) => setTargetBranch(event.target.value)} />
              </div>
              {runType === "implementation" ? (
                <div className="space-y-1">
                  <Label>Spec Bundle (optional)</Label>
                  <Input
                    value={specBundleId}
                    onChange={(event) => setSpecBundleId(event.target.value)}
                    placeholder="Defaults to latest successful planning bundle"
                  />
                </div>
              ) : null}
              <Button type="submit" disabled={launchMutation.isPending}>
                {launchMutation.isPending ? "Queueing..." : "Run Attractor"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Linked Runs</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Run</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>PR</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {linkedRuns.map((run) => (
                  <TableRow key={run.id}>
                    <TableCell>
                      <Link className="mono text-xs underline" to={`/runs/${run.id}`}>
                        {run.id.slice(0, 12)}
                      </Link>
                    </TableCell>
                    <TableCell>{run.status}</TableCell>
                    <TableCell>
                      {run.githubPullRequest ? (
                        <a href={run.githubPullRequest.url} target="_blank" rel="noreferrer" className="underline">
                          #{run.githubPullRequest.prNumber}
                        </a>
                      ) : (
                        "-"
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Linked PRs</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>PR</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead>Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {linkedPullRequests.map((pull) => (
                  <TableRow key={pull.id}>
                    <TableCell>
                      <a href={pull.url} target="_blank" rel="noreferrer" className="underline">
                        #{pull.prNumber}
                      </a>
                    </TableCell>
                    <TableCell>{pull.state}</TableCell>
                    <TableCell>{new Date(pull.updatedAt).toLocaleString()}</TableCell>
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
