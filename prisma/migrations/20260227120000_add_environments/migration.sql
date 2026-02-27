-- CreateEnum
CREATE TYPE "EnvironmentKind" AS ENUM ('KUBERNETES_JOB');

-- CreateTable
CREATE TABLE "Environment" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "EnvironmentKind" NOT NULL DEFAULT 'KUBERNETES_JOB',
    "runnerImage" TEXT NOT NULL,
    "serviceAccountName" TEXT,
    "resourcesJson" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Environment_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Project" ADD COLUMN "defaultEnvironmentId" TEXT;
ALTER TABLE "Run" ADD COLUMN "environmentId" TEXT;
ALTER TABLE "Run" ADD COLUMN "environmentSnapshot" JSONB;

-- CreateIndex
CREATE UNIQUE INDEX "Environment_name_key" ON "Environment"("name");
CREATE INDEX "Project_defaultEnvironmentId_idx" ON "Project"("defaultEnvironmentId");
CREATE INDEX "Run_environmentId_idx" ON "Run"("environmentId");

-- Seed a default Kubernetes environment for existing projects/runs.
INSERT INTO "Environment" ("id", "name", "kind", "runnerImage", "active", "createdAt", "updatedAt")
VALUES (
    'env_default_k8s',
    'default-k8s',
    'KUBERNETES_JOB',
    'ghcr.io/wcraigjones/attractor-factory-runner:latest',
    true,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
)
ON CONFLICT ("name") DO NOTHING;

-- Backfill default environment onto existing projects.
UPDATE "Project"
SET "defaultEnvironmentId" = (
  SELECT "id"
  FROM "Environment"
  WHERE "name" = 'default-k8s'
  LIMIT 1
)
WHERE "defaultEnvironmentId" IS NULL;

-- Backfill existing runs and freeze a basic snapshot for auditability.
UPDATE "Run" r
SET
  "environmentId" = COALESCE(r."environmentId", p."defaultEnvironmentId"),
  "environmentSnapshot" = COALESCE(
    r."environmentSnapshot",
    jsonb_build_object(
      'id', e."id",
      'name', e."name",
      'kind', e."kind",
      'runnerImage', e."runnerImage"
    )
  )
FROM "Project" p
JOIN "Environment" e ON e."id" = p."defaultEnvironmentId"
WHERE r."projectId" = p."id";

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_defaultEnvironmentId_fkey" FOREIGN KEY ("defaultEnvironmentId") REFERENCES "Environment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Run" ADD CONSTRAINT "Run_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "Environment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
