import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import {
  connectProjectRepo,
  createAttractor,
  createProject,
  createRun,
  getGitHubAppStatus,
  listAttractors,
  listGitHubInstallationRepos,
  listGlobalSecrets,
  listModels,
  listProjects,
  listProjectRuns,
  listProjectSecrets,
  listProviderSchemas,
  listProviders,
  startGitHubAppInstallation,
  startGitHubAppManifestSetup,
  upsertProjectSecret
} from "../lib/api";
import { buildEffectiveAttractors } from "../lib/attractors-view";
import {
  clearSetupWizardProjectDraft,
  clearSetupWizardEntryDraft,
  deriveSetupWizardReadiness,
  firstIncompleteRequiredStep,
  parseSetupWizardStep,
  readSetupWizardDraft,
  saveSetupWizardEntryDraft,
  saveSetupWizardProjectDraft,
  type SetupWizardAttractorDraft,
  type SetupWizardGitHubDraft,
  type SetupWizardProjectDraft,
  type SetupWizardRunDraft,
  type SetupWizardSecretsDraft,
  type SetupWizardStep
} from "../lib/setup-wizard";
import { ARBITRARY_SECRET_PROVIDER } from "../lib/secrets-view";
import type { ProviderSchema, RunType } from "../lib/types";
import { PageTitle } from "../components/layout/page-title";
import { SetupWizardStepCard } from "../components/setup-wizard-step-card";
import { SetupWizardStepper, type SetupWizardStepperItem } from "../components/setup-wizard-stepper";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Textarea } from "../components/ui/textarea";

const DEFAULT_ATTRACTOR_TEMPLATE = `digraph attractor {
  start [shape=Mdiamond, type="start", label="Start"];
  done [shape=Msquare, type="exit", label="Done"];
  start -> done;
}`;

function firstLogicalKey(schema: ProviderSchema | undefined): string {
  if (!schema) {
    return "";
  }
  if ((schema.requiredAll?.length ?? 0) > 0) {
    return schema.requiredAll?.[0] ?? "";
  }
  if ((schema.requiredAny?.length ?? 0) > 0) {
    return schema.requiredAny?.[0] ?? "";
  }
  return Object.keys(schema.envByLogicalKey ?? {})[0] ?? "";
}

function defaultSecretKey(schema: ProviderSchema | undefined, logicalKey: string): string {
  if (!schema || !logicalKey) {
    return "";
  }
  const envName = schema.envByLogicalKey[logicalKey] ?? logicalKey;
  return envName.toLowerCase();
}

function nextOnboardingBranch(): string {
  return `attractor/onboarding-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${Math.random().toString(36).slice(2, 7)}`;
}

function submitGitHubManifestFormInNewTab(input: {
  manifestUrl: string;
  state: string;
  manifest: Record<string, unknown>;
}): void {
  const form = document.createElement("form");
  form.method = "POST";
  form.target = "_blank";
  form.rel = "noopener noreferrer";
  form.action = input.manifestUrl;
  form.style.display = "none";

  const manifestField = document.createElement("input");
  manifestField.type = "hidden";
  manifestField.name = "manifest";
  manifestField.value = JSON.stringify(input.manifest);
  form.appendChild(manifestField);

  const stateField = document.createElement("input");
  stateField.type = "hidden";
  stateField.name = "state";
  stateField.value = input.state;
  form.appendChild(stateField);

  document.body.appendChild(form);
  form.submit();
  document.body.removeChild(form);
}

function normalizeProjectDraft(input: SetupWizardProjectDraft | undefined): {
  github: SetupWizardGitHubDraft;
  secrets: SetupWizardSecretsDraft;
  attractor: SetupWizardAttractorDraft;
  run: SetupWizardRunDraft;
  lastStep?: SetupWizardStep;
  lastRunId?: string;
} {
  return {
    github: input?.github ?? {},
    secrets: input?.secrets ?? {},
    attractor: input?.attractor ?? {},
    run: input?.run ?? {},
    ...(input?.lastStep ? { lastStep: input.lastStep } : {}),
    ...(input?.lastRunId ? { lastRunId: input.lastRunId } : {})
  };
}

export function ProjectSetupWizardPage() {
  const params = useParams<{ projectId?: string }>();
  const projectId = params.projectId;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  const draftRef = useRef(readSetupWizardDraft());

  const [entrySelectedProjectId, setEntrySelectedProjectId] = useState(draftRef.current.entry.selectedProjectId ?? "");
  const [entryProjectName, setEntryProjectName] = useState(draftRef.current.entry.projectName ?? "");
  const [entryNamespace, setEntryNamespace] = useState(draftRef.current.entry.namespace ?? "");

  const [githubInstallationId, setGitHubInstallationId] = useState("");
  const [githubRepoFullName, setGitHubRepoFullName] = useState("");
  const [githubDefaultBranch, setGitHubDefaultBranch] = useState("main");
  const [githubSelectedRepoFullName, setGitHubSelectedRepoFullName] = useState("");

  const [secretProvider, setSecretProvider] = useState("");
  const [secretName, setSecretName] = useState("");
  const [secretLogicalKey, setSecretLogicalKey] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [secretValue, setSecretValue] = useState("");

  const [selectedAttractorId, setSelectedAttractorId] = useState("");
  const [newAttractorName, setNewAttractorName] = useState("");
  const [newAttractorSourceLabel, setNewAttractorSourceLabel] = useState("");
  const [newAttractorContent, setNewAttractorContent] = useState(DEFAULT_ATTRACTOR_TEMPLATE);
  const [newAttractorRunType, setNewAttractorRunType] = useState<RunType>("planning");
  const [newAttractorDescription, setNewAttractorDescription] = useState("");

  const [runProvider, setRunProvider] = useState("");
  const [runModelId, setRunModelId] = useState("");
  const [runSourceBranch, setRunSourceBranch] = useState("main");
  const [runTargetBranch, setRunTargetBranch] = useState(nextOnboardingBranch());
  const [runReasoningLevel, setRunReasoningLevel] = useState<"minimal" | "low" | "medium" | "high" | "xhigh">("high");
  const [runTemperature, setRunTemperature] = useState("0.2");
  const [runMaxTokens, setRunMaxTokens] = useState("");
  const [runShowAdvanced, setRunShowAdvanced] = useState(false);

  const [lastQueuedRunId, setLastQueuedRunId] = useState("");

  const projectsQuery = useQuery({ queryKey: ["projects"], queryFn: listProjects });
  const providerSchemasQuery = useQuery({ queryKey: ["provider-schemas"], queryFn: listProviderSchemas });
  const providersQuery = useQuery({ queryKey: ["providers"], queryFn: listProviders });
  const globalSecretsQuery = useQuery({ queryKey: ["global-secrets"], queryFn: listGlobalSecrets });

  const projectSecretsQuery = useQuery({
    queryKey: ["project-secrets", projectId],
    queryFn: () => listProjectSecrets(projectId ?? ""),
    enabled: Boolean(projectId)
  });
  const attractorsQuery = useQuery({
    queryKey: ["attractors", projectId],
    queryFn: () => listAttractors(projectId ?? ""),
    enabled: Boolean(projectId)
  });
  const runsQuery = useQuery({
    queryKey: ["project-runs", projectId],
    queryFn: () => listProjectRuns(projectId ?? ""),
    enabled: Boolean(projectId)
  });
  const githubAppStatusQuery = useQuery({
    queryKey: ["github-app-status"],
    queryFn: getGitHubAppStatus,
    enabled: Boolean(projectId)
  });

  const project = useMemo(
    () => projectsQuery.data?.find((candidate) => candidate.id === projectId),
    [projectId, projectsQuery.data]
  );

  const installationReposQuery = useQuery({
    queryKey: ["github-installation-repos", projectId],
    queryFn: () => listGitHubInstallationRepos(projectId ?? ""),
    enabled: Boolean(projectId) && Boolean((githubInstallationId || project?.githubInstallationId)?.trim())
  });

  const modelsQuery = useQuery({
    queryKey: ["models", runProvider],
    queryFn: () => listModels(runProvider),
    enabled: runProvider.length > 0
  });

  const schemaByProvider = useMemo(() => {
    return Object.fromEntries((providerSchemasQuery.data ?? []).map((schema) => [schema.provider, schema]));
  }, [providerSchemasQuery.data]);

  const effectiveAttractors = useMemo(
    () => buildEffectiveAttractors(attractorsQuery.data ?? []),
    [attractorsQuery.data]
  );
  const runnableAttractors = useMemo(
    () => effectiveAttractors.filter((attractor) => attractor.active && Boolean(attractor.contentPath)),
    [effectiveAttractors]
  );

  const readiness = useMemo(
    () =>
      deriveSetupWizardReadiness({
        projectId,
        projectSecretProviders: (projectSecretsQuery.data ?? []).map((secret) => secret.provider),
        globalSecretProviders: (globalSecretsQuery.data ?? []).map((secret) => secret.provider),
        attractors: effectiveAttractors.map((attractor) => ({
          active: attractor.active,
          contentPath: attractor.contentPath
        })),
        runCount: runsQuery.data?.length ?? 0
      }),
    [effectiveAttractors, globalSecretsQuery.data, projectId, projectSecretsQuery.data, runsQuery.data?.length]
  );

  const requiredDataReady =
    !projectsQuery.isLoading &&
    (!projectId ||
      (!projectSecretsQuery.isLoading && !globalSecretsQuery.isLoading && !attractorsQuery.isLoading && !runsQuery.isLoading));

  const currentStep: SetupWizardStep = projectId
    ? parseSetupWizardStep(searchParams.get("step"), "project")
    : "project";

  const githubComplete = Boolean(project?.githubInstallationId?.trim() && project?.repoFullName?.trim());

  const stepItems: SetupWizardStepperItem[] = useMemo(
    () => [
      { step: "project", label: "Project", required: true, complete: readiness.projectComplete },
      { step: "github", label: "GitHub (Optional)", required: false, complete: githubComplete },
      { step: "secrets", label: "Secrets", required: true, complete: readiness.secretsComplete },
      { step: "attractor", label: "Attractor", required: true, complete: readiness.attractorComplete },
      { step: "run", label: "First Run", required: true, complete: readiness.runComplete },
      { step: "done", label: "Done", required: false, complete: readiness.allRequiredComplete }
    ],
    [githubComplete, readiness]
  );

  const createProjectMutation = useMutation({
    mutationFn: (input: { name: string; namespace?: string }) => createProject(input),
    onSuccess: (createdProject) => {
      toast.success(`Project ${createdProject.name} created`);
      clearSetupWizardEntryDraft();
      setEntryProjectName("");
      setEntryNamespace("");
      setEntrySelectedProjectId(createdProject.id);
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
      navigate(`/projects/${createdProject.id}/setup?step=secrets`);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  });

  const connectGitHubMutation = useMutation({
    mutationFn: (input: { installationId: string; repoFullName: string; defaultBranch: string }) =>
      connectProjectRepo(projectId ?? "", input),
    onSuccess: () => {
      toast.success("Repository connection saved");
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
      void queryClient.invalidateQueries({ queryKey: ["github-installation-repos", projectId] });
      setStep("secrets");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  });

  const createGitHubAppMutation = useMutation({
    mutationFn: () => startGitHubAppManifestSetup(projectId ?? ""),
    onSuccess: (payload) => {
      submitGitHubManifestFormInNewTab(payload);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  });

  const installGitHubAppMutation = useMutation({
    mutationFn: () => startGitHubAppInstallation(projectId ?? ""),
    onSuccess: (payload) => {
      window.open(payload.installationUrl, "_blank", "noopener,noreferrer");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  });

  const saveProjectSecretMutation = useMutation({
    mutationFn: () => {
      const trimmedName = secretName.trim();
      const trimmedSecretKey = secretKey.trim();
      if (!trimmedName || !secretProvider || !secretLogicalKey || !trimmedSecretKey || !secretValue.trim()) {
        throw new Error("Provider secret fields and value are required");
      }

      return upsertProjectSecret(projectId ?? "", {
        name: trimmedName,
        provider: secretProvider,
        keyMappings: { [secretLogicalKey]: trimmedSecretKey },
        values: { [trimmedSecretKey]: secretValue }
      });
    },
    onSuccess: () => {
      toast.success("Project secret saved");
      setSecretValue("");
      void queryClient.invalidateQueries({ queryKey: ["project-secrets", projectId] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  });

  const createAttractorMutation = useMutation({
    mutationFn: () => {
      const trimmedName = newAttractorName.trim();
      if (!trimmedName || !newAttractorContent.trim()) {
        throw new Error("Attractor name and content are required");
      }

      return createAttractor(projectId ?? "", {
        name: trimmedName,
        content: newAttractorContent,
        ...(newAttractorSourceLabel.trim().length > 0 ? { repoPath: newAttractorSourceLabel.trim() } : {}),
        defaultRunType: newAttractorRunType,
        ...(newAttractorDescription.trim().length > 0 ? { description: newAttractorDescription.trim() } : {}),
        active: true
      });
    },
    onSuccess: (createdAttractor) => {
      toast.success("Attractor created");
      setSelectedAttractorId(createdAttractor.id);
      void queryClient.invalidateQueries({ queryKey: ["attractors", projectId] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  });

  const queueRunMutation = useMutation({
    mutationFn: () => {
      if (!projectId) {
        throw new Error("Project is required");
      }
      if (!selectedAttractorId) {
        throw new Error("Select or create an attractor first");
      }
      if (!runProvider || !runModelId) {
        throw new Error("Provider and model are required");
      }
      if (!runSourceBranch.trim() || !runTargetBranch.trim()) {
        throw new Error("Source and target branch are required");
      }

      return createRun({
        projectId,
        attractorDefId: selectedAttractorId,
        runType: "planning",
        sourceBranch: runSourceBranch.trim(),
        targetBranch: runTargetBranch.trim(),
        modelConfig: {
          provider: runProvider,
          modelId: runModelId,
          reasoningLevel: runReasoningLevel,
          temperature: Number.parseFloat(runTemperature),
          ...(runMaxTokens.trim().length > 0 ? { maxTokens: Number.parseInt(runMaxTokens.trim(), 10) } : {})
        }
      });
    },
    onSuccess: (payload) => {
      toast.success(`Run queued: ${payload.runId}`);
      setLastQueuedRunId(payload.runId);
      clearSetupWizardProjectDraft(projectId ?? "");
      void queryClient.invalidateQueries({ queryKey: ["project-runs", projectId] });
      setStep("done");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  });

  function setStep(step: SetupWizardStep): void {
    if (!projectId) {
      return;
    }
    const next = new URLSearchParams(searchParams);
    next.set("step", step);
    setSearchParams(next, { replace: true });
  }

  useEffect(() => {
    saveSetupWizardEntryDraft({
      ...(entrySelectedProjectId ? { selectedProjectId: entrySelectedProjectId } : {}),
      ...(entryProjectName ? { projectName: entryProjectName } : {}),
      ...(entryNamespace ? { namespace: entryNamespace } : {})
    });
  }, [entryNamespace, entryProjectName, entrySelectedProjectId]);

  useEffect(() => {
    if (!projectId) {
      return;
    }

    const persistedDraft = normalizeProjectDraft(draftRef.current.projects[projectId]);

    setGitHubInstallationId(persistedDraft.github.installationId ?? "");
    setGitHubRepoFullName(persistedDraft.github.repoFullName ?? "");
    setGitHubDefaultBranch(persistedDraft.github.defaultBranch ?? project?.defaultBranch ?? "main");
    setGitHubSelectedRepoFullName(persistedDraft.github.selectedRepoFullName ?? "");

    setSecretProvider(persistedDraft.secrets.provider ?? "");
    setSecretName(persistedDraft.secrets.name ?? "");
    setSecretLogicalKey(persistedDraft.secrets.logicalKey ?? "");
    setSecretKey(persistedDraft.secrets.secretKey ?? "");
    setSecretValue("");

    setSelectedAttractorId(persistedDraft.attractor.selectedAttractorId ?? "");
    setNewAttractorName(persistedDraft.attractor.name ?? "");
    setNewAttractorSourceLabel(persistedDraft.attractor.sourceLabel ?? "");
    setNewAttractorContent(persistedDraft.attractor.content ?? DEFAULT_ATTRACTOR_TEMPLATE);
    setNewAttractorRunType(persistedDraft.attractor.defaultRunType ?? "planning");
    setNewAttractorDescription(persistedDraft.attractor.description ?? "");

    setRunProvider(persistedDraft.run.provider ?? "");
    setRunModelId(persistedDraft.run.modelId ?? "");
    setRunSourceBranch(persistedDraft.run.sourceBranch ?? project?.defaultBranch ?? "main");
    setRunTargetBranch(persistedDraft.run.targetBranch ?? nextOnboardingBranch());
    setRunReasoningLevel(persistedDraft.run.reasoningLevel ?? "high");
    setRunTemperature(persistedDraft.run.temperature ?? "0.2");
    setRunMaxTokens(persistedDraft.run.maxTokens ?? "");
    setRunShowAdvanced(persistedDraft.run.showAdvanced ?? false);

    setLastQueuedRunId(persistedDraft.lastRunId ?? "");

    const requestedStep = searchParams.get("step");
    if (requestedStep) {
      return;
    }

    if (persistedDraft.lastStep && persistedDraft.lastStep !== "done") {
      setStep(persistedDraft.lastStep);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => {
    if (!projectId || !project) {
      return;
    }

    if (!githubInstallationId && project.githubInstallationId) {
      setGitHubInstallationId(project.githubInstallationId);
    }
    if (!githubRepoFullName && project.repoFullName) {
      setGitHubRepoFullName(project.repoFullName);
      setGitHubSelectedRepoFullName(project.repoFullName);
    }
    if ((!githubDefaultBranch || githubDefaultBranch === "main") && project.defaultBranch) {
      setGitHubDefaultBranch(project.defaultBranch);
    }
    if (!runSourceBranch || runSourceBranch === "main") {
      setRunSourceBranch(project.defaultBranch ?? "main");
    }
  }, [
    githubDefaultBranch,
    githubInstallationId,
    githubRepoFullName,
    project,
    projectId,
    runSourceBranch
  ]);

  useEffect(() => {
    if (!projectId || !requiredDataReady) {
      return;
    }

    const firstIncomplete = firstIncompleteRequiredStep(readiness);
    const requested = parseSetupWizardStep(searchParams.get("step"), "project");

    if (requested === "done" && !readiness.allRequiredComplete) {
      setStep(firstIncomplete);
      return;
    }

    if (!searchParams.get("step")) {
      setStep(firstIncomplete);
    }
  }, [projectId, readiness, requiredDataReady, searchParams]);

  useEffect(() => {
    if (!projectId || !providerSchemasQuery.data?.length) {
      return;
    }
    if (secretProvider && schemaByProvider[secretProvider]) {
      return;
    }

    const firstSchema = providerSchemasQuery.data[0];
    const logicalKey = firstLogicalKey(firstSchema);
    setSecretProvider(firstSchema.provider);
    setSecretName(`llm-${firstSchema.provider}`);
    setSecretLogicalKey(logicalKey);
    setSecretKey(defaultSecretKey(firstSchema, logicalKey));
  }, [projectId, providerSchemasQuery.data, schemaByProvider, secretProvider]);

  useEffect(() => {
    if (!projectId || !providersQuery.data?.length) {
      return;
    }
    if (runProvider && providersQuery.data.includes(runProvider)) {
      return;
    }
    setRunProvider(providersQuery.data[0]);
  }, [projectId, providersQuery.data, runProvider]);

  useEffect(() => {
    if (!projectId || !modelsQuery.data?.length) {
      return;
    }
    if (runModelId && modelsQuery.data.some((model) => model.id === runModelId)) {
      return;
    }
    setRunModelId(modelsQuery.data[0]?.id ?? "");
  }, [modelsQuery.data, projectId, runModelId]);

  useEffect(() => {
    if (!projectId || !runnableAttractors.length) {
      return;
    }
    if (selectedAttractorId && runnableAttractors.some((attractor) => attractor.id === selectedAttractorId)) {
      return;
    }
    setSelectedAttractorId(runnableAttractors[0]?.id ?? "");
  }, [projectId, runnableAttractors, selectedAttractorId]);

  useEffect(() => {
    if (!projectId || readiness.allRequiredComplete || currentStep === "done") {
      return;
    }

    saveSetupWizardProjectDraft(projectId, {
      lastStep: currentStep,
      github: {
        ...(githubInstallationId ? { installationId: githubInstallationId } : {}),
        ...(githubRepoFullName ? { repoFullName: githubRepoFullName } : {}),
        ...(githubDefaultBranch ? { defaultBranch: githubDefaultBranch } : {}),
        ...(githubSelectedRepoFullName ? { selectedRepoFullName: githubSelectedRepoFullName } : {})
      },
      secrets: {
        ...(secretProvider ? { provider: secretProvider } : {}),
        ...(secretName ? { name: secretName } : {}),
        ...(secretLogicalKey ? { logicalKey: secretLogicalKey } : {}),
        ...(secretKey ? { secretKey } : {})
      },
      attractor: {
        ...(selectedAttractorId ? { selectedAttractorId } : {}),
        ...(newAttractorName ? { name: newAttractorName } : {}),
        ...(newAttractorSourceLabel ? { sourceLabel: newAttractorSourceLabel } : {}),
        ...(newAttractorContent ? { content: newAttractorContent } : {}),
        ...(newAttractorRunType ? { defaultRunType: newAttractorRunType } : {}),
        ...(newAttractorDescription ? { description: newAttractorDescription } : {})
      },
      run: {
        ...(runProvider ? { provider: runProvider } : {}),
        ...(runModelId ? { modelId: runModelId } : {}),
        ...(runSourceBranch ? { sourceBranch: runSourceBranch } : {}),
        ...(runTargetBranch ? { targetBranch: runTargetBranch } : {}),
        ...(runReasoningLevel ? { reasoningLevel: runReasoningLevel } : {}),
        ...(runTemperature ? { temperature: runTemperature } : {}),
        ...(runMaxTokens ? { maxTokens: runMaxTokens } : {}),
        ...(runShowAdvanced ? { showAdvanced: true } : {})
      },
      ...(lastQueuedRunId ? { lastRunId: lastQueuedRunId } : {})
    });
  }, [
    currentStep,
    githubDefaultBranch,
    githubInstallationId,
    githubRepoFullName,
    githubSelectedRepoFullName,
    lastQueuedRunId,
    newAttractorContent,
    newAttractorDescription,
    newAttractorName,
    newAttractorRunType,
    newAttractorSourceLabel,
    projectId,
    readiness.allRequiredComplete,
    runMaxTokens,
    runModelId,
    runProvider,
    runReasoningLevel,
    runShowAdvanced,
    runSourceBranch,
    runTargetBranch,
    runTemperature,
    secretKey,
    secretLogicalKey,
    secretName,
    secretProvider,
    selectedAttractorId
  ]);

  if (!projectId) {
    return (
      <div>
        <PageTitle
          title="Project Setup Wizard"
          description="Choose an existing project or create a new one to start guided onboarding."
          actions={
            <Button asChild variant="outline">
              <Link to="/projects">Back To Projects</Link>
            </Button>
          }
        />

        <div className="grid gap-4 lg:grid-cols-2">
          <SetupWizardStepCard
            title="Open Existing Project"
            description="Jump into onboarding for an existing project namespace."
            footer={
              <Button
                type="button"
                disabled={!entrySelectedProjectId}
                onClick={() => {
                  if (!entrySelectedProjectId) {
                    return;
                  }
                  navigate(`/projects/${entrySelectedProjectId}/setup`);
                }}
              >
                Continue Setup
              </Button>
            }
          >
            <div className="space-y-1">
              <Label>Project</Label>
              <Select value={entrySelectedProjectId || undefined} onValueChange={setEntrySelectedProjectId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select project" />
                </SelectTrigger>
                <SelectContent>
                  {(projectsQuery.data ?? []).map((candidate) => (
                    <SelectItem key={candidate.id} value={candidate.id}>
                      {candidate.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </SetupWizardStepCard>

          <SetupWizardStepCard title="Create New Project" description="Create and immediately continue through setup.">
            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                if (entryProjectName.trim().length < 2) {
                  toast.error("Project name must be at least 2 characters");
                  return;
                }
                createProjectMutation.mutate({
                  name: entryProjectName.trim(),
                  ...(entryNamespace.trim().length > 0 ? { namespace: entryNamespace.trim() } : {})
                });
              }}
            >
              <div className="space-y-1">
                <Label>Project Name</Label>
                <Input value={entryProjectName} onChange={(event) => setEntryProjectName(event.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Namespace (optional)</Label>
                <Input value={entryNamespace} onChange={(event) => setEntryNamespace(event.target.value)} />
              </div>
              <Button type="submit" disabled={createProjectMutation.isPending}>
                {createProjectMutation.isPending ? "Creating..." : "Create Project"}
              </Button>
            </form>
          </SetupWizardStepCard>
        </div>
      </div>
    );
  }

  if (!project) {
    return (
      <div>
        <PageTitle title="Project Setup Wizard" description="Project not found." />
        <Button asChild>
          <Link to="/setup">Select Project</Link>
        </Button>
      </div>
    );
  }

  const installationRepos = installationReposQuery.data?.repos ?? [];
  const activeStep = currentStep;

  return (
    <div>
      <PageTitle
        title="Project Setup Wizard"
        description={`Guided onboarding for ${project.name}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link to="/setup">Switch Project</Link>
            </Button>
            <Button asChild variant="outline">
              <Link to={`/projects/${project.id}`}>Project Overview</Link>
            </Button>
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Badge variant={readiness.projectComplete ? "success" : "secondary"}>Project</Badge>
        <Badge variant={readiness.secretsComplete ? "success" : "secondary"}>Secret</Badge>
        <Badge variant={readiness.attractorComplete ? "success" : "secondary"}>Attractor</Badge>
        <Badge variant={readiness.runComplete ? "success" : "secondary"}>Run</Badge>
        {readiness.allRequiredComplete ? <Badge variant="success">Setup complete</Badge> : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-[260px,1fr]">
        <SetupWizardStepCard title="Steps" description="Complete required steps to become run-ready.">
          <SetupWizardStepper currentStep={activeStep} items={stepItems} onSelectStep={setStep} />
        </SetupWizardStepCard>

        {activeStep === "project" ? (
          <SetupWizardStepCard
            title="Project"
            description="This wizard is scoped to a single project."
            footer={
              <>
                <Button type="button" onClick={() => setStep("github")}>
                  Continue
                </Button>
                <Button asChild type="button" variant="outline">
                  <Link to="/setup">Open Full Project Picker</Link>
                </Button>
              </>
            }
          >
            <div className="rounded-md border border-border p-3 text-sm space-y-1">
              <p>
                <span className="text-muted-foreground">Current project:</span> {project.name}
              </p>
              <p>
                <span className="text-muted-foreground">Namespace:</span> <span className="mono">{project.namespace}</span>
              </p>
            </div>

            <div className="space-y-1">
              <Label>Switch To Existing Project</Label>
              <div className="flex flex-wrap gap-2">
                <Select value={entrySelectedProjectId || undefined} onValueChange={setEntrySelectedProjectId}>
                  <SelectTrigger className="min-w-[240px] flex-1">
                    <SelectValue placeholder="Select project" />
                  </SelectTrigger>
                  <SelectContent>
                    {(projectsQuery.data ?? []).map((candidate) => (
                      <SelectItem key={candidate.id} value={candidate.id}>
                        {candidate.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="outline"
                  disabled={!entrySelectedProjectId}
                  onClick={() => {
                    if (!entrySelectedProjectId) {
                      return;
                    }
                    navigate(`/projects/${entrySelectedProjectId}/setup`);
                  }}
                >
                  Open Setup
                </Button>
              </div>
            </div>

            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                if (entryProjectName.trim().length < 2) {
                  toast.error("Project name must be at least 2 characters");
                  return;
                }
                createProjectMutation.mutate({
                  name: entryProjectName.trim(),
                  ...(entryNamespace.trim().length > 0 ? { namespace: entryNamespace.trim() } : {})
                });
              }}
            >
              <p className="text-sm text-muted-foreground">Or create another project and continue onboarding it.</p>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1">
                  <Label>Project Name</Label>
                  <Input value={entryProjectName} onChange={(event) => setEntryProjectName(event.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label>Namespace (optional)</Label>
                  <Input value={entryNamespace} onChange={(event) => setEntryNamespace(event.target.value)} />
                </div>
              </div>
              <Button type="submit" disabled={createProjectMutation.isPending}>
                {createProjectMutation.isPending ? "Creating..." : "Create Project"}
              </Button>
            </form>
          </SetupWizardStepCard>
        ) : null}

        {activeStep === "github" ? (
          <SetupWizardStepCard
            title="GitHub Connection (Optional)"
            description="Connect a repository now or skip and finish later from project overview."
            footer={
              <>
                <Button
                  type="button"
                  onClick={() => {
                    const effectiveInstallationId = githubInstallationId.trim() || project.githubInstallationId?.trim() || "";
                    if (!effectiveInstallationId || !githubRepoFullName.trim() || !githubDefaultBranch.trim()) {
                      toast.error("Installation ID, repository, and default branch are required");
                      return;
                    }
                    connectGitHubMutation.mutate({
                      installationId: effectiveInstallationId,
                      repoFullName: githubRepoFullName.trim(),
                      defaultBranch: githubDefaultBranch.trim()
                    });
                  }}
                  disabled={connectGitHubMutation.isPending}
                >
                  {connectGitHubMutation.isPending ? "Saving..." : "Save Connection"}
                </Button>
                <Button type="button" variant="outline" onClick={() => setStep("secrets")}>
                  Skip
                </Button>
              </>
            }
          >
            <div className="rounded-md border border-border p-3 space-y-2 text-sm">
              <p>
                <span className="text-muted-foreground">GitHub App:</span>{" "}
                {githubAppStatusQuery.data?.configured
                  ? `configured (${githubAppStatusQuery.data.source})`
                  : "not configured"}
              </p>
              <p>
                <span className="text-muted-foreground">Installation:</span> {project.githubInstallationId ?? "not linked"}
              </p>
              <div className="flex flex-wrap gap-2 pt-1">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => createGitHubAppMutation.mutate()}
                  disabled={createGitHubAppMutation.isPending}
                >
                  {createGitHubAppMutation.isPending ? "Opening GitHub..." : "Create GitHub App"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => installGitHubAppMutation.mutate()}
                  disabled={installGitHubAppMutation.isPending}
                >
                  {installGitHubAppMutation.isPending ? "Opening GitHub..." : "Install / Link App"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void queryClient.invalidateQueries({ queryKey: ["github-installation-repos", projectId] })}
                  disabled={installationReposQuery.isFetching || !(githubInstallationId || project.githubInstallationId)}
                >
                  {installationReposQuery.isFetching ? "Refreshing..." : "Refresh Repositories"}
                </Button>
              </div>
            </div>

            {installationRepos.length > 0 ? (
              <div className="space-y-1">
                <Label>Repository from Installation</Label>
                <Select
                  value={githubSelectedRepoFullName || undefined}
                  onValueChange={(value) => {
                    setGitHubSelectedRepoFullName(value);
                    setGitHubRepoFullName(value);
                    const selected = installationRepos.find((repo) => repo.fullName === value);
                    if (selected?.defaultBranch) {
                      setGitHubDefaultBranch(selected.defaultBranch);
                    }
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select repository" />
                  </SelectTrigger>
                  <SelectContent>
                    {installationRepos.map((repo) => (
                      <SelectItem key={repo.id} value={repo.fullName}>
                        {repo.fullName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            <div className="grid gap-3 md:grid-cols-3">
              <div className="space-y-1">
                <Label>Installation ID</Label>
                <Input
                  value={githubInstallationId}
                  onChange={(event) => setGitHubInstallationId(event.target.value)}
                  placeholder={project.githubInstallationId ?? "123456"}
                />
              </div>
              <div className="space-y-1">
                <Label>Repository</Label>
                <Input
                  value={githubRepoFullName}
                  onChange={(event) => {
                    setGitHubRepoFullName(event.target.value);
                    setGitHubSelectedRepoFullName(event.target.value);
                  }}
                  placeholder={project.repoFullName ?? "owner/repo"}
                />
              </div>
              <div className="space-y-1">
                <Label>Default Branch</Label>
                <Input
                  value={githubDefaultBranch}
                  onChange={(event) => setGitHubDefaultBranch(event.target.value)}
                  placeholder={project.defaultBranch ?? "main"}
                />
              </div>
            </div>
          </SetupWizardStepCard>
        ) : null}

        {activeStep === "secrets" ? (
          <SetupWizardStepCard
            title="Provider Secret"
            description="Add at least one provider-mapped secret so runs can authenticate models."
            footer={
              <>
                <Button
                  type="button"
                  onClick={() => saveProjectSecretMutation.mutate()}
                  disabled={saveProjectSecretMutation.isPending}
                >
                  {saveProjectSecretMutation.isPending ? "Saving..." : "Save Secret"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={!readiness.secretsComplete}
                  onClick={() => setStep("attractor")}
                >
                  Continue
                </Button>
              </>
            }
          >
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <Label>Provider</Label>
                <Select
                  value={secretProvider || undefined}
                  onValueChange={(nextProvider) => {
                    const schema = schemaByProvider[nextProvider];
                    const logicalKey = firstLogicalKey(schema);
                    setSecretProvider(nextProvider);
                    setSecretName(`llm-${nextProvider}`);
                    setSecretLogicalKey(logicalKey);
                    setSecretKey(defaultSecretKey(schema, logicalKey));
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select provider" />
                  </SelectTrigger>
                  <SelectContent>
                    {(providerSchemasQuery.data ?? [])
                      .filter((schema) => schema.provider !== ARBITRARY_SECRET_PROVIDER)
                      .map((schema) => (
                        <SelectItem key={schema.provider} value={schema.provider}>
                          {schema.provider}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Secret Name</Label>
                <Input value={secretName} onChange={(event) => setSecretName(event.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Logical Key</Label>
                <Select
                  value={secretLogicalKey || undefined}
                  onValueChange={(nextLogicalKey) => {
                    setSecretLogicalKey(nextLogicalKey);
                    setSecretKey(defaultSecretKey(schemaByProvider[secretProvider], nextLogicalKey));
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select key" />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.keys(schemaByProvider[secretProvider]?.envByLogicalKey ?? {}).map((key) => (
                      <SelectItem key={key} value={key}>
                        {key}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Secret Key</Label>
                <Input value={secretKey} onChange={(event) => setSecretKey(event.target.value)} />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Secret Value</Label>
              <Input type="password" value={secretValue} onChange={(event) => setSecretValue(event.target.value)} />
            </div>
            <p className="text-xs text-muted-foreground">Secret value is never saved in browser draft storage.</p>
          </SetupWizardStepCard>
        ) : null}

        {activeStep === "attractor" ? (
          <SetupWizardStepCard
            title="Attractor"
            description="Select an existing runnable attractor or create a new one for onboarding runs."
            footer={
              <>
                <Button
                  type="button"
                  onClick={() => createAttractorMutation.mutate()}
                  disabled={createAttractorMutation.isPending}
                >
                  {createAttractorMutation.isPending ? "Creating..." : "Create Attractor"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={!selectedAttractorId}
                  onClick={() => setStep("run")}
                >
                  Continue
                </Button>
              </>
            }
          >
            <div className="space-y-1">
              <Label>Use Existing Runnable Attractor</Label>
              <Select value={selectedAttractorId || undefined} onValueChange={setSelectedAttractorId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select runnable attractor" />
                </SelectTrigger>
                <SelectContent>
                  {runnableAttractors.map((attractor) => (
                    <SelectItem key={attractor.id} value={attractor.id}>
                      {attractor.scope === "PROJECT" ? attractor.name : `${attractor.name} (global)`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <Label>New Attractor Name</Label>
                <Input value={newAttractorName} onChange={(event) => setNewAttractorName(event.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Source Label (optional)</Label>
                <Input
                  value={newAttractorSourceLabel}
                  onChange={(event) => setNewAttractorSourceLabel(event.target.value)}
                  placeholder="factory/self-bootstrap.dot"
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label>DOT Content</Label>
              <Textarea
                value={newAttractorContent}
                onChange={(event) => setNewAttractorContent(event.target.value)}
                className="min-h-[180px] font-mono text-xs"
              />
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <Label>Default Run Type</Label>
                <Select value={newAttractorRunType} onValueChange={(value: RunType) => setNewAttractorRunType(value)}>
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
                <Label>Description</Label>
                <Input value={newAttractorDescription} onChange={(event) => setNewAttractorDescription(event.target.value)} />
              </div>
            </div>
          </SetupWizardStepCard>
        ) : null}

        {activeStep === "run" ? (
          <SetupWizardStepCard
            title="Queue First Run"
            description="Run type is fixed to planning for onboarding. Use advanced options only if needed."
            footer={
              <>
                <Button type="button" onClick={() => queueRunMutation.mutate()} disabled={queueRunMutation.isPending}>
                  {queueRunMutation.isPending ? "Queueing..." : "Queue First Run"}
                </Button>
                <Button type="button" variant="outline" onClick={() => setRunShowAdvanced((current) => !current)}>
                  {runShowAdvanced ? "Hide Advanced" : "Show Advanced"}
                </Button>
              </>
            }
          >
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <Label>Provider</Label>
                <Select
                  value={runProvider || undefined}
                  onValueChange={(value) => {
                    setRunProvider(value);
                    setRunModelId("");
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select provider" />
                  </SelectTrigger>
                  <SelectContent>
                    {(providersQuery.data ?? []).map((provider) => (
                      <SelectItem key={provider} value={provider}>
                        {provider}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label>Model</Label>
                <Select value={runModelId || undefined} onValueChange={setRunModelId}>
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
            </div>

            <div className="rounded-md border border-border p-3 text-sm space-y-1">
              <p>
                <span className="text-muted-foreground">Run Type:</span> planning
              </p>
              <p>
                <span className="text-muted-foreground">Selected Attractor:</span>{" "}
                {effectiveAttractors.find((attractor) => attractor.id === selectedAttractorId)?.name ?? "Not selected"}
              </p>
            </div>

            {runShowAdvanced ? (
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1">
                  <Label>Source Branch</Label>
                  <Input value={runSourceBranch} onChange={(event) => setRunSourceBranch(event.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label>Target Branch</Label>
                  <Input value={runTargetBranch} onChange={(event) => setRunTargetBranch(event.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label>Reasoning Level</Label>
                  <Select
                    value={runReasoningLevel}
                    onValueChange={(value: "minimal" | "low" | "medium" | "high" | "xhigh") =>
                      setRunReasoningLevel(value)
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {["minimal", "low", "medium", "high", "xhigh"].map((value) => (
                        <SelectItem key={value} value={value}>
                          {value}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Temperature</Label>
                  <Input value={runTemperature} onChange={(event) => setRunTemperature(event.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label>Max Tokens</Label>
                  <Input value={runMaxTokens} onChange={(event) => setRunMaxTokens(event.target.value)} placeholder="optional" />
                </div>
              </div>
            ) : null}
          </SetupWizardStepCard>
        ) : null}

        {activeStep === "done" ? (
          <SetupWizardStepCard
            title="Setup Complete"
            description="This project is run-ready."
            footer={
              <>
                <Button
                  type="button"
                  onClick={() => {
                    const runId = lastQueuedRunId || runsQuery.data?.[0]?.id;
                    if (!runId) {
                      toast.error("No run found to open");
                      return;
                    }
                    navigate(`/runs/${runId}`);
                  }}
                >
                  Finish
                </Button>
                <Button type="button" variant="outline" onClick={() => setStep("run")}>
                  Queue Another Run
                </Button>
              </>
            }
          >
            <div className="space-y-1 text-sm">
              <p>
                <span className="text-muted-foreground">Project:</span> {project.name}
              </p>
              <p>
                <span className="text-muted-foreground">Secret status:</span>{" "}
                {readiness.secretsComplete ? "Configured" : "Missing"}
              </p>
              <p>
                <span className="text-muted-foreground">Attractor status:</span>{" "}
                {readiness.attractorComplete ? "Ready" : "Missing"}
              </p>
              <p>
                <span className="text-muted-foreground">Run status:</span> {readiness.runComplete ? "Queued" : "Missing"}
              </p>
            </div>
          </SetupWizardStepCard>
        ) : null}
      </div>
    </div>
  );
}
