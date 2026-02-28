-- Extend run types with artifact-only task execution.
ALTER TYPE "RunType" ADD VALUE IF NOT EXISTS 'task';

-- CreateEnum
CREATE TYPE "RunQuestionStatus" AS ENUM ('PENDING', 'ANSWERED', 'TIMEOUT');

-- CreateTable
CREATE TABLE "RunCheckpoint" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "currentNodeId" TEXT NOT NULL,
    "contextJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RunCheckpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RunNodeOutcome" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RunNodeOutcome_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RunQuestion" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "options" JSONB,
    "answer" JSONB,
    "status" "RunQuestionStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "answeredAt" TIMESTAMP(3),

    CONSTRAINT "RunQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RunCheckpoint_runId_key" ON "RunCheckpoint"("runId");
CREATE INDEX "RunNodeOutcome_runId_nodeId_idx" ON "RunNodeOutcome"("runId", "nodeId");
CREATE INDEX "RunQuestion_runId_status_createdAt_idx" ON "RunQuestion"("runId", "status", "createdAt");

-- AddForeignKey
ALTER TABLE "RunCheckpoint" ADD CONSTRAINT "RunCheckpoint_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RunNodeOutcome" ADD CONSTRAINT "RunNodeOutcome_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RunQuestion" ADD CONSTRAINT "RunQuestion_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;
