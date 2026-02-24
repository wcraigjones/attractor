-- CreateTable
CREATE TABLE "GlobalSecret" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "k8sSecretName" TEXT NOT NULL,
    "keyMappings" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GlobalSecret_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GlobalSecret_name_key" ON "GlobalSecret"("name");
