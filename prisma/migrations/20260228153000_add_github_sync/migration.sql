-- Add GitHub sync domain tables and run/review linkage fields.

-- AlterTable
ALTER TABLE "Run"
  ADD COLUMN "githubIssueId" TEXT,
  ADD COLUMN "githubPullRequestId" TEXT;

ALTER TABLE "RunReview"
  ADD COLUMN "reviewedHeadSha" TEXT,
  ADD COLUMN "summarySnapshotJson" JSONB,
  ADD COLUMN "criticalSectionsSnapshotJson" JSONB,
  ADD COLUMN "artifactFocusSnapshotJson" JSONB,
  ADD COLUMN "githubCheckRunId" TEXT,
  ADD COLUMN "githubSummaryCommentId" TEXT,
  ADD COLUMN "githubWritebackStatus" TEXT,
  ADD COLUMN "githubWritebackAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "GitHubIssue" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "issueNumber" INTEGER NOT NULL,
    "state" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "author" TEXT,
    "labelsJson" JSONB,
    "assigneesJson" JSONB,
    "url" TEXT NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GitHubIssue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GitHubPullRequest" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "prNumber" INTEGER NOT NULL,
    "state" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "url" TEXT NOT NULL,
    "headRefName" TEXT NOT NULL,
    "headSha" TEXT NOT NULL,
    "baseRefName" TEXT NOT NULL,
    "mergedAt" TIMESTAMP(3),
    "openedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "linkedIssueId" TEXT,

    CONSTRAINT "GitHubPullRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GitHubSyncState" (
    "projectId" TEXT NOT NULL,
    "issuesCursor" TEXT,
    "pullsCursor" TEXT,
    "lastIssueSyncAt" TIMESTAMP(3),
    "lastPullSyncAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GitHubSyncState_pkey" PRIMARY KEY ("projectId")
);

-- CreateIndex
CREATE UNIQUE INDEX "GitHubIssue_projectId_issueNumber_key" ON "GitHubIssue"("projectId", "issueNumber");
CREATE INDEX "GitHubIssue_projectId_state_syncedAt_idx" ON "GitHubIssue"("projectId", "state", "syncedAt");
CREATE INDEX "GitHubIssue_projectId_syncedAt_idx" ON "GitHubIssue"("projectId", "syncedAt");

CREATE UNIQUE INDEX "GitHubPullRequest_projectId_prNumber_key" ON "GitHubPullRequest"("projectId", "prNumber");
CREATE INDEX "GitHubPullRequest_projectId_state_syncedAt_idx" ON "GitHubPullRequest"("projectId", "state", "syncedAt");
CREATE INDEX "GitHubPullRequest_projectId_headSha_idx" ON "GitHubPullRequest"("projectId", "headSha");
CREATE INDEX "GitHubPullRequest_linkedIssueId_idx" ON "GitHubPullRequest"("linkedIssueId");

CREATE INDEX "Run_githubIssueId_idx" ON "Run"("githubIssueId");
CREATE INDEX "Run_githubPullRequestId_idx" ON "Run"("githubPullRequestId");

-- AddForeignKey
ALTER TABLE "GitHubIssue" ADD CONSTRAINT "GitHubIssue_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GitHubPullRequest" ADD CONSTRAINT "GitHubPullRequest_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GitHubPullRequest" ADD CONSTRAINT "GitHubPullRequest_linkedIssueId_fkey" FOREIGN KEY ("linkedIssueId") REFERENCES "GitHubIssue"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GitHubSyncState" ADD CONSTRAINT "GitHubSyncState_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Run" ADD CONSTRAINT "Run_githubIssueId_fkey" FOREIGN KEY ("githubIssueId") REFERENCES "GitHubIssue"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Run" ADD CONSTRAINT "Run_githubPullRequestId_fkey" FOREIGN KEY ("githubPullRequestId") REFERENCES "GitHubPullRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
