ALTER TABLE "GlobalAttractor"
ADD COLUMN "modelConfig" JSONB;

ALTER TABLE "AttractorDef"
ADD COLUMN "modelConfig" JSONB;
