import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "../components/ui/toast";

import {
  answerRunQuestion,
  buildApiUrl,
  cancelRun,
  getRun,
  getRunArtifacts,
  getRunQuestions,
  getRunReview,
  upsertRunReview
} from "../lib/api";
import type { ReviewDecision, RunEvent, RunQuestion, RunReviewChecklist } from "../lib/types";
import { PageTitle } from "../components/layout/page-title";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { Textarea } from "../components/ui/textarea";

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

function reviewDecisionVariant(decision: ReviewDecision): "success" | "warning" | "destructive" | "secondary" {
  if (decision === "APPROVE") {
    return "success";
  }
  if (decision === "REQUEST_CHANGES") {
    return "warning";
  }
  if (decision === "REJECT") {
    return "destructive";
  }
  return "secondary";
}

function defaultChecklist(): RunReviewChecklist {
  return {
    summaryReviewed: false,
    criticalCodeReviewed: false,
    artifactsReviewed: false,
    functionalValidationReviewed: false
  };
}

interface ReviewFormState {
  reviewer: string;
  decision: ReviewDecision;
  checklist: RunReviewChecklist;
  summary: string;
  criticalFindings: string;
  artifactFindings: string;
  attestation: string;
}

function emptyReviewForm(): ReviewFormState {
  return {
    reviewer: "",
    decision: "REQUEST_CHANGES",
    checklist: defaultChecklist(),
    summary: "",
    criticalFindings: "",
    artifactFindings: "",
    attestation: ""
  };
}

function formatMinutesRemaining(minutes: number): string {
  if (minutes < 0) {
    return `${Math.abs(minutes)} min overdue`;
  }
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  return `${hours}h ${rem}m remaining`;
}

function slaVariant(overdue: boolean, minutesRemaining: number): "secondary" | "warning" | "destructive" {
  if (overdue) {
    return "destructive";
  }
  if (minutesRemaining <= 120) {
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
  const [reviewForm, setReviewForm] = useState<ReviewFormState>(emptyReviewForm());
  const [reviewFormInitialized, setReviewFormInitialized] = useState(false);
  const [questionAnswers, setQuestionAnswers] = useState<Record<string, string>>({});
  const [reviewPackTab, setReviewPackTab] = useState<"summary" | "critical" | "artifacts">("summary");

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

  const questionsQuery = useQuery({
    queryKey: ["run-questions", runId],
    queryFn: () => getRunQuestions(runId),
    enabled: runId.length > 0,
    refetchInterval: runQuery.data?.status === "RUNNING" ? 4000 : false
  });

  const reviewQuery = useQuery({
    queryKey: ["run-review", runId],
    queryFn: () => getRunReview(runId),
    enabled: runId.length > 0
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

  const saveReviewMutation = useMutation({
    mutationFn: () =>
      upsertRunReview(runId, {
        reviewer: reviewForm.reviewer,
        decision: reviewForm.decision,
        checklist: reviewForm.checklist,
        summary: reviewForm.summary,
        criticalFindings: reviewForm.criticalFindings,
        artifactFindings: reviewForm.artifactFindings,
        attestation: reviewForm.attestation
      }),
    onSuccess: (payload) => {
      toast.success("Run review saved");
      if (payload.review) {
        setReviewForm({
          reviewer: payload.review.reviewer,
          decision: payload.review.decision,
          checklist: payload.review.checklist,
          summary: payload.review.summary ?? "",
          criticalFindings: payload.review.criticalFindings ?? "",
          artifactFindings: payload.review.artifactFindings ?? "",
          attestation: payload.review.attestation ?? ""
        });
        setReviewFormInitialized(true);
      }
      void queryClient.invalidateQueries({ queryKey: ["run-review", runId] });
      void queryClient.invalidateQueries({ queryKey: ["run", runId] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  });

  const answerQuestionMutation = useMutation({
    mutationFn: (input: { questionId: string; answer: string }) =>
      answerRunQuestion(runId, input.questionId, { answer: input.answer }),
    onSuccess: (_payload, variables) => {
      toast.success("Answer submitted");
      setQuestionAnswers((previous) => ({
        ...previous,
        [variables.questionId]: ""
      }));
      void queryClient.invalidateQueries({ queryKey: ["run-questions", runId] });
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

  useEffect(() => {
    setReviewForm(emptyReviewForm());
    setReviewFormInitialized(false);
    setQuestionAnswers({});
  }, [runId]);

  useEffect(() => {
    if (!reviewQuery.data || reviewFormInitialized) {
      return;
    }
    if (reviewQuery.data.review) {
      setReviewForm({
        reviewer: reviewQuery.data.review.reviewer,
        decision: reviewQuery.data.review.decision,
        checklist: reviewQuery.data.review.checklist,
        summary: reviewQuery.data.review.summary ?? "",
        criticalFindings: reviewQuery.data.review.criticalFindings ?? "",
        artifactFindings: reviewQuery.data.review.artifactFindings ?? "",
        attestation: reviewQuery.data.review.attestation ?? ""
      });
      setReviewFormInitialized(true);
      return;
    }

    setReviewForm((previous) => ({
      ...previous,
      summary: previous.summary.length > 0 ? previous.summary : reviewQuery.data.pack.summarySuggestion
    }));
    setReviewFormInitialized(true);
  }, [reviewFormInitialized, reviewQuery.data]);

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

  const taskReportArtifact = useMemo(() => {
    const artifacts = artifactsQuery.data?.artifacts ?? [];
    return (
      artifacts.find((artifact) => artifact.key === "security-review-report.md") ??
      artifacts.find((artifact) => artifact.key.endsWith(".md")) ??
      artifacts[0] ??
      null
    );
  }, [artifactsQuery.data?.artifacts]);

  const pendingQuestions = useMemo(
    () => (questionsQuery.data ?? []).filter((question) => question.status === "PENDING"),
    [questionsQuery.data]
  );

  if (!runQuery.data) {
    return <p className="text-sm text-muted-foreground">Loading run...</p>;
  }

  const run = runQuery.data;
  const environmentName =
    run.environmentSnapshot?.name ?? run.environmentId ?? "not set";
  const environmentImage = run.environmentSnapshot?.runnerImage ?? "-";

  return (
    <div>
      <PageTitle
        title={`Run ${run.id.slice(0, 12)}`}
        description={`${run.runType} on ${run.targetBranch}`}
        actions={
          <>
            <Badge variant={statusVariant(run.status)}>{run.status}</Badge>
            <Button asChild variant="outline">
              <Link to={`/projects/${run.projectId}/attractors/${run.attractorDefId}?tab=viewer`}>
                View Attractor Snapshot
              </Link>
            </Button>
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
          { key: "artifacts", label: "Artifacts" },
          { key: "review", label: "Review" }
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
                <span className="text-muted-foreground">Attractor snapshot path:</span>{" "}
                <span className="mono text-xs">{run.attractorContentPath ?? "-"}</span>
              </p>
              <p>
                <span className="text-muted-foreground">Attractor snapshot version:</span>{" "}
                {run.attractorContentVersion ?? "-"}
              </p>
              <p>
                <span className="text-muted-foreground">Attractor snapshot SHA:</span>{" "}
                <span className="mono text-xs">{run.attractorContentSha256 ?? "-"}</span>
              </p>
              <p>
                <span className="text-muted-foreground">Environment:</span> {environmentName}
              </p>
              <p>
                <span className="text-muted-foreground">Runner image:</span>{" "}
                <span className="mono text-xs">{environmentImage}</span>
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

          {run.runType === "task" ? (
            <Card>
              <CardHeader>
                <CardTitle>Task Artifact</CardTitle>
                <CardDescription>Artifact-only runs produce a final report without code commits or PR creation.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {taskReportArtifact ? (
                  <>
                    <p>
                      <span className="text-muted-foreground">Primary artifact:</span>{" "}
                      <span className="mono">{taskReportArtifact.key}</span>
                    </p>
                    <p>
                      <span className="text-muted-foreground">Path:</span>{" "}
                      <span className="mono text-xs">{taskReportArtifact.path}</span>
                    </p>
                    <Button asChild size="sm" variant="outline">
                      <Link to={`/runs/${run.id}/artifacts/${taskReportArtifact.id}`}>Open Report</Link>
                    </Button>
                  </>
                ) : (
                  <p className="text-muted-foreground">No report artifact available yet.</p>
                )}
              </CardContent>
            </Card>
          ) : null}

          {run.runType === "task" ? (
            <Card>
              <CardHeader>
                <CardTitle>Human Input</CardTitle>
                <CardDescription>Submit answers when the workflow is paused on wait.human nodes.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {pendingQuestions.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No pending prompts for this run.</p>
                ) : (
                  pendingQuestions.map((question: RunQuestion) => (
                    <div key={question.id} className="space-y-2 rounded-md border border-border p-3">
                      <p className="text-sm font-medium">{question.prompt}</p>
                      {Array.isArray(question.options) && question.options.length > 0 ? (
                        <p className="text-xs text-muted-foreground">
                          Options: {question.options.join(" | ")}
                        </p>
                      ) : null}
                      <Textarea
                        value={questionAnswers[question.id] ?? ""}
                        onChange={(event) => {
                          const value = event.target.value;
                          setQuestionAnswers((previous) => ({
                            ...previous,
                            [question.id]: value
                          }));
                        }}
                        placeholder="Type your answer"
                      />
                      <Button
                        size="sm"
                        onClick={() => {
                          const answer = (questionAnswers[question.id] ?? "").trim();
                          if (!answer) {
                            toast.error("Answer is required");
                            return;
                          }
                          answerQuestionMutation.mutate({ questionId: question.id, answer });
                        }}
                        disabled={answerQuestionMutation.isPending}
                      >
                        Submit Answer
                      </Button>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          ) : null}
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

      {tab === "review" ? (
        reviewQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading review pack...</p>
        ) : reviewQuery.error || !reviewQuery.data ? (
          <p className="text-sm text-destructive">Failed to load review pack.</p>
        ) : (
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Task Review SLA</CardTitle>
                <CardDescription>
                  Framework {reviewQuery.data.frameworkVersion}. Human review is expected within 24 hours of run creation.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={slaVariant(reviewQuery.data.pack.overdue, reviewQuery.data.pack.minutesRemaining)}>
                    {reviewQuery.data.pack.overdue ? "Overdue" : "On Track"}
                  </Badge>
                  <Badge variant="secondary">{formatMinutesRemaining(reviewQuery.data.pack.minutesRemaining)}</Badge>
                  <Badge variant="outline">Due {new Date(reviewQuery.data.pack.dueAt).toLocaleString()}</Badge>
                  {reviewQuery.data.github?.pullRequest ? (
                    <Badge variant="outline">PR #{reviewQuery.data.github.pullRequest.prNumber}</Badge>
                  ) : null}
                </div>
                {reviewQuery.data.review ? (
                  <p>
                    Last decision by <span className="mono">{reviewQuery.data.review.reviewer}</span>:{" "}
                    <Badge variant={reviewDecisionVariant(reviewQuery.data.review.decision)}>
                      {reviewQuery.data.review.decision}
                    </Badge>{" "}
                    at {new Date(reviewQuery.data.review.reviewedAt).toLocaleString()}
                  </p>
                ) : (
                  <p className="text-muted-foreground">No review has been submitted for this run yet.</p>
                )}
                {reviewQuery.data.review?.githubWritebackStatus ? (
                  <p>
                    GitHub writeback:{" "}
                    <Badge variant={reviewQuery.data.review.githubWritebackStatus === "SUCCEEDED" ? "success" : "warning"}>
                      {reviewQuery.data.review.githubWritebackStatus}
                    </Badge>
                  </p>
                ) : null}
              </CardContent>
            </Card>

            <div className="grid gap-4 lg:grid-cols-[2fr,1fr]">
              <Card>
                <CardHeader>
                  <CardTitle>Review Pack</CardTitle>
                  <CardDescription>
                    Summary, critical sections, and artifacts aligned to the batch review workflow.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant={reviewPackTab === "summary" ? "default" : "outline"}
                      size="sm"
                      onClick={() => setReviewPackTab("summary")}
                    >
                      Summary
                    </Button>
                    <Button
                      variant={reviewPackTab === "critical" ? "default" : "outline"}
                      size="sm"
                      onClick={() => setReviewPackTab("critical")}
                    >
                      Critical Sections
                    </Button>
                    <Button
                      variant={reviewPackTab === "artifacts" ? "default" : "outline"}
                      size="sm"
                      onClick={() => setReviewPackTab("artifacts")}
                    >
                      Artifacts
                    </Button>
                  </div>

                  {reviewPackTab === "summary" ? (
                    <div>
                      <p className="mb-2 text-sm font-medium">Context Summary</p>
                      <p className="whitespace-pre-wrap rounded-md border border-border bg-muted/30 p-3 text-sm">
                        {reviewQuery.data.pack.summarySuggestion || "No implementation summary artifact found."}
                      </p>
                    </div>
                  ) : null}

                  {reviewPackTab === "critical" ? (
                    <div>
                      <p className="mb-2 text-sm font-medium">Critical Sections</p>
                      {reviewQuery.data.pack.criticalSections.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                          No patch artifact was found. Use artifacts or the linked PR for manual inspection.
                        </p>
                      ) : (
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Path</TableHead>
                              <TableHead>Risk</TableHead>
                              <TableHead>Reason</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {reviewQuery.data.pack.criticalSections.map((section) => (
                              <TableRow key={section.path}>
                                <TableCell className="mono text-xs">{section.path}</TableCell>
                                <TableCell>
                                  <Badge variant={section.riskLevel === "high" ? "destructive" : section.riskLevel === "medium" ? "warning" : "secondary"}>
                                    {section.riskLevel}
                                  </Badge>
                                </TableCell>
                                <TableCell>{section.reason}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      )}
                    </div>
                  ) : null}

                  {reviewPackTab === "artifacts" ? (
                    <div>
                      <p className="mb-2 text-sm font-medium">Artifact Focus</p>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Artifact</TableHead>
                            <TableHead>Reason</TableHead>
                            <TableHead>Open</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {reviewQuery.data.pack.artifactFocus.map((artifact) => (
                            <TableRow key={artifact.id}>
                              <TableCell className="mono text-xs">{artifact.key}</TableCell>
                              <TableCell>{artifact.reason}</TableCell>
                              <TableCell>
                                <Button asChild size="sm" variant="outline">
                                  <Link to={`/runs/${run.id}/artifacts/${artifact.id}`}>View</Link>
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  ) : null}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Reviewer Action Pane</CardTitle>
                  <CardDescription>
                    Any non-empty feedback text is treated as non-approval.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
                    Compliance rule: feedback in summary/critical/artifact notes forces a non-approval decision.
                  </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <label className="text-sm font-medium" htmlFor="reviewer-name">Reviewer</label>
                    <Input
                      id="reviewer-name"
                      value={reviewForm.reviewer}
                      onChange={(event) => {
                        const reviewer = event.target.value;
                        setReviewForm((previous) => ({ ...previous, reviewer }));
                      }}
                      placeholder="Reviewer name"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium" htmlFor="review-decision">Decision</label>
                    <select
                      id="review-decision"
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      value={reviewForm.decision}
                      onChange={(event) => {
                        const decision = event.target.value as ReviewDecision;
                        setReviewForm((previous) => ({ ...previous, decision }));
                      }}
                    >
                      <option value="APPROVE">Approve</option>
                      <option value="REQUEST_CHANGES">Request Changes</option>
                      <option value="REJECT">Reject</option>
                      <option value="EXCEPTION">Exception</option>
                    </select>
                  </div>
                </div>

                <div className="space-y-2">
                  <p className="text-sm font-medium">Checklist</p>
                  <div className="space-y-2 rounded-md border border-border p-3 text-sm">
                    {reviewQuery.data.checklistTemplate.map((item) => (
                      <label key={item.key} className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={reviewForm.checklist[item.key]}
                          onChange={(event) => {
                            const checked = event.target.checked;
                            setReviewForm((previous) => ({
                              ...previous,
                              checklist: {
                                ...previous.checklist,
                                [item.key]: checked
                              }
                            }));
                          }}
                        />
                        <span>{item.label}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium" htmlFor="review-summary">Context Summary</label>
                  <Textarea
                    id="review-summary"
                    value={reviewForm.summary}
                    onChange={(event) => {
                      const summary = event.target.value;
                      setReviewForm((previous) => ({ ...previous, summary }));
                    }}
                    placeholder="What changed and why?"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium" htmlFor="review-critical-findings">Critical Code Findings</label>
                  <Textarea
                    id="review-critical-findings"
                    value={reviewForm.criticalFindings}
                    onChange={(event) => {
                      const criticalFindings = event.target.value;
                      setReviewForm((previous) => ({ ...previous, criticalFindings }));
                    }}
                    placeholder="Risk notes, concerns, or approval rationale on critical sections."
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium" htmlFor="review-artifact-findings">Artifact Findings</label>
                  <Textarea
                    id="review-artifact-findings"
                    value={reviewForm.artifactFindings}
                    onChange={(event) => {
                      const artifactFindings = event.target.value;
                      setReviewForm((previous) => ({ ...previous, artifactFindings }));
                    }}
                    placeholder="Functional evidence review notes (tests, recordings, screenshots, traces)."
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium" htmlFor="review-attestation">Attestation</label>
                  <Textarea
                    id="review-attestation"
                    value={reviewForm.attestation}
                    onChange={(event) => {
                      const attestation = event.target.value;
                      setReviewForm((previous) => ({ ...previous, attestation }));
                    }}
                    placeholder="Optional compliance/exception note."
                  />
                </div>

                <Button
                  onClick={() => {
                    saveReviewMutation.mutate();
                  }}
                  disabled={saveReviewMutation.isPending}
                >
                  {saveReviewMutation.isPending ? "Saving..." : "Save Review Decision"}
                </Button>
                </CardContent>
              </Card>
            </div>
          </div>
        )
      ) : null}
    </div>
  );
}
