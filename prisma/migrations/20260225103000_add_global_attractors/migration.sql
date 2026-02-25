-- CreateEnum
CREATE TYPE "AttractorScope" AS ENUM ('PROJECT', 'GLOBAL');

-- CreateTable
CREATE TABLE "GlobalAttractor" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "repoPath" TEXT NOT NULL,
    "defaultRunType" "RunType" NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GlobalAttractor_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "AttractorDef" ADD COLUMN "scope" "AttractorScope" NOT NULL DEFAULT 'PROJECT';

-- DropIndex
DROP INDEX "AttractorDef_projectId_name_key";

-- CreateIndex
CREATE UNIQUE INDEX "GlobalAttractor_name_key" ON "GlobalAttractor"("name");

-- CreateIndex
CREATE UNIQUE INDEX "AttractorDef_projectId_name_scope_key" ON "AttractorDef"("projectId", "name", "scope");
