-- Store attractor definitions in object storage with explicit version metadata.
ALTER TABLE "GlobalAttractor"
  ALTER COLUMN "repoPath" DROP NOT NULL,
  ADD COLUMN "contentPath" TEXT,
  ADD COLUMN "contentVersion" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "AttractorDef"
  ALTER COLUMN "repoPath" DROP NOT NULL,
  ADD COLUMN "contentPath" TEXT,
  ADD COLUMN "contentVersion" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "GlobalAttractorVersion" (
  "id" TEXT NOT NULL,
  "globalAttractorId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "contentPath" TEXT NOT NULL,
  "contentSha256" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GlobalAttractorVersion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GlobalAttractorVersion_globalAttractorId_version_key"
ON "GlobalAttractorVersion"("globalAttractorId", "version");

CREATE INDEX "GlobalAttractorVersion_globalAttractorId_createdAt_idx"
ON "GlobalAttractorVersion"("globalAttractorId", "createdAt");

ALTER TABLE "GlobalAttractorVersion"
  ADD CONSTRAINT "GlobalAttractorVersion_globalAttractorId_fkey"
  FOREIGN KEY ("globalAttractorId")
  REFERENCES "GlobalAttractor"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AttractorDefVersion" (
  "id" TEXT NOT NULL,
  "attractorDefId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "contentPath" TEXT NOT NULL,
  "contentSha256" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AttractorDefVersion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AttractorDefVersion_attractorDefId_version_key"
ON "AttractorDefVersion"("attractorDefId", "version");

CREATE INDEX "AttractorDefVersion_attractorDefId_createdAt_idx"
ON "AttractorDefVersion"("attractorDefId", "createdAt");

ALTER TABLE "AttractorDefVersion"
  ADD CONSTRAINT "AttractorDefVersion_attractorDefId_fkey"
  FOREIGN KEY ("attractorDefId")
  REFERENCES "AttractorDef"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
