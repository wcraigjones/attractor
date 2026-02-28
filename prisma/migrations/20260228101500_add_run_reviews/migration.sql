-- CreateEnum
CREATE TYPE "ReviewDecision" AS ENUM ('APPROVE', 'REQUEST_CHANGES', 'REJECT', 'EXCEPTION');

-- CreateTable
CREATE TABLE "RunReview" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "reviewer" TEXT NOT NULL,
    "decision" "ReviewDecision" NOT NULL,
    "checklistJson" JSONB NOT NULL,
    "summary" TEXT,
    "criticalFindings" TEXT,
    "artifactFindings" TEXT,
    "attestation" TEXT,
    "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RunReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RunReview_runId_key" ON "RunReview"("runId");
CREATE INDEX "RunReview_reviewedAt_idx" ON "RunReview"("reviewedAt");

-- AddForeignKey
ALTER TABLE "RunReview" ADD CONSTRAINT "RunReview_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;
