import { Navigate, Route, Routes } from "react-router-dom";

import { AppShell } from "./components/layout/app-shell";
import { ArtifactViewerPage } from "./pages/artifact-viewer-page";
import { DashboardPage } from "./pages/dashboard-page";
import { GlobalAttractorsPage } from "./pages/global-attractors-page";
import { GlobalSecretsPage } from "./pages/global-secrets-page";
import { NotFoundPage } from "./pages/not-found-page";
import { ProjectAttractorsPage } from "./pages/project-attractors-page";
import { ProjectOverviewPage } from "./pages/project-overview-page";
import { ProjectsPage } from "./pages/projects-page";
import { ProjectRunsPage } from "./pages/project-runs-page";
import { ProjectSecretsPage } from "./pages/project-secrets-page";
import { RunDetailPage } from "./pages/run-detail-page";

export function App() {
  return (
    <Routes>
      <Route path="/" element={<AppShell />}>
        <Route index element={<DashboardPage />} />
        <Route path="projects" element={<ProjectsPage />} />
        <Route path="attractors/global" element={<GlobalAttractorsPage />} />
        <Route path="secrets/global" element={<GlobalSecretsPage />} />
        <Route path="projects/:projectId" element={<ProjectOverviewPage />} />
        <Route path="projects/:projectId/secrets" element={<ProjectSecretsPage />} />
        <Route path="projects/:projectId/attractors" element={<ProjectAttractorsPage />} />
        <Route path="projects/:projectId/runs" element={<ProjectRunsPage />} />
        <Route path="runs/:runId" element={<RunDetailPage />} />
        <Route path="runs/:runId/artifacts/:artifactId" element={<ArtifactViewerPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
